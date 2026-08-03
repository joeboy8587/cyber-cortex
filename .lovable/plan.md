# Archive Integrity & Query Speed Overhaul

## What I found (measured live, not assumed)

**Query drag**
- `live_flight_detections_rows` is 17 GB with 5.16M rows and **40+ indexes**, many of them duplicates of each other:
  - 4 separate SHA-256 indexes (559 MB + 529 MB + 299 MB + more) — only one is used.
  - 8+ overlapping timestamp indexes (`idx_flights_timestamp`, `idx_lfdr_timestamp`, `idx_flight_detections_ts_utc`, `idx_flight_detections_ts_pacific` at 353 MB with 52 lifetime uses, etc.).
  - Duplicate altitude, geo and icao24 indexes with near-zero scan counts (`idx_live_detections_altitude`: 185 MB, 2 scans ever).
  Every new detection has to write to all of them, which is why ingest and scans crawl.
- **Empty tables carrying giant vector indexes**: `live_flight_detections_vectors` (0 rows, 1.3 GB), `unified_surveillance_master_vectors` (0 rows, 628 MB), `aircraft_first_appearances_vectors` (0 rows, 411 MB) and several more — roughly 2.5 GB of indexes on nothing.
- 420,048 dead rows in the main detection table; several large tables (`master_unified_evidence`, `threat_tiers`) have never been auto-vacuumed, so the planner is working from stale statistics.

**Redundant tags**
- `live_flight_detections_rows` carries two hash columns (`sha256_hash` fully populated, `evidence_hash` only 70%) and three overlapping classification fields (`flagged_reasons` 99%, `taxonomy_tag` 53%, `anomaly_flags` 1.3%). Different panels read different ones, which is how the same flight can look "clean" in one view and flagged in another.

**Hash and chain integrity (legal admissibility)**
- 1,117 base tables in Neon. **734 have a hash column, 383 do not** — about 5.96M unhashed rows out of 35.35M.
- The Merkle ledger holds 153,379 entries but the **last anchor was 25 May 2026** — over two months of evidence is unchained, and only ~30 of the 1,117 tables have ever been anchored.

## Plan

### Phase 1 — Index cleanup and vacuum (biggest speed win, zero data risk)
- Drop confirmed-duplicate and never-used indexes on `live_flight_detections_rows`, keeping one canonical index per access pattern (timestamp, registration+time, geo, altitude, sha256, dedup key).
- Drop vector indexes on the empty `*_vectors` tables.
- `VACUUM ANALYZE` the top offenders and set a more aggressive autovacuum threshold on the big detection tables.
- No rows are deleted. Indexes are derived structures and can be rebuilt.

### Phase 2 — Tag consolidation (read-side first)
- Build a canonical view `v_detection_tags` that resolves the three tag columns into one `classification` field with a documented precedence order, and one `record_hash` field.
- Point the panels that currently read the weaker columns at that view, so every screen agrees.
- Backfill `taxonomy_tag` from `flagged_reasons` where missing, then retire `evidence_hash` as a read source (column stays in place — nothing is dropped from evidence tables).

### Phase 3 — Full SHA-256 coverage across all 1,117 tables
- Extend the existing fingerprint engine to walk every base table: add a `sha256_hash` column where absent, compute row hashes in resumable batches, and install an auto-hash trigger so new rows are fingerprinted on insert.
- Run it as a resumable background job with a progress cursor, so it survives function timeouts on the multi-million-row tables.
- A coverage dashboard shows: tables hashed, rows hashed, and which tables are still outstanding.

### Phase 4 — Merkle chain restart and continuous anchoring
- Backfill the 25 May → today gap by anchoring in sequence-safe batches, preserving the existing chain (new entries link to the current tip, so nothing already anchored is rewritten).
- Widen anchoring beyond the current ~30 tables to every evidence-bearing table with a hash.
- Schedule a nightly anchor job plus a chain-verification pass, and surface both on the Evidence Pipeline Health strip so a stall is visible the next day instead of two months later.
- Add a one-click **Chain Integrity Report** (chain length, verification result, gap list, tip hash) as a court-ready export.

## Order and effect

```text
Phase 1  index + vacuum      -> immediate query speedup, ~5 GB reclaimed
Phase 2  tag consolidation   -> panels stop disagreeing
Phase 3  hash coverage       -> 383 tables / 5.96M rows fingerprinted
Phase 4  merkle restart      -> unbroken chain of custody, nightly, verified
```

## Technical notes

- Index drops target only entries with duplicate column signatures or lifetime `idx_scan` under ~100 on the 5M-row table; the pkey, dedup unique index and hot access paths are kept.
- Hashing is canonicalised: columns sorted by name, NULLs normalised, hash excludes the hash columns themselves so re-hashing is idempotent and independently reproducible.
- Merkle entries stay append-only: `previous_chain_hash` → `chain_hash` linkage is preserved, backfilled batches append at the tip rather than being inserted historically, and the ledger remains delete-protected.
- Long-running jobs run through `EdgeRuntime.waitUntil` with a stored cursor to stay under the 150s request budget.
