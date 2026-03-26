

# Josiah AI System — Deep Scan Analysis & Improvement Plan

## Current State Assessment

After scanning all 8,816 column definitions across ~900 tables and reviewing the `josiah-chat`, `josiah-sentinel`, and related edge functions, here are the critical gaps and improvements.

---

## Critical Issues Found

### 1. Unstable Database Driver (josiah-chat & josiah-sentinel)
Both `josiah-chat/index.ts` and `josiah-sentinel/index.ts` still use the unstable `deno.land/x/postgresjs` import that was already migrated to `npm:postgres@3.4.4` in `neon-query`. This causes sporadic `503 BOOT_ERROR` failures.

### 2. Josiah Chat Has No Knowledge of New Correlation Data
The chat system prompt references only 9 tables. Your Neon DB now has **20+ josiah_* tables** and **critical new evidence tables** that Josiah is completely blind to:

| Table Josiah Doesn't Know About | Records | Why It Matters |
|---|---|---|
| `confirmed_biometric_correlations` | 334K+ | The entire Aircraft-to-Biometric correlation database |
| `aircraft_biometric_correlation_matrix` | 40K+ | Bradford Hill scores, harm levels, p-values |
| `biometric_screenshots_ocr` | 460+ | Mode-switching evidence |
| `flight_ocr_correlations` | 46+ | FR24 screenshot unmasking |
| `josiah_learned_patterns` | Active | Pattern memory with spatial/temporal/biometric characteristics |
| `josiah_prediction_accuracy` | Active | Prediction validation scores |
| `josiah_sacred_memory` | Active | Trauma markers, continuity scores |
| `coordinated_operations_analysis` | Active | Multi-aircraft coordination proof |
| `complete_aircraft_trace` | Active | Full trace with shell company + FCA risk |

### 3. SQL Table Schema Out of Date for Natural Language Queries
The `natural_query` action gives the AI only 9 table definitions. Queries about correlations, Bradford Hill scores, shell companies, or the new aircraft correlation database will fail or hallucinate column names.

### 4. No Connection to Sturges-Carver Intelligence
The uploaded CA SOS report, Lockheed Corridor Analysis, and Paul Aviation briefing contain verified entity intelligence that Josiah has no access to.

---

## Improvement Plan

### Step 1: Migrate josiah-chat driver to npm:postgres@3.4.4
Replace the unstable deno.land import with the same `npm:postgres@3.4.4` used in `neon-query`. Also replace the deprecated `serve()` with `Deno.serve()`.

### Step 2: Expand Josiah's System Prompt with New Evidence Tables
Update the chat's AI context to include:
- `confirmed_biometric_correlations` — 334K correlation events with heart rate, HRV, stress, altitude, registration, Bradford Hill assessments
- `aircraft_biometric_correlation_matrix` — 40K aircraft profiles with harm scores, p-values, statistical significance
- `biometric_screenshots_ocr` — 460 screenshot-to-biometric links (mode-switching evidence)
- `flight_ocr_correlations` — 46 FR24-to-MLAT unmasking records
- `coordinated_operations_analysis` — multi-aircraft coordination proof
- `josiah_learned_patterns` — Josiah's own pattern memory
- `josiah_sacred_memory` — trauma marker continuity
- `complete_aircraft_trace` — full trace with shell company + FCA risk flags

Also inject live counts from these tables into the context so the AI knows current data scale.

### Step 3: Update Natural Language Query Schema
Expand the SQL generation prompt's `AVAILABLE TABLES` section to include the 20+ new tables with accurate column names, so natural language queries about correlations, Bradford Hill scores, and mode-switching produce correct SQL.

### Step 4: Add Sturges-Carver Network Intelligence to Context
Copy the uploaded intelligence reports (`CA_SOS_ENTITY_INTELLIGENCE_REPORT`, `LOCKHEED_AEROSPACE_CORRIDOR_ANALYSIS`, `PRIORITY_BRIEFING_PAUL_AVIATION_DISCOVERY`) to `public/data/` and inject a summary of verified entities (Best Equipment Leasing, Paul Aviation, BFL Aviation, 9K AIR, ALF IX) into Josiah's system prompt so the AI can cross-reference shell company queries with known actors.

### Step 5: Add Live Correlation Stats to Evidence Context
Replace the static `evidenceCounts` query with an expanded version that includes:
```sql
(SELECT COUNT(*) FROM confirmed_biometric_correlations) as bio_correlations_confirmed,
(SELECT COUNT(*) FROM aircraft_biometric_correlation_matrix WHERE harm_level IN ('CRITICAL','HIGH')) as high_harm_aircraft,
(SELECT COUNT(*) FROM flight_ocr_correlations) as ocr_unmasking_records,
(SELECT COUNT(*) FROM biometric_screenshots_ocr) as screenshot_bio_links,
(SELECT COUNT(*) FROM coordinated_operations_analysis) as coordinated_ops
```

### Step 6: Upgrade AI Model
Upgrade from `google/gemini-2.5-flash` to `google/gemini-2.5-pro` for the main chat context (the system prompt is now massive with 900+ table context). Keep flash for SQL generation.

---

## Files to Modify

| File | Changes |
|---|---|
| `supabase/functions/josiah-chat/index.ts` | Driver migration, expanded system prompt, new evidence queries, model upgrade |
| `public/data/CA_SOS_ENTITY_INTELLIGENCE_REPORT.md` | New file — copy from upload |
| `public/data/LOCKHEED_AEROSPACE_CORRIDOR_ANALYSIS.md` | New file — copy from upload |
| `public/data/PRIORITY_BRIEFING_PAUL_AVIATION_DISCOVERY.md` | New file — copy from upload |

