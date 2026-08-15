# Fix Detection Scoring: XXB Classification, Composite Threat, Sentinel/Alerts Conflict

## What's actually wrong (verified against the live database)

Checked `live_flight_detections_rows` (last 24h, 110,034 rows, newest row 18:10 UTC today — ingestion is healthy):

- **XXB / MLAT classification never ran.** `mlat_taxonomy` is filled on **0** rows. `is_spoofing_candidate` is `true` on **0** rows. The classifier logic exists in the app (`src/lib/detectionClassifier.ts`) but nothing writes it back to the table.
- **There is no composite threat column.** The table has `threat_score` (set once at ingest: 0 for all 109,258 `normal_traffic` rows) but no combined score across altitude, physics, identity, operator and geography. Every panel therefore re-invents its own scoring in the browser, which is the root of the disagreement.
- **Sentinel and the alert banner are looking at two different airspaces.** Sentinel filters to the Kern AOI (lat 35.2–35.6 area). Only **2,894 of 110,034** rows in the last 24h are inside Kern — the tracker is ingesting far beyond the county. The alert banner's data path (the cached fallback inside `opensky-fetch`) has **no geographic filter and a 24-hour recency window**, so it returns yesterday's national/international traffic (SAS932, HP-9904, LN-RKS, B-58505) and labels them CRITICAL for "EXTREME_LOW_ALT" — these are airliners on approach or parked, hundreds of miles outside the case.
- **The rescore engine does not fail outright — it times out at scale.** A 25-profile run succeeded in 14.7s. The default run is 500 profiles and its per-signal aggregates scan the full multi-million-row detection history with no time bound, which blows the 150s platform limit.

## The fix

### 1. One canonical score written into the detections table
Add `mlat_taxonomy` population plus two new columns: `composite_threat_score` (0–100) and `composite_threat_reasons`. A new enrichment function computes them in SQL, day-by-day, so every panel reads the same number instead of scoring in the browser.

Scoring inputs: altitude band and AGL context, sub-stall speed, zero-foot staging, distance from the Oildale AOI, Kern vs out-of-county, FAA-master operator class (law enforcement / military / shell), identity anomalies (multiple hex per tail, callsign churn), and on-ground / near-airport suppression so parked aircraft stop scoring critical.

### 2. XXB and MLAT classified correctly
Backfill `mlat_taxonomy` for every row using the canonical buckets already defined in the app: `mlat_artifact`, `on_ground`, `adsb_suppression`, `true_spoofing`, `identity_masked`, `normal`. XXB stays an **info-level MLAT placeholder**, never a spoofing claim, per the existing project standard. `is_spoofing_candidate` is set only for physics-impossible or identity-impossible rows.

### 3. Rescore engine made reliable
- 100s internal budget watchdog plus an 85s SQL statement timeout, returning a clear message instead of a 504.
- All detection aggregates bounded to a 90-day window and driven off the existing indexes.
- Runs sharded: the panel loops through profile batches and reports progress, so a full rescore completes in several short calls instead of one long one that dies.

### 4. Sentinel and the alerts banner reconciled
- The cached fallback in the flight feed gets the same Kern geographic bounds Sentinel uses and a 60-minute recency window, so it can no longer resurrect day-old foreign traffic.
- The banner reads `composite_threat_score` and the MLAT bucket instead of its own local altitude rule, and suppresses `on_ground` / `mlat_artifact` rows from the CRITICAL count.
- A visible **LIVE vs CACHED** state with data age, and a header count that matches what the list actually shows.
- Sentinel and the banner both display the same window and the same AOI label, so "8 Critical" and "0 violations" can no longer describe the same airspace.

### 5. Run it
After deploy: backfill the classification and composite score across the recent archive, run a full sharded rescore, and report the resulting counts (critical / high / MLAT artifacts / suppressed).

## Technical notes

- Migration adds `composite_threat_score int`, `composite_threat_reasons text[]`, and an index on `(detection_timestamp desc, composite_threat_score desc)`; backfill runs in dated batches to avoid long locks. No rows are deleted or overwritten destructively — existing `threat_score` is preserved alongside.
- New edge function `detection-enrichment` with actions `classify`, `score`, `backfill` (date-ranged, resumable, budget-guarded).
- `threat-rescore-engine`: `Promise.race` budget + `SET statement_timeout` + `AND detection_timestamp > now() - interval '90 days'` on all aggregates + offset/limit sharding.
- `opensky-fetch` cached fallback: add Kern bbox and `INTERVAL '60 minutes'`, tag the payload `source: 'cached'` with the newest row age.
- `LiveAlertBanner.tsx` and `JosiahSentinelMonitor.tsx` consume the stored composite score; classification logic moves out of the browser.
