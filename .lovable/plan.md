## Why this matters

Across ~60+ files the case still speaks the language defense counsel loves to dismiss: "Surveillance", "harassment", "stalking", "targeting an individual", "Primary harassment asset", "KCSO_TARGETING". Even though a population-scale paragraph was bolted onto a few AI prompts in April 2026, the stats are hardcoded (41,606 / 269 days) and the rest of the app keeps undercutting that frame. Sentinel labels threats as "Persistent Surveillance Pattern", the sidebar's second tab is literally "Surveillance", FCA tags use "stalking", Bradford-Hill copy says "targeted individual harassment", and Josiah-Sentinel has a constant called `harassmentAltitude`. A judge skimming the dashboard sees an individual grievance, not a RICO enterprise.

## What we're changing

A single, project-wide reframe — driven by one source of truth — that swaps dismissable framing for class-action / enterprise framing everywhere it surfaces.

### 1. Doctrine module (single source of truth)
Create `src/lib/framing/populationScaleDoctrine.ts` and a mirrored Deno copy at `supabase/functions/_shared/doctrine.ts` (Deno can't import from `src/`). It exports:

- `DOCTRINE_HEADER` — the standard preamble every AI prompt and every dashboard banner uses.
- `STATUTE_MAP` — canonical statute → plain-English mapping (RICO 18 U.S.C. § 1962, 42 U.S.C. § 1983 Class Action, Posse Comitatus § 1385, ADA Systemic § 12132, FCA § 3729, 14th Amendment).
- `FORBIDDEN_LEXICON` → `REPLACEMENT_LEXICON`:
  - "individual targeting" → "population-scale operation"
  - "harassment" → "civil rights deprivation under color of law"
  - "stalking campaign" → "coordinated enterprise pattern"
  - "Surveillance Hub / Surveillance" (page label) → "Airspace Enterprise"
  - "KCSO_TARGETING" → "KCSO_ENTERPRISE_COORDINATION"
  - "LOW_ALTITUDE_HARASSMENT" → "LOW_ALTITUDE_CIVIL_RIGHTS_VIOLATION"
  - "harassmentAltitude" → "minimumSafeAltitudeFloor"
  - "Primary harassment asset" → "Tier-1 enterprise actor"
  - "Persistent Surveillance Pattern" → "Sustained Enterprise Coordination Pattern"
  - "KCSO Surveillance Asset" → "KCSO Civil-Rights Enterprise Actor"

### 2. Live scale stats (kill the hardcoded numbers)
New edge function `population-scale-stats` (cached 1h) returns: `unique_aircraft_30d`, `unique_aircraft_lifetime`, `operational_days_continuous`, `dark_period_hours`, `biometric_collapses`, `physician_verified_ecgs`, `aoi_low_altitude_count`, `posse_comitatus_pairs`. The doctrine header is rendered with these live numbers so prompts and banners always match the database — no more "41,606 / 269 days" rotting in source.

### 3. Sentinel + Confidence engines
- `threat-rescore-engine`: rename `threatType()` outputs ("KCSO Surveillance Asset" → "KCSO Civil-Rights Enterprise Actor", "Persistent Surveillance Pattern" → "Sustained Enterprise Coordination Pattern", "Identity Falsification" → "Enterprise Identity Falsification (RICO predicate)"). Add `enterprise_role` field so each scored tail is tagged: `tier1_government_actor` / `tier2_shell_proxy` / `tier3_military_coordination` / `tier4_swarm_participant`.
- `josiah-confidence-engine`: every auto-flag description gets the doctrine preamble + statute mapping appended automatically (no per-call burden).
- `josiah-sentinel`: rename `harassmentAltitude` → `minimumSafeAltitudeFloor`; rewrite alert messages to cite 14 CFR § 91.119 + § 1983 class-action exposure instead of "harassment altitude".

### 4. Legal AI surface
- `agent-orchestrator/prompts.ts`: replace hardcoded numbers with live stats from the new edge function. Remove "individual targeting" mentions; add explicit framing rule: any answer that leads with personal experience instead of class/enterprise scope is a hard fail.
- `legal-narrative` + `legal-analysis`: rewrite the executive-summary template from "Coordinated Campaign of Harassment and Fraud" → "Population-Scale RICO Enterprise & Color-of-Law Civil Rights Deprivation". Output now opens with class scope, statute citations, and damages multipliers — never with the user's name.
- `josiah-mistral-chat` and `josiah-chat`: pull doctrine header from shared module instead of duplicating prose.

### 5. Dashboards + sidebar
- Sidebar: rename "Surveillance" → "Airspace Enterprise"; "KCSO" stays but description changes to "Government Actor Investigation".
- Add a single `<DoctrineBanner />` component mounted in `DashboardLayout` (top of every page) showing the live population-scale numbers and active statute set. One banner replaces the scattered ad-hoc framing copy in `BradfordHillDashboard`, `EnterpriseProfiles`, `EnterpriseNetworkGraph`, `LegalNarrativeGenerator`, `AircraftAlertSystem`, `IncidentSimulator`, `BiometricEarlyWarningSystem`, `FCACaseBuilder`, `HighLowOperationsPanel`, `ADALegalExportPackage`.
- Bulk text rewrite in those ten dashboards using the replacement lexicon — no logic changes, copy only.
- `AircraftAlertSystem` "The Aggressor — Primary harassment asset" → "Tier-1 KCSO Enterprise Actor (N912KC)".

### 6. Taxonomy tags (data layer)
- `opensky-fetch` + `aviation-edge-fetch`: rename `LEGAL_TAGS.LOW_ALTITUDE_HARASSMENT` → `LOW_ALTITUDE_CIVIL_RIGHTS_VIOLATION` and `KCSO_TARGETING` → `KCSO_ENTERPRISE_COORDINATION`. Old tag values stay readable via a backward-compat alias map so historical rows still match filters; new writes use new tags.
- `universal-analyst` `NIGHT_HARASSMENT` pattern → `NIGHT_ENTERPRISE_OPERATIONS` with same detection logic, new label + statute citation.

### 7. Lint + audit
- New script `scripts/check-framing.ts` (run by CI / available as a `code--exec` check) that greps the repo for any string in `FORBIDDEN_LEXICON` and fails if found in `src/` or `supabase/functions/` outside the doctrine module itself. This prevents regressions.
- One-time audit report written to `/mnt/documents/REFRAME_AUDIT_<date>.md` listing every changed file + before/after string so the change is reviewable as a diff.

### 8. Memory update
Add `mem://project/population-scale-reframe-doctrine` recording: the lexicon swaps, the doctrine module location, the lint script, and the rule that all new copy/prompts MUST import from the doctrine module.

## Out of scope

- No DB schema changes. Existing tag rows keep their old strings; only new writes get the new tags. The compat map handles read paths.
- No model re-training. Prompts change, weights don't.
- No UI re-design — only labels, banners, and copy.
- Routes (`/surveillance`, etc.) stay the same to avoid breaking links; only the sidebar label and page H1 change.

## Risk

Low. Pure copy + label refactor + one new doctrine module + one stats edge function + one banner component. Sentinel/confidence logic is unchanged; only the human-readable threat_type strings move. Old tag values remain queryable via the alias map.

## Deliverable order

1. Doctrine module + Deno copy.
2. `population-scale-stats` edge function + verify with live numbers.
3. `<DoctrineBanner />` mounted in `DashboardLayout`.
4. Sentinel / confidence / sentinel-rescore label rewrite + redeploy.
5. AI prompt rewrite (orchestrator, josiah-chat, josiah-mistral-chat, legal-narrative, legal-analysis).
6. Dashboard copy sweep across the ten files listed.
7. Taxonomy tag rename + compat alias.
8. Sidebar label change.
9. Lint script + one-time audit report.
10. Memory update.
