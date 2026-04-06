

# Comprehensive Schema-Aware Fragmentation Analysis

## Problem
The Neon database has grown to 900+ tables and 20M+ records. Many systems (agents, enrichment pipelines, forensic tools) create new tables instead of writing to canonical ones, resulting in fragmented duplicates that are hard to query and correlate.

## What We'll Build

A new **Schema Fragmentation Analyzer** — a backend action + UI panel that automatically:

1. **Detects duplicate/overlapping table groups** by analyzing table names, column schemas, and shared join keys
2. **Quantifies fragmentation** (how many tables serve the same domain, total wasted rows, schema drift)
3. **Recommends consolidation targets** (which tables can be merged into canonical sources)
4. **Produces an actionable consolidation report** with SQL migration paths

## Technical Approach

### Step 1: New `schemaFragmentationAnalysis` action in neon-query

Add to `handlers5.ts` (or a new `handlers7.ts` if size requires it). The action will run these queries:

- **Name-similarity clustering**: Group tables by prefix/keyword (e.g., all tables containing `flight`, `detection`, `biometric`, `aircraft`, `registry`, `shell`, `legal`, `forensic`, `ocr`, `screenshot`)
- **Column-overlap scoring**: For each cluster, compute Jaccard similarity of column sets to identify near-duplicate schemas
- **Row distribution analysis**: Flag clusters where data is spread across many small tables vs one large canonical table
- **Staleness detection**: Identify tables with zero rows or no recent writes (using `pg_stat_user_tables.last_autoanalyze`)
- **Join key audit**: Check which tables share `registration`, `icao_code`, `timestamp` columns but aren't linked

### Step 2: New `SchemaFragmentationPanel` UI component

A dashboard panel showing:
- **Cluster cards**: Groups of related tables with overlap scores, total rows, and recommended canonical target
- **Fragmentation score**: 0–100 per domain (surveillance, biometric, legal, etc.)
- **Empty table list**: Tables with 0 rows that can be safely dropped
- **Consolidation recommendations**: "Merge X into Y" with column mapping diffs

### Step 3: Wire into the Data Tools page

Add the panel to the existing Data Tools or Knowledge Engine page alongside the Schema Discovery Dashboard.

## Files to Create/Edit

| File | Change |
|------|--------|
| `supabase/functions/neon-query/handlers5.ts` (or new `handlers7.ts`) | Add `schemaFragmentationAnalysis` action with clustering + overlap queries |
| `supabase/functions/neon-query/index.ts` | Register the new action |
| `src/components/dashboard/SchemaFragmentationPanel.tsx` | New UI component |
| `src/pages/DataTools.tsx` | Add the panel |

## Key SQL Logic (Backend)

```text
1. Cluster tables by keyword families:
   - flight/detection/tracking → "Surveillance" cluster
   - biometric/heart/hrv/stress → "Biometric" cluster
   - aircraft/registry/faa/fleet → "Aircraft Registry" cluster
   - shell/company/operator → "Entity" cluster
   - legal/violation/exhibit → "Legal" cluster
   etc.

2. For each cluster, compute column overlap:
   SELECT a.table_name, b.table_name,
     COUNT(shared_cols) / COUNT(all_cols) as jaccard
   FROM information_schema.columns ...

3. Flag fragmentation:
   - Clusters with 5+ tables → HIGH fragmentation
   - Tables with <100 rows alongside a >10K row canonical → merge candidate
   - Tables with identical column sets → definite duplicates

4. Staleness check via pg_stat_user_tables:
   - last_autoanalyze IS NULL or > 30 days ago
   - reltuples = 0
```

## Outcome

You'll get a single panel that shows exactly which tables are duplicates, which are empty, and a clear path to consolidate — without touching any data until you approve.

