"""Stage a validated FAA release through the linked Neon gateway, never mutate evidence.

This operator tool reads credentials only from the environment. One gateway batch
contains up to ten 500-row parameterized statements and its audit receipt in one
transaction. Failed/uncertain writes stop; resume checks receipts, never retries.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import zipfile

import requests

SCHEMA = "faa_registry_20261021"
FILES = {
    "MASTER.txt": "master_staging",
    "ACFTREF.txt": "aircraft_ref_staging",
}


def column_name(header):
    return re.sub(r"[^a-z0-9]", "_", header.lower())


def load_release(path):
    result = {}
    with zipfile.ZipFile(path) as archive:
        for filename, table in FILES.items():
            raw = archive.read(filename)
            reader = csv.reader(io.StringIO(raw.decode("utf-8-sig")))
            headers = [h.strip() for h in next(reader)]
            columns = [column_name(h) for h in headers if h]
            rows = []
            keys = set()
            hexes = set()
            for values in reader:
                if not any(v.strip() for v in values):
                    continue
                if len(values) != len(headers):
                    raise ValueError("Malformed FAA record width")
                row = {column_name(h): v.strip() or None for h, v in zip(headers, values) if h}
                key = row[columns[0]]
                if not key or key in keys:
                    raise ValueError("Missing or repeated FAA key")
                keys.add(key)
                if filename == "MASTER.txt":
                    hex_value = row["mode_s_code_hex"]
                    if not hex_value or not re.fullmatch(r"[A-Fa-f0-9]{6}", hex_value) or hex_value in hexes:
                        raise ValueError("Missing, malformed, or repeated Mode-S hex")
                    hexes.add(hex_value)
                rows.append(row)
            result[table] = {"columns": columns, "rows": rows, "sha256": hashlib.sha256(raw).hexdigest()}
    codes = {r["code"] for r in result["aircraft_ref_staging"]["rows"]}
    if any(r["mfr_mdl_code"] not in codes for r in result["master_staging"]["rows"]):
        raise ValueError("Missing aircraft model reference")
    return result


def insert_statement(table, columns, rows):
    if table not in FILES.values() or any(not re.fullmatch(r"[a-z0-9_]+", c) for c in columns):
        raise ValueError("Unrecognized staging identifier")
    quoted = ",".join('"' + c + '"' for c in columns)
    fields = ",".join('"' + c + '" text' for c in columns)
    return {
        "query": f'INSERT INTO {SCHEMA}."{table}" ({quoted}) SELECT {quoted} FROM jsonb_to_recordset($1::jsonb) AS r({fields})',
        "params": [rows],
    }


def stage(path):
    release = load_release(path)
    headers = {
        "Authorization": "Bearer " + os.environ["LOVABLE_API_KEY"],
        "X-Connection-Api-Key": os.environ["NEON_API_KEY"],
        "Content-Type": "application/json",
    }
    session = requests.Session()
    for table, data in release.items():
        rows = data["rows"]
        for start in range(0, len(rows), 5000):
            chunk = rows[start:start + 5000]
            receipt = f"{table}:{data['sha256']}:{start}"
            # Receipts prove the entire batch committed; do not infer from partial row counts.
            response = session.post("https://connector-gateway.lovable.dev/neon/sql", headers=headers,
                json={"query": f"SELECT event_id FROM {SCHEMA}.import_audit WHERE event_id=$1 LIMIT 1", "params": [receipt]})
            if not response.ok:
                raise RuntimeError(f"Receipt read failed [{response.status_code}]: {response.text[:1000]}")
            if response.json().get("rows"):
                print(table, start, "already committed", flush=True)
                continue
            queries = [insert_statement(table, data["columns"], chunk[i:i + 500]) for i in range(0, len(chunk), 500)]
            queries.append({"query": f"INSERT INTO {SCHEMA}.import_audit (event_id,detail) VALUES ($1,$2::jsonb)",
                "params": [receipt, {"table": table, "start": start, "rows": len(chunk), "source_sha256": data["sha256"],
                    "normalized_batch_sha256": hashlib.sha256(json.dumps(chunk, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}]})
            response = session.post("https://connector-gateway.lovable.dev/neon/sql", headers=headers, json={"queries": queries})
            if not response.ok:
                raise RuntimeError(f"Import stopped; verify receipt before resuming [{response.status_code}]: {response.text[:1000]}")
            print(table, start + len(chunk), "/", len(rows), "committed", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip_path")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    if args.validate_only:
        for table, data in load_release(args.zip_path).items():
            print(table, len(data["rows"]), data["sha256"])
    else:
        stage(args.zip_path)