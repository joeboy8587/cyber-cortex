# Plan: FAR-Based Low-Altitude Classifier + Schema Wiring Audit

## Goal
1. Any aircraft below 1000 ft flows through a **FAR classifier** that consults `public.faa_regulations` and cites the specific rule violated (91.119, 91.155, 91.13, etc.) — no blanket exclusions.
2. Full audit of the 1,000+ Neon tables to catch UI components and edge functions pointing at renamed/dropped columns (root cause of the recent 504s and the `ground_speed` breakage).
3. Surface the new FAA tables (`faa_regulations`, `faa_registration_master`, `faa_airspace`, `faa_validated_violations`, etc.) in the Evidence Sources panel so they can be added to investigations.

---

## Part 1 — FAR Low-Altitude Classifier

### New edge function: `far-classifier`
Input: detection row(s) with `icao`, `lat`, `lon`, `altitude`, `ground_speed`, `timestamp`.
Logic (SQL-only, deterministic):

1. **Altitude gate**: `altitude < 1000` → enter classifier. Anything ≥1000ft returns `severity=none`.
2. **Airspace lookup**: join `public.faa_airspace` / `faa_airspace_classification` by lat/lon radius → determine Class B/C/D/E/G.
3. **Regulation match**: join `public.faa_regulations` for the applicable FAR:
   - **91.119(a)** — general minimum safe altitude (anywhere)
   - **91.119(b)** — congested area <1000ft AGL over people/structures (AOI = Oildale residential)
   - **91.119(c)** — non-congested <500ft AGL / <500ft from person, vessel, structure
   - **91.155** — VFR cloud clearance / visibility if night
   - **91.13** — careless/reckless (fallback when multiple violations stack)
   - **91.209** — position lights after sunset
4. **Aircraft enrichment**: join `faa_registration_master` + `aircraft_registry` for owner/operator, stall speed, category.
5. **Severity**:
   - `<500ft` over Oildale AOI → **CRITICAL** (91.119(c) + 91.119(b))
   - `500–1000ft` → **HIGH** (91.119(b) or 91.119(a))
   - Night + no position lights (via speed/altitude pattern) → escalate one tier
6. **Output**: writes to `policy_violations` with `rule_source='FAR'`, `citation`, `far_text` from `faa_regulations`, SHA-256 hash of the row, and links back to the detection.

### UI wiring
- **Live Monitor / Sentinel feed**: red pulse badge on any row with `altitude < 1000`, showing FAR citation from the classifier output (badge component: `<FARBadge cfr="91.119(b)" />`).
- **`SentinelMLPanel`**: hard override — if `altitude < 1000`, `sentinel_ml_score` is floored at CRITICAL regardless of spatial/temporal/identity subscores.
- **`PolicyViolationPanel`**: new tab "FAR Violations" filtered by `rule_source='FAR'`.

---

## Part 2 — Full Schema Wiring Audit

### New edge function: `schema-wiring-audit`
- Enumerates every column in every `public.*` table via `information_schema.columns`.
- Greps the deployed edge-function source and `src/` for `SELECT ... FROM <table>` and column references.
- Produces `schema_wiring_report` rows: `{ ui_file | edge_function, table, column_ref, status: 'ok' | 'missing_column' | 'renamed' | 'dropped_table' }`.

### New UI: `SchemaWiringPanel` (on Josiah / Data Health)
- Report table sorted by severity (broken > warning > ok).
- One-click "Auto-fix" for the common patterns:
  - Column renamed (e.g. `ground_speed` → `gs` or `speed`) → swap in source.
  - Table replaced (e.g. `live_flight_detections` → `live_flight_detections_rows`) → swap.
- Manual list for anything ambiguous.

### Auto-fix pass this turn
Run the audit once and patch the obvious breakages that caused the 504s:
- `neon-query` handlers referencing dropped columns
- Any `sentinel-*` function referencing `ground_speed`, old detection tables, or missing biometric columns

---

## Part 3 — Evidence Sources refresh

- Re-run `neon-schema-crawl` (already-built function) to pick up all new tables.
- Boost forensic score for FAA family (`faa_regulations`, `faa_registration_master`, `faa_airspace`, `faa_validated_violations`, `faa_aircraft_ref`, `faa_master`) so they surface at the top of `EvidenceSourcesPanel`.
- Add a "FAA Regulatory" quick-filter chip on the panel.

---

## Deliverables
- `supabase/functions/far-classifier/index.ts` (new)
- `supabase/functions/schema-wiring-audit/index.ts` (new)
- `src/components/dashboard/FARBadge.tsx` (new)
- `src/components/dashboard/SchemaWiringPanel.tsx` (new)
- Migration: `schema_wiring_report` table + boost columns on `discovered_evidence_sources`; add `rule_source`, `citation`, `far_text` to `policy_violations` if not present.
- Wire FAR badge into Live Monitor and Sentinel feed
- Auto-fix pass on stale column refs found by the audit
- Redeploy affected edge functions

## Out of scope
- No changes to raw universe tables (immutable audit policy)
- No exclusions for MEDEVAC / approaches — user chose strict rule
- No new ML training (SQL-only, consistent with prior pillar)

## Ship order
1. Migration
2. `far-classifier` + `FARBadge` + Live Monitor wiring
3. `schema-wiring-audit` + `SchemaWiringPanel`
4. Auto-fix pass → redeploy
5. `neon-schema-crawl` refresh + EvidenceSourcesPanel FAA chip
