# Biometric Master Mapping + Full Command Center Audit

## Goal
Make `watchtower_biometrics_master` the single source of truth for every biometric surface in the UI, document the current state with screenshots of all 19 routes, and ship the highest-impact fixes in the same loop.

You confirmed:
- **Master table:** `watchtower_biometrics_master` (Neon — court-ready schema: dual timezone, HR/HRV/stress/SpO₂, aircraft + operator + altitude, KCSO/shell/military flags, Bradford-Hill, SHA-256, chain of custody)
- **Scope:** every route
- **Deliverable:** PDF audit report + immediate high-priority fixes

---

## Phase 1 — Discover (read-only)

1. **Inventory Neon biometric tables** via `neon-query`: row counts, latest timestamp, and column overlap for the top 90 biometric-named tables. Confirm hierarchy:
   - `watchtower_biometrics_master` (canonical)
   - `biometric_events` (97k — legacy generic)
   - `unified_biometric_events` (37k — older consolidation)
   - `biometrics_unified` (10k — sparse / NULL timestamps)
   - `confirmed_biometric_correlations` (76k — derived pairs)
   - `whoop_*` (raw + OCR upstream)

2. **Map UI → table** for every component that reads biometrics. Already found 30+ files referencing biometric tables, including:
   - `BiometricArchivePanel`, `BiometricCorrelation`, `BiometricFlightCorrelationHub`, `BiometricBattleMap`, `BiometricEarlyWarningSystem`, `BiometricCausationValidator`, `ChronoBiometricDigest`, `BradfordHillDashboard`, `FourFactorCorrelationEngine`, `ManualBiometricLogger`, `DirectAircraftCorrelation`, `DeepCorrelationEngine`
   - Pages: `Biometrics`, `Surveillance`, `Josiah`, `Stories`, `Index`
   - Edge functions: `autonomous-watchtower`, `comprehensive-evidence-scan`, `data-consolidation`, `multimodal-enrichment`, `threat-rescore-engine`, `population-scale-stats`, `josiah-chat`, `neon-query/handlers*`

3. **Screenshot every route** (19 pages) at 1452×828 via the browser tool. Save to `/mnt/documents/audit_<date>/screenshots/`.

---

## Phase 2 — Audit Report (PDF)

Generated to `/mnt/documents/20260522_WATCHTOWER_AUDIT_biometric_master_mapping.pdf` containing:

- **Executive summary** — 1 page, plain language
- **Current vs. target table mapping** — table with three columns: UI surface · table it reads today · canonical replacement (`watchtower_biometrics_master`)
- **Fragmentation evidence** — row counts, latest timestamps, schema-quality grade for each candidate
- **Per-route gallery** — one screenshot per page with red callouts on biometric panels and which table they touch
- **Ranked improvement list** — severity, effort, prosecutorial impact
- **CSV sidecar** — `ui_to_biometric_table_map.csv` for traceability

A SHA-256 hash + MANIFEST file is written alongside per project naming convention.

---

## Phase 3 — Immediate high-priority fixes (top 5)

These ship in the same loop as the report:

1. **Add `useBiometricMaster()` hook** — single canonical fetcher (paged, dual-timezone aware, returns the standard payload shape). All future panels import this.
2. **Repoint the 5 most-visible panels** to `watchtower_biometrics_master`:
   - `BiometricCorrelation`
   - `BiometricFlightCorrelationHub`
   - `BiometricBattleMap`
   - `BradfordHillDashboard`
   - `ChronoBiometricDigest`
3. **Source-of-truth banner** on the Biometrics page — green pill showing "Master: watchtower_biometrics_master · N rows · last update <timestamp>" plus an amber pill listing any legacy tables still in use.
4. **`josiah-sentinel` & `comprehensive-evidence-scan`** edge functions read from the master table (eliminates the multi-table inflation we already fixed in dedup logic — now also fixed at source).
5. **Legacy-table guardrail** — add a lint-style runtime warning in `useNeonDatabase` when a query targets a deprecated biometric table, so any new code that drifts gets flagged in console.

Lower-priority fixes (Bradford-Hill recompute on backfilled rows, deprecation of `biometrics_unified`, removing `confirmed_biometric_correlations` as a UI source) are listed in the report as Phase-4 candidates — not executed this loop.

---

## Technical details

- New file: `src/hooks/useBiometricMaster.ts` — wraps `neon-query` with table=`watchtower_biometrics_master`, exposes `{ rows, latestTimestamp, totalRows, kcsoCount, shellCount, militaryCount, loading, error }`. Pagination keyset on `biometric_timestamp_utc DESC`.
- `neon-query/handlersN.ts` — add a `biometric_master` handler returning the standard payload; keep legacy handlers but mark them `@deprecated` in JSDoc.
- Panels: minimal diff — swap the `useNeonDatabase({ table: 'biometric_events' …})` call to `useBiometricMaster()` and map fields (e.g. `hr_bpm` → `heart_rate_bpm`, `observed_at` → `biometric_timestamp_utc`).
- Source-of-truth banner: new `src/components/dashboard/BiometricSourceBanner.tsx` using existing semantic tokens (green = primary, amber = warning).
- PDF generated server-side via `pdf-lib` in a new short-lived edge function `biometric-audit-report` (CORS, JWT-validated, returns the PDF as a signed URL in `rag-uploads` bucket — also dropped on `/mnt/documents/` from the sandbox).
- All screenshots taken via `browser--navigate_to_url` + `browser--screenshot` over the 19 routes in `src/pages/`.

---

## Out of scope (this loop)

- Migrating raw upstream data between tables (no `INSERT/UPDATE/DELETE` against Neon biometric data — universe records are immutable per memory policy)
- Deleting the legacy tables — they stay as forensic backup
- Re-running Bradford-Hill scoring on the full 113k row history
- ML / GNN roadmap items

Approve to proceed and I'll execute Phases 1–3 in one pass.
