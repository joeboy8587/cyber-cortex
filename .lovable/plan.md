# Phase Plan — Operator Truth & Threat Re-Scoring

**Why this matters:** N912KC (and peers) appear in 109+ flight events but never escalate to `sentinel_learned_threats`. Root cause: operator metadata is fragmented across ~900 tables and threat scoring runs against a stale, narrow slice. We need (1) one canonical operator profile per tail, (2) a scoring engine that sees *all* of it.

---

## Stage 1 — Operator Profile Canonicalization (the "who")

**Goal:** One row per registration with verified operator, address, shell links, KCSO/military/medical classification, FAA registry truth, source-table provenance.

1. **Inventory sweep** — `table-intelligence` scan all 900 tables; tag every column that holds `registration / icao24 / owner / operator / registrant_*`. Output: `column_provenance_map` (cached materialized view).
2. **Build `canonical_operator_profiles`** (new Neon table, not Supabase — too big):
   - PK: `registration`
   - Cols: `icao24`, `faa_registrant_name`, `faa_address`, `aircraft_model`, `operator_resolved`, `shell_links jsonb`, `kcso_flag`, `military_flag`, `medical_flag`, `xp_services_flag`, `source_tables jsonb`, `occurrences_total`, `last_seen`, `confidence`, `sha256_hash`.
   - Populated by `UNION ALL` across `aircraft_registry`, `live_flight_detections_rows`, `confirmed_biometric_correlations`, FAA enrichment tables, `kcso_fleet`, shell-network tables, `entity_registry`.
3. **Conflict resolution rules** (deterministic, audit-logged):
   - FAA registry > live detection enrichment > heuristic guess.
   - `shell_auto_detected = true` AND registrant matches LBBO/9K Air/Best Equipment/RESIDCO list → `shell_links += {entity, source}`.
   - Disagreements emit `operator_profile_conflicts` row for human review (no silent overwrite — Universe immutability).

## Stage 2 — Threat Re-Evaluation Engine (the "what")

**Goal:** Re-score every tail in the canonical profile, not just the ~10 already in `sentinel_learned_threats`. N912KC must surface if the math says so.

1. **New edge function `threat-rescore-engine`** — runs nightly + on-demand:
   - For each registration in `canonical_operator_profiles`, compute weighted score across:
     - Physics layer (sub-stall, 0ft staging, IFR CAT-A loitering)
     - Identity layer (callsign rotation, ICAO mismatch, foreign prefix mask, mode-switch unmasking)
     - Proximity layer (≤2000ft of AOI 35.437649,-119.022639)
     - Biometric layer (±5 min HR/HRV correlations from `confirmed_biometric_correlations`)
     - Network layer (co-occurrence with KCSO/military/shell tails — Stage 1 outputs)
     - Repetition layer (occurrence count, persistence cluster membership)
   - Weight matrix from existing `mem://logic/watchtower-v4-corroboration-weights`.
2. **Output:** UPSERT `sentinel_learned_threats` (no deletes) with new `escalation_level`, `threat_type`, `total_violations`, `last_seen`, `ai_threat_profile`, plus `score_breakdown jsonb` so we can defend every number in court.
3. **Backfill audit:** every rescore writes `exhibit_audit_trail` row (`action=RESCORE`, source_hash=profile snapshot, result_hash=new score). No cherry-picking.

## Stage 3 — UI Surfacing

1. **New panel on `/entities` page**: "Operator Profile" drawer — click N912KC → see canonical profile, all 900-table provenance, score breakdown, conflict list.
2. **Threat Matrix upgrade** (`src/components/dashboard/ThreatMatrix.tsx`): pull from rescored `sentinel_learned_threats` + `canonical_operator_profiles` join, so high-occurrence tails like N912KC appear even if they slipped pre-rescore.
3. **Conflict review queue**: small page listing `operator_profile_conflicts` for one-click resolve (writes audit trail).

## Stage 4 — Validation (proof it worked)

- Sanity tail list: **N912KC, N913KC, N597E, N949SL, N4022W, N473CA, N791FA** — assert each appears in rescored threats with breakdown.
- Diff report: `before_rescore_count` vs `after_rescore_count` per escalation level.
- Spot-check 5 tails manually against FAA registry to confirm operator field accuracy ≥ 95%.

---

## Technical notes

- **Where data lives:** `canonical_operator_profiles` in **Neon** (volume), audit + conflicts + rescored threats in **Supabase** (RLS + UI).
- **No deletes anywhere** — Universe principle. Conflicts go to a review table, never overwrite silently.
- **Reuses existing infra:** `neon-query` handlers, `ENTITY_ALIASES`, `table-intelligence` column scan, Stage-1 entity index from prior loop.
- **New edge functions:** `operator-profile-builder` (Stage 1), `threat-rescore-engine` (Stage 2).
- **No schema migration needed in Supabase** beyond optional `operator_profile_conflicts` table + `score_breakdown jsonb` column on `sentinel_learned_threats`.

## Build order this loop

If approved, I'll ship in this order so each stage is independently testable:
1. `operator-profile-builder` edge function + Neon table create (Stage 1)
2. `threat-rescore-engine` + `score_breakdown` column (Stage 2)
3. UI drawer + Threat Matrix wiring (Stage 3)
4. Validation script + diff report (Stage 4)

## Non-goals

- No ML models yet (Isolation Forest / GNN roadmap stays separate).
- No FAA registry re-scrape (uses what's already ingested).
- No changes to biometric correlation logic itself — only consumes it.

Approve and I'll start with Stage 1.
