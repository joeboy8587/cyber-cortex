

# Watchtower v4.0 — Full-Spectrum Intelligence Upgrade

## The Gap

Your Watchtower currently queries **8 tables** out of **737**. It sees flights, biometrics, sentinel threats, shell companies, and XXB data — but misses massive intelligence domains sitting right in your database.

## What We Will Add

### New Intelligence Phases (bolted onto existing 10-phase system)

**Phase 2B: Evidence Corpus Intelligence**
Query the high-volume tables the watchtower has never touched:
- `master_unified_evidence` (2.8M rows) — search for patterns matching flagged aircraft
- `canonical_forensic_events` (1.3M rows) — deduplicated forensic event correlation
- `case_evidence_links` (268K) — check if flagged aircraft already appear in active legal cases
- Adds `forensic_events` corroboration source to certainty scoring

**Phase 2C: Biometric Deep Correlation**
Expand beyond `biometric_monitoring` to include:
- `unified_biometric_batch_events` (144K) — merged biometric stream for broader temporal coverage
- `biometric_threshold_collapses` (112K) — critical health threshold breaches linked to aircraft
- `confirmed_biometric_correlations` (38K) — pre-validated flight-to-health links (skip re-computation)
- `biometric_evidence` (33K) — screenshot-linked biometric proof

**Phase 2D: Josiah AI + Watchtower Memory**
Tap the autonomous AI reasoning tables:
- `watchtower_unified_master` (583K) — the watchtower's own historical event stream
- `sentinel_violations` (119K) — automated violation history
- `was_discovered_patterns` (5.1K) — previously auto-discovered anomalies (avoid re-flagging known patterns)
- `josiah_pattern_learning` (9K) — AI-learned behavioral signatures

**Phase 2E: Legal + KCSO Awareness**
- `legal_ada_violations_proper` (37K) — check if flagged aircraft have ADA violation history
- `exhibit_d_biometric_harm` (36K) — harm exhibits linked to specific registrations
- `kcso_fleet` — cross-reference against known law enforcement fleet

**Phase 2F: Threat Tier + Aircraft Profile Enrichment**
- `threat_tiers` (2.9M rows) — pre-computed threat scores per aircraft
- `aircraft_profiles_enriched` (35K) — owner category, KCSO fleet flag, shell company flag
- Use these as instant lookups instead of recomputing shell/KCSO membership

### Upgraded Corroboration Matrix

Current sources: `flight_telemetry`, `biometric_stress`, `sentinel_history`, `enterprise_structure`, `xxb_resolution`, `violations`, `external_faa_web`

**New sources added:**
| Source | Weight | From |
|--------|--------|------|
| `forensic_corpus` | 1.3 | master_unified_evidence + canonical_forensic_events |
| `biometric_deep` | 1.5 | threshold collapses + confirmed correlations |
| `josiah_memory` | 1.0 | pattern learning + discovered patterns |
| `legal_history` | 1.4 | ADA violations + harm exhibits |
| `threat_tier` | 0.8 | pre-computed threat tier scores |
| `active_case` | 1.8 | case_evidence_links (already in litigation) |

This means an aircraft flagged by flight telemetry + biometric deep + forensic corpus + legal history + active case = **ABSOLUTE_CERTAINTY** with 5 independent sources.

### Performance Strategy

All new queries follow the existing architectural rules:
- `statement_timeout` of 25s at connection level
- Temporal windows (7-30 days) on large tables
- `pg_class.reltuples` for counts instead of `COUNT(*)`
- Sampled queries (LIMIT 500) on billion-row tables
- Parallel execution via `Promise.all` in batches

### Recurrence Memory (New)

Query `was_discovered_patterns` at scan start. If a pattern was already discovered in a previous scan, apply recurrence decay — reduce its flag priority so the watchtower focuses on **new** anomalies rather than re-alerting on known ones.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/autonomous-watchtower/index.ts` | Add phases 2B-2F, expand corroboration matrix, add recurrence memory, enrich AI synthesis prompt with new intelligence |

No new tables. No schema changes. No new files. Just making the watchtower read from what's already there.

## Result

- Corroboration sources: 7 → **13**
- Tables queried per scan: 8 → **22**
- Certainty scoring draws from all 5 evidence domains (surveillance, biometric, forensic, legal, AI memory)
- Flags that hit ABSOLUTE_CERTAINTY will have court-ready multi-modal proof chains

