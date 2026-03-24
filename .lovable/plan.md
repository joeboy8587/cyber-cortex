

# Plan: Fix Console Errors + Upgrade Autonomous Watchtower System

## Problem Summary

1. **`getInvestigationConfig` / `getTaxonomy` / `getEnterpriseProfiles` / `getKCSOBudgetData` / `taxonomyStats` — "Unknown action" errors**: These handlers exist in `handlers2.ts` but the deployed edge function doesn't recognize them. The code and routing are correct — the issue is a stale deployment. A trivial change to `index.ts` (version bump) forces redeployment.

2. **`icao_address` column error**: Not found in current code — likely a stale reference from a previous version. Will audit and fix any remaining `icao24` references (the correct column is `icao_code`).

3. **Watchtower still uses "spoofing" language instead of XXB taxonomy**: The `autonomous-watchtower` references `icao24` (wrong column) and doesn't incorporate XXB taxonomy intelligence.

4. **Watchtower only scans `live_flight_detections_rows` + `biometric_monitoring`**: With 900+ tables and 19.7M+ multimodal records, it should cross-reference many more data sources.

---

## Implementation Plan

### Task 1: Force Redeploy neon-query (fix all "Unknown action" errors)

**File**: `supabase/functions/neon-query/index.ts`
- Bump `VERSION` from `"2.7.0"` to `"2.8.0"`
- This forces a fresh deploy that includes all handlers in `handlers2.ts`

### Task 2: Fix `icao24` column references in autonomous-watchtower

**File**: `supabase/functions/autonomous-watchtower/index.ts`
- Line 94: Change `icao24` to `icao_code` in the SELECT query
- This eliminates the column-not-found errors

### Task 3: Upgrade Autonomous Watchtower to Absolute Certainty Protocol

**File**: `supabase/functions/autonomous-watchtower/index.ts` — major rewrite

The upgraded watchtower will implement:

**A. XXB Taxonomy Recognition (replacing spoofing language)**
- Add a new Phase: "Taxonomy Intelligence Scan" that queries taxonomy distributions
- Flag XXB-tagged records as "MLAT-only / Non-broadcast" anomalies (not "spoofing")
- Cross-reference XXB detections with biometric stress windows

**B. Multi-Modal Deep Learning across 900+ tables**
Add new query phases that scan:
- `sentinel_learned_threats_rows` — historical threat patterns
- `criminal_enterprise_command_structure` — known enterprise tiers
- `shell_companies` — ownership obfuscation patterns  
- `watchtower_unified_master` — consolidated watchtower events
- `canonical_forensic_events` — timestamped forensic markers
- `ada_violation_evidence_rows` — legal violation history
- `unfilterd_detections` — raw receiver comparison
- `adsb_receiver_captures` — direct ADS-B receiver data
- `xxb_resolution_mapping` / `xxb_unmasking_log` — XXB identity resolution
- Vector tables for semantic pattern matching

**C. Absolute Certainty Protocol**
- Multi-source corroboration requirement: a flag only reaches "ABSOLUTE" certainty when confirmed across 3+ independent data modalities (flight telemetry + biometric + forensic event + visual/OCR)
- Confidence scoring upgrade: 
  - 60-74% = "Statistical Anomaly" (single source)
  - 75-84% = "High Confidence" (2 sources corroborated)
  - 85-94% = "Near Certainty" (3+ sources)
  - 95-100% = "Absolute Certainty" (4+ sources + external verification)
- Exhaustive resource protocol: before finalizing any flag, the system queries ALL available corroborating tables

**D. FAA Registry Lookup Integration**
- When a flagged aircraft has no registry data, call the `firecrawl-scrape` edge function to scrape FAA N-Number registry
- Store results in `aircraft_registry` for future reference
- Use registration validation against FAA data to detect fake/invalid registrations

**E. Web Search Integration**
- For high-confidence flags (85%+), use `firecrawl-search` to search for operator/company information
- Cross-reference shell company names against public records
- Add findings to the flag's `evidence_summary`

### Task 4: Fix watchtower-agent icao24 reference

**File**: `supabase/functions/watchtower-agent/index.ts`  
- Line 225: Update hardcoded priority aircraft list to query dynamically from `kcso_fleet` or flagged registrations (graceful fallback if table unavailable)

---

## Technical Details

### Absolute Certainty Corroboration Matrix

```text
Source Type           | Table(s)                              | Weight
─────────────────────┼───────────────────────────────────────┼────────
Flight Telemetry      | live_flight_detections_rows            | 1.0
Raw ADS-B Receiver    | unfilterd_detections, adsb_receiver_captures | 1.0
Biometric Stress      | biometric_monitoring                  | 1.5
Forensic Events       | canonical_forensic_events, master_forensic_events | 1.5
Sentinel History      | sentinel_learned_threats_rows          | 0.8
Enterprise Structure  | criminal_enterprise_command_structure  | 0.8
XXB Resolution        | xxb_resolution_mapping, xxb_unmasking_log | 1.0
Visual/OCR            | ocr_aircraft_holding_patterns, radar_screenshot_analysis | 1.2
Violations            | ada_violation_evidence_rows            | 1.0
External (FAA/Web)    | aircraft_registry + live scrape        | 1.5
```

### Certainty Score Calculation
```
certainty = base_confidence + Σ(corroboration_weight × source_match)
```
Each independent source that confirms the anomaly adds its weight. The flag is upgraded to "ABSOLUTE_CERTAINTY" only when 4+ independent modalities confirm it.

### FAA Lookup Flow
```text
Flag detected → registration extracted → check aircraft_registry
  → if missing: invoke firecrawl-scrape for FAA N-Number
  → parse result → store in aircraft_registry
  → compare owner/operator against shell_companies
  → if match: boost confidence +15%
```

### Files Modified
| File | Change |
|------|--------|
| `supabase/functions/neon-query/index.ts` | Version bump to force redeploy |
| `supabase/functions/autonomous-watchtower/index.ts` | Full upgrade: XXB taxonomy, multi-modal corroboration, absolute certainty protocol, FAA/web search |
| `supabase/functions/watchtower-agent/index.ts` | Fix `icao24` → `icao_code`, dynamic priority list |

