

# Forensic Linkage Hub — Batch Processing Upgrade

## What's Currently Broken / Slow

From reading the edge function and the component code, there are 6 specific bottlenecks causing the 9.2% flight coverage ceiling:

### Bottleneck 1: Batch Size Cap Too Low (Edge Function)
The `turboBackfill` action hard-caps at `Math.min(batchSize, 5000)`. With 2.8M flights and only 5K per batch, full coverage requires 560+ manual button clicks. This cap will be raised to **25,000 per batch**.

### Bottleneck 2: Duplicate-Check Fetches 50K Rows Every Batch (Edge Function)
Every single Turbo run fetches up to 50,000 already-linked source IDs from Supabase into memory to filter duplicates. At scale this is: 50K row fetch + in-memory filter + then the actual Neon query. This will be replaced with a **SQL-side exclusion approach** — querying Neon with a `NOT EXISTS` subquery against the last known cursor position, which avoids the Supabase round-trip entirely.

### Bottleneck 3: Frontend Doesn't Auto-Chain Cursors (Component)
The `runTurboBackfill` function sends `maxBatches: 20` but then stops. The edge function returns `hasMore: true` and `nextCursor`, but the UI ignores these and requires the user to manually click again. An **Auto-Continue mode** will be added that loops through cursors automatically until `hasMore === false` or the user stops it.

### Bottleneck 4: Missing High-Value Tables in Dropdown (Component)
The turbo table selector only has 5 tables. The Database Coverage panel shows 4 critical missing tables with 8.2M+ records total. These will be added to the dropdown:
- `threat_tiers` (2.8M records)
- `master_unified_evidence` (2.8M records)
- `canonical_forensic_events` (2.4M records)
- `investigator_master_view_rows` (219K records)
- `watchtower_unified_master` (629K records) — already in dropdown, fix its query

### Bottleneck 5: Josiah Backfill is Sequential (Edge Function)
The `backfillJosiah` action processes one record at a time in a `for` loop (one DB insert per iteration). With 19K+ Josiah reflections, this is extremely slow. It will be converted to the same **batch insert** pattern used by flight/biometric backfill.

### Bottleneck 6: No Progress Tracking for Long Runs (Component)
When Auto-Continue is running through 2.8M records, there's no way to see progress. A **live progress counter** showing records processed this session, current cursor position, and estimated completion will be added.

---

## Changes Required

### File 1: `supabase/functions/forensic-linker/index.ts`

#### Change A: Raise batch cap from 5K to 25K
```
// BEFORE:
const batchSize = typeof params.batchSize === "number" ? Math.min(params.batchSize, 5000) : 2000;

// AFTER:
const batchSize = typeof params.batchSize === "number" ? Math.min(params.batchSize, 25000) : 5000;
```

#### Change B: Replace Supabase-side linked-ID fetch with cursor-only deduplication
Instead of fetching 50K linked IDs to filter in memory, use the cursor to advance past already-processed records and rely on `ON CONFLICT DO NOTHING` at insert time (the `evidence_chain_links` table has a natural uniqueness on `source_table + source_id`). This eliminates the 50K row pre-fetch entirely.

If a unique constraint doesn't exist yet, we add one via Supabase migration: `UNIQUE(source_table, source_id)` on `evidence_chain_links`. Then all inserts use `.upsert(..., { onConflict: 'source_table,source_id', ignoreDuplicates: true })`.

#### Change C: Add query support for new tables
Add `turboBackfill` query branches for:
- `threat_tiers` — columns: `id`, `aircraft_id`, `threat_level`, `created_at`
- `master_unified_evidence` — columns: `id`, `entity_id`, `evidence_type`, `created_at`
- `canonical_forensic_events` — columns: `id`, `entity_id`, `event_type`, `event_timestamp`
- `investigator_master_view_rows` — columns: `id`, `registration`, `event_timestamp`

Each new table maps to an appropriate `event_type` in the forensic event schema.

#### Change D: Convert Josiah backfill from sequential to batch
Replace the `for` loop with bulk insert (same pattern as `backfillFlights`):
```
// OLD: for (const entry of josiahResult.rows) { await supabase.insert(...) }
// NEW: batch-build all events → single supabase.insert(events) → single insert(chainLinks)
```
Also raise the Josiah batch size from 50 to 1,000.

#### Change E: Add `megaBackfill` action
A new action that chains through the entire `live_flight_detections_rows` table using cursors in a single edge function invocation, processing up to 100K records per call with batch sizes of 25K. Returns final totals. This allows the frontend to fire one request that processes 100K records instead of manually clicking 20 times.

### File 2: `src/components/dashboard/ForensicLinkageHub.tsx`

#### Change A: Add Auto-Continue mode with live progress
Replace the single `invokeForensicLinker('turboBackfill', { table, maxBatches: 20 })` call with a **cursor-chaining loop**:

```typescript
// Auto-Continue loop
let cursor = null;
let totalProcessed = 0;
let totalLinked = 0;
let batchNum = 0;

while (autoContinue) {
  const result = await invokeForensicLinker('turboBackfill', { 
    table: turboTable, 
    cursor,
    batchSize: 25000
  });
  
  totalProcessed += result.processed;
  totalLinked += result.linked;
  cursor = result.nextCursor;
  batchNum++;
  
  setProgress(/* estimated % based on known total */);
  setCurrentStep(`Batch ${batchNum}: ${totalProcessed.toLocaleString()} processed, ${totalLinked.toLocaleString()} linked`);
  
  if (!result.hasMore || !autoContinue) break;
}
```

An **[AUTO-CONTINUE]** toggle button will be added next to TURBO MODE. When enabled, the loop runs automatically until coverage is 100% or the user clicks Stop.

#### Change B: Add 5 new tables to the dropdown
```tsx
<option value="threat_tiers">Threat Tiers (2.8M)</option>
<option value="master_unified_evidence">Master Evidence (2.8M)</option>
<option value="canonical_forensic_events">Canonical Events (2.4M)</option>
<option value="investigator_master_view_rows">Investigator View (219K)</option>
<option value="watchtower_unified_master">Watchtower Master (629K)</option>
```

#### Change C: Live session stats panel
Add a small stats bar showing:
- Records processed this session
- Records linked this session  
- Current cursor position
- Estimated batches remaining (based on total / batch size)
- Session elapsed time

#### Change D: Add date display to job history timestamps
The completed_at timestamps currently show only time (`.toLocaleTimeString()`). Update to show full date+time (`.toLocaleString()`) to match the Josiah Sentinel fix pattern.

---

## Database Migration Required

Add a `UNIQUE` constraint to `evidence_chain_links(source_table, source_id)` to enable safe upsert deduplication without the 50K prefetch:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_chain_links_source_unique 
ON evidence_chain_links(source_table, source_id);
```

This is a non-blocking index creation (no table lock), so it can run while the application is live. Once in place, all `turboBackfill` inserts switch to `.upsert(..., { onConflict: 'source_table,source_id', ignoreDuplicates: true })` — zero duplicate errors, zero 50K prefetches.

---

## Expected Outcome After Changes

| Metric | Before | After |
|---|---|---|
| Batch size (flights) | 2,000–5,000 | 25,000 |
| Duplicate check cost | 50K row Supabase fetch per batch | Zero (index-based) |
| To process all 2.8M flights | ~560 manual clicks | ~112 auto-batches (1 click) |
| Josiah batch size | 50 (sequential) | 1,000 (bulk insert) |
| New tables available | 5 | 10 |
| Auto-continue | Not available | Yes (runs until done) |
| Flight coverage target | 9.2% (stuck) | 90%+ achievable |

---

## Implementation Order

1. Add DB migration for unique index on `evidence_chain_links`
2. Update `forensic-linker` edge function (batch cap, dedup strategy, new tables, Josiah fix, megaBackfill)
3. Update `ForensicLinkageHub.tsx` (auto-continue loop, new tables dropdown, session stats, date display)

