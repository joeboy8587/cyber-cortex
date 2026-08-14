#!/usr/bin/env python3
"""
Watchtower Aircraft GPU Embedding Bridge
========================================

A simple, one-click script for local embedding of the Watchtower Aircraft
Dossier feature corpus. It runs on your NVIDIA/RTX GPU if available, or falls
back to CPU.

What it does
------------
1. Reads the .jsonl file you exported from the Watchtower Aircraft Dossiers
   page (each line has a `registration` and a `text` summary).
2. Converts each `text` summary into a dense embedding vector using a local
   sentence-transformers model.
3. Writes a new .jsonl file with `{ "registration": "N123AB", "vec": [...] }`
   records that you can drag back into the Watchtower GPU upload panel.

Best models for your MSI Katana 5050 (RTX + Ryzen 7)
------------------------------------------------------
- sentence-transformers/all-MiniLM-L6-v2  (384 dims, fast, default)  ← pick this
- nomic-ai/nomic-embed-text-v1.5          (768 dims, stronger)
- BAAI/bge-large-en-v1.5                  (1024 dims, highest quality)

Pick ONE model and use it consistently. Uploaded vectors must all have the same
`dims` for the behavioural-twins comparison to work.

Install (first time only)
-------------------------
    python -m pip install -r scripts/requirements-gpu.txt

Or simply:
    python -m pip install sentence-transformers tqdm

Run
---
    python scripts/gpu-embed-aircraft.py \
        --input 20260814_WATCHTOWER_AIRCRAFT-PROFILES_features.jsonl

The output file will be named like:
    20260814_WATCHTOWER_AIRCRAFT-PROFILES_features_embedded.jsonl

Notes
-----
- The script never sends your data to the cloud. It runs entirely on your PC.
- A progress bar shows estimated time remaining.
- If you get an out-of-memory error, reduce --batch-size (default 128).
- If you already have the file in a different folder, use the full path, e.g.
  --input "C:\Users\You\Downloads\...jsonl"
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="Embed Watchtower Aircraft Dossier text summaries locally on GPU/CPU."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to the .jsonl file exported from Watchtower Aircraft Dossiers.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output .jsonl path. Defaults to adding '_embedded' before the extension.",
    )
    parser.add_argument(
        "--model",
        default="sentence-transformers/all-MiniLM-L6-v2",
        help="Hugging Face sentence-transformers model name.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=128,
        help="How many aircraft summaries to embed at once. Lower this if VRAM runs out.",
    )
    parser.add_argument(
        "--field",
        default="text",
        help="Which JSON field to embed. Default is the plain-English summary ('text').",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"ERROR: input file not found: {input_path.resolve()}")
        sys.exit(1)

    if args.output:
        output_path = Path(args.output)
    else:
        stem = input_path.stem
        suffix = input_path.suffix
        output_path = input_path.with_name(f"{stem}_embedded{suffix}")

    print("=" * 60)
    print("Watchtower Aircraft GPU Embedding Bridge")
    print("=" * 60)
    print(f"Input:    {input_path.resolve()}")
    print(f"Output:   {output_path.resolve()}")
    print(f"Model:    {args.model}")
    print(f"Field:    {args.field}")
    print(f"Batch:    {args.batch_size}")

    # 1. Load records
    print("\nLoading aircraft records...")
    records = []
    with input_path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"  Skipping malformed line {line_no}: {e}")
                continue
            if not isinstance(obj, dict):
                continue
            reg = obj.get("registration") or obj.get("reg")
            text = obj.get(args.field)
            if reg and text:
                records.append({"registration": str(reg).strip().upper(), "text": str(text)})

    if not records:
        print("ERROR: no valid records found. Make sure the file has 'registration' and 'text' fields.")
        sys.exit(1)

    print(f"Loaded {len(records):,} aircraft summaries.")

    # 2. Import sentence-transformers (do this after basic validation so errors are clearer)
    try:
        from sentence_transformers import SentenceTransformer
        from tqdm import tqdm
    except ImportError as e:
        print("\nERROR: Required Python library not installed.")
        print(f"  {e}")
        print("\nFix it with one of these commands:")
        print("  python -m pip install sentence-transformers tqdm")
        print("  python -m pip install -r scripts/requirements-gpu.txt")
        sys.exit(1)

    # 3. Load model and detect device
    print(f"\nLoading model '{args.model}'...")
    start = time.time()
    model = SentenceTransformer(args.model)
    device = model.device
    print(f"Model loaded in {time.time() - start:.1f}s")
    print(f"Running on: {device}")
    if str(device) == "cpu":
        print("  NOTE: GPU not detected. Embedding will be slower but still works.")
    else:
        print("  GPU acceleration active.")

    # 4. Embed in batches
    texts = [r["text"] for r in records]
    print(f"\nEmbedding {len(texts):,} summaries in batches of {args.batch_size}...")
    start = time.time()
    embeddings = model.encode(
        texts,
        batch_size=args.batch_size,
        show_progress_bar=True,
        convert_to_numpy=True,
    )
    elapsed = time.time() - start
    print(f"Embedding complete in {elapsed:.1f}s ({len(texts) / elapsed:.1f} records/sec).")
    print(f"Vector dimensions: {embeddings.shape[1]}")

    # 5. Write output JSONL
    print(f"\nWriting output to {output_path.resolve()}...")
    with output_path.open("w", encoding="utf-8") as f:
        for r, vec in zip(records, embeddings):
            line = json.dumps(
                {
                    "registration": r["registration"],
                    "vec": vec.tolist(),
                    "model": args.model,
                    "dims": int(embeddings.shape[1]),
                },
                separators=(",", ":"),
            )
            f.write(line + "\n")

    print("\n" + "=" * 60)
    print("Done! Next step:")
    print(f"  Upload {output_path.name} back into the Watchtower")
    print("  Aircraft Dossiers page → GPU embedding bridge.")
    print("=" * 60)


if __name__ == "__main__":
    main()
