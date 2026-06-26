## Goal
Use the KCSO Air Support Manual + ADS-B anomaly-detection paper + the 1,000+ Neon tables to harden Sentinel and surface WTPR cases on the Josiah dashboard — non-technical, one-click promotion.

## Pillar 1 — KCSO Policy Violation Engine
- Ingest `Air_Support_Policies.pdf` into `rag_documents` / `rag_chunks` with `document_type='policy'`, `tags=['kcso','air-support','rulebook']`, chunked by section code (A-100, B-401, etc.).
- New edge function `policy-violation-scan`: for each KCSO flight (icao starts `AE`/registered to KCSO fleet), evaluate deterministic SQL rules derived from the manual:
  - B-401: Night VFR <2000ft AGL in mountainous terrain → violation
  - B-1102: Executive transport without filed manifest → violation
  - C-100 / helicopter ops: sustained hover <500ft AGL outside SAR window → violation
  - A-401: SAR claim with no concurrent CAD incident → violation
  - Prisoner-transport (B-1209/1214) cross-county without log → violation
- Writes results to new `policy_violations` table (icao, ts, rule_code, rule_title, severity, evidence_json, sha256).
- Bradford-Hill/Exhibit promotion rule: any `severity >= high` row auto-promotes to Tier-2 exhibit citing the manual section.

## Pillar 2 — 3-Stage ADS-B ML Pipeline (SQL-only, paper-based)
Implemented as Neon views + edge function `sentinel-ml-score`:
- **Stage 1 — Spatial GCN proxy**: SQL window function building per-icao kNN over `lat/lon/alt` at each timestamp; flag when a track's neighbor-graph density or velocity-divergence z-score > 3σ vs airspace baseline.
- **Stage 2 — Temporal WaveNet proxy**: rolling 20-step prediction of speed/altitude/heading using EWMA + dilated lag features (lags 1,2,4,8). Residual > 3σ = temporal anomaly. Captures jamming/spoofing/replay per Table 7 of the paper.
- **Stage 3 — RF/Identity fingerprint**: cross-check ICAO ↔ callsign ↔ registry tuple against `aircraft_registry` + `entity_registry`; mismatch / foreign-prefix recycling / ghost ICAO = identity anomaly (re-uses existing `layered-deception-detector` signals).
- Combined score `sentinel_ml_score = w1*spatial + w2*temporal + w3*identity` written to `sentinel_learned_threats`.

## Pillar 3 — Neon Table Auto-Discovery (1,000+)
- New edge function `neon-schema-crawl`: queries `information_schema.columns`, scores each table by presence of forensic join keys (`icao`, `timestamp/ts`, `lat`, `lon`, `callsign`, `case_id`, `whoop_*`).
- Writes to new `discovered_evidence_sources` table: schema, table_name, row_estimate, score, join_keys[], last_crawled.
- New `EvidenceSourcesPanel` on Josiah: searchable list, "Add to investigation" button registers the table with the cross-modal stitcher.

## Pillar 4 — WTPR Case System Panel
- New edge function `wtpr-cases` (list, filter, drill-down via Neon).
- New `WTPRCasePanel` on Josiah: filters (status, severity, date), timeline, evidence count, one-click "Promote to Exhibit" + "Open in Case Builder".

## UI changes (Josiah dashboard)
- Add four sections under existing panels: `PolicyViolationPanel`, `SentinelMLPanel`, `EvidenceSourcesPanel`, `WTPRCasePanel`.
- Add inline `<PolicyBadge code="B-401" />` component rendered wherever Sentinel flag rows already show (SkepticConsole, ProsecutionTimelinePanel).

## Technical details
- Migrations: `policy_violations`, `discovered_evidence_sources` (both with grants + RLS, investigator/admin read, service_role full).
- All ML stays in SQL/Deno — no Python, no model training. Weights `w1=0.4, w2=0.4, w3=0.2` (tunable later).
- Policy PDF ingested via existing RAG pipeline; chunk size 800 chars, overlap 150, embedded with `google/gemini-embedding-001`.
- All new edge functions: zod validation, corsHeaders, 20s `withBudget` wrapper, JWT verify via existing pattern.
- Inline `PolicyBadge` is presentational only — reads from `policy_violations` via existing supabase client hook.

## Ship order
1. Migration (policy_violations + discovered_evidence_sources)
2. Policy ingest + `policy-violation-scan` function
3. `neon-schema-crawl` + EvidenceSourcesPanel
4. `sentinel-ml-score` + SentinelMLPanel
5. `wtpr-cases` + WTPRCasePanel
6. PolicyBadge inline + Josiah page wiring

Approve and I roll all six in sequence.
