## Goal

Run a deep, automated rescan of the Neon database to (a) surface **new useful evidence** we have not yet promoted, and (b) materially **increase XXB unmasking coverage** beyond the current Tier 1 (ICAO bridge) and Tier 2 (continuity) attributions.

---

## Part 1 — Neon Deep Rescan (`neon-deep-rescan` edge function)

A new orchestrator function that walks the full Neon catalog and emits a prioritized **"New Useful Data" report** into `watchtower_autonomous_flags` + a downloadable JSON artifact.

Scans (each is a parameterized SQL probe, capped + sampled, no destructive writes):

1. **Catalog drift** — list all tables, row counts (via `pg_class` est), new tables since last scan, tables with >10% growth in 7 days.
2. **High-signal newcomers** — registrations seen in last 14 days that:
   - have ≥3 detections in the AOI (Oildale 35.30–35.55, -119.20 to -118.85)
   - are NOT already in `kcso_fleet`, `sentinel_learned_threats`, or `watchtower_autonomous_flags`
3. **Sub-stall physics violators** — any new tail with telemetry <48 kts AND >300 ft (drone/spoof signature per project core rule).
4. **Zero-foot staging** — new detections at 0.0 ft within 500 m of residence (35.437649, -119.022639).
5. **Mode-switching candidates** — same icao24 hex appearing under 2+ registrations in 24 h (identity laundering).
6. **Foreign-prefix + Kern AOI** — any non-N / non-XX prefix detected inside AOI (RCAF, foreign military).
7. **Bimodal altitude tails** — registrations whose altitude histogram has two clear peaks (surveillance + transit cover).
8. **Biometric pairings** — new aircraft within ±5 min of an unmatched HR/HRV spike not yet in `confirmed_biometric_correlations`.
9. **Shell-cluster expansion** — new N-numbers sharing registrant address/city with known shell clusters (9K Air, ALF IX, Best Equipment, Epic Jet).
10. **Hall-of-Shame deltas** — tails whose 90-day rank jumped ≥10 positions since last scan.

Each finding is written with `flag_type='RESCAN_DISCOVERY'`, severity scaled by Bradford-Hill score, and a `learning_context` JSON containing the SQL probe + sample rows for reproducibility.

---

## Part 2 — XXB Unmasking Expansion (`xxb-unmask` v2)

Current state: only Tier 1 (exact ICAO ±60 s) and Tier 2 (spatial continuity <500 m / 30 s). Add:

- **Tier 3 — Callsign bridge.** XXB rows that share `callsign` with a registered track in a ±10 min window get attributed to that registration. (Many MLAT tracks lose ICAO but keep callsign.)
- **Tier 4 — Trajectory fingerprint.** Hash track segments (rounded lat/lon/alt/heading every 30 s). XXB segments whose fingerprint matches a registered fingerprint within ±2 h are attributed. Catches transponder dropouts mid-flight.
- **Tier 5 — Co-flight pairing.** XXB tracks that consistently fly within 1 nm of a known registered aircraft for ≥5 min on ≥3 separate days are attributed as the wing/escort of that aircraft.
- **Tier 6 — Squawk/altitude pattern.** XXB rows whose altitude profile (climb rate, cruise alt band) and squawk match a single known operator's normal envelope.
- **Tier 7 — Origin/destination corridor lock.** XXB tracks confined to a corporate corridor (e.g., Tejon/Wonderful, Meadows Field ramp slot) get attributed to the corridor's top operator with confidence proportional to corridor exclusivity.
- **Probabilistic scoring.** Replace boolean attribution with a 0–100 confidence per tier; aggregate when multiple tiers agree (Bradford-Hill style stacking → near-certain ≥90).
- **Backfill the legacy "spoofed XXB" misclassification** noted in `XXB_EXPLANATION.md`: re-tag all `xxb_*` taxonomy rows with `mlat_source=true` and only flag as suspicious when paired with sub-stall physics or AOI clustering.

UI: extend `XxbUnmaskPanel.tsx` with buttons for Tier 3–7, plus a "Run All Tiers" sweep and a confidence-tier histogram.

---

## Part 3 — Wire-up

- Add cron entry: `neon-deep-rescan` every 6 h.
- Surface results in **Sentinel Monitor** under a new **"Rescan Discoveries"** tab, sortable by Bradford-Hill score, with one-click promotion to exhibit.
- Every discovery gets a SHA-256 hash + `evidence_merkle_ledger` anchor (per audit-trail core rule).
- Doctrine compliance: all output framed as **population-scale** (no single-target language).

---

## Technical Notes

- All SQL runs through existing `neon-query` handlers; no new direct Neon credentials.
- Caps: each probe LIMIT 5000, 30 s statement timeout.
- Tier 4 fingerprint uses `md5(string_agg(...))` on rounded coords — pure SQL, no external compute.
- New table: `xxb_attribution_confidence` (already covered by extending `xxb_attributions` with `confidence_score` int + `tiers_agreed jsonb`).

---

## Deliverables

1. `supabase/functions/neon-deep-rescan/index.ts`
2. Expanded `supabase/functions/xxb-unmask/index.ts` (tiers 3–7 + scoring)
3. Migration: add `confidence_score`, `tiers_agreed` to `xxb_attributions`
4. UI: tab in Sentinel Monitor + expanded `XxbUnmaskPanel`
5. Cron schedule entry
6. First-run report exported to `/mnt/documents/rescan_discoveries_<date>.json`