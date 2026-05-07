## Goal

Build the **Entity Resolution / Canonical Entity Index** feature in 4 ordered phases, exactly per your priority matrix. New page at `/entity-resolution`, fed by Neon aggregations + Supabase exhibit/flag promotion.

## Phase 1 — Promote Top Entities to Flags/Exhibits  (legal force multiplier)

**Backend**
- New `neon-query` handler `entityCanonicalIndex`: `SELECT canonical_value, source_table, occurrences, max(ts) AS last_seen FROM (UNION ALL of top 6–8 entity-rich tables: confirmed_biometric_correlations, exhibit_d_biometric_harm, alert_logs, flight_events, …) GROUP BY canonical_value, source_table ORDER BY occurrences DESC LIMIT 5000`. Cached.
- Reuses table-intelligence `ENTITY_ALIASES` to know which column is the canonical id per table.

**UI** — `src/components/entity-resolution/EntityIndexTable.tsx`
- Type / source / min-occurrence filter chips, search box.
- Each row has `[PROMOTE]` button.

**Promotion flow** (one click):
1. Compute SHA-256 of `{canonical_value, source_table, occurrences, snapshot_ts}`.
2. INSERT into `exhibits` (case_id = current legal case, tier 1, code `EXH-D-{n}`, evidence_type `entity_canonical`, sha256_hash, promotion_rule).
3. INSERT into `watchtower_autonomous_flags` (flag_type `CANONICAL_HIGH_OCCURRENCE`, severity by threshold, registration, evidence_summary jsonb).
4. INSERT into `exhibit_audit_trail` (action `PROMOTE`, source_hash, result_hash, performed_by = auth.uid()).
- Done client-side via supabase-js (RLS already permits investigators).

## Phase 2 — Related-Entity Drill-Down

**Backend**
- Handler `entityRelated(canonical_value, window_minutes=15)`: for each canonical, find other canonicals appearing in same source tables within ±window of shared timestamps. Returns `[{related, shared_timestamps, overlap_pct, avg_altitude_during_overlap}]`.
- Implemented as a `WITH base AS (... self-join on time bucket ...)` query, capped at top 25 related per entity.

**UI**
- Click row → side drawer shows related entities sorted by overlap_pct, with one-click "Promote network" to create a single Exhibit referencing all related canonicals.

## Phase 3 — Last Seen + Filters

- Backfill `last_seen` already in Phase 1 query.
- Add filters: type, source, `min_occurrences`, `last_seen > X` (presets: last 2h / 24h / 7d), harm-only toggle (sources containing `harm`).
- Real-time refresh button (pulls fresh aggregation, shows "active in last 30 min" badge).

## Phase 4 — Export Canonical Index

- Edge function `entity-index-export`: streams full canonical index as CSV + JSON, computes SHA-256 of each artifact, writes a MANIFEST file. 
- Two outputs:
  - `YYYYMMDD_WATCHTOWER_EXHIBITS.csv` (promoted-only, with legal metadata)
  - `YYYYMMDD_WATCHTOWER_CANONICAL_INDEX.csv` (full ~37K)
- UI button "Download manifest pack" → zip via JSZip (already in project).

## Routing & nav
- New page `src/pages/EntityResolution.tsx`, route `/entity-resolution`, nav entry under DataTools or new top-level "Entities".

## Non-goals (this loop)
- No schema migrations (uses existing `exhibits`, `watchtower_autonomous_flags`, `exhibit_audit_trail`).
- No changes to existing dashboards.

## Implementation order this turn
I'll ship **Phase 1 end-to-end** (handler + table UI + promote button + audit log) and stub the page route, then chain Phases 2–4 in follow-up loops so each is testable.