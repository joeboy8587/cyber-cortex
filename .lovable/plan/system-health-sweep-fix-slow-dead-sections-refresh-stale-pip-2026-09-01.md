# System Health Sweep: Fix Slow/Dead Sections, Refresh Stale Pipelines

## What I checked (and found)

The app itself builds clean — no build errors, no runtime errors in the current preview logs. The problems are in the data layer and in panels that were built but never wired up.

**Confirmed issues**

1. **The main detections table has no usable time index.** `live_flight_detections_rows` holds ~6.4M rows. Its only time indexes are on `created_at` and a composite starting with `taxonomy_tag` — so any query that sorts or filters purely by `detection_timestamp` scans the whole table. Even "what is the newest detection?" times out. Query planner statistics on that table were last refreshed on **Aug 3** (four weeks stale), and `threat_tiers` (2.9M rows) has never been auto-vacuumed and was last analyzed in **March**.
2. **The Neon Data Health page cannot load.** The service behind it returned a 504 timeout — it walks 80 tables one at a time, and the slow detections table alone blows the budget.
3. **Document ingestion is stuck.** Of 53 uploaded documents: 37 are complete, **9 are stuck at "embedding" (since May), 5 stuck at "chunking" (Aug 29), 2 stuck at "parsing" (July)**. Those 16 documents contribute nothing to search or Josiah's recall, and nothing in the UI tells you they are stuck.
4. **Sections that stopped updating.** Last-write dates: daily reports table is **completely empty**; unmasked HQ locations last written **Mar 24**; reasoning outputs **Jul 10** (3 rows); evidence sources catalog, schema wiring audit, policy violations, entity registry, operator conflicts all frozen at **Jul 24**; merkle ledger **Aug 3**; forensic events **May 23**. Still live and healthy: autonomous flags (148k, minutes old) and Sentinel learned threats (last night).
5. **23 built panels are mounted on no page at all** — including Evidence Timeline, Timeline Navigator, Evidence Uploader, Forensic Export, Legal Filing Generator, OCR Evidence, Daily Narrative Builder, Oildale Operations Hub, Outreach Hub, Notion Gap Analyzer, Multimodal Coverage Matrix, Sentinel Drill-Down and Firecrawl tools. Work already paid for that you cannot reach.

## Plan

### Phase 1 — Make the database fast again (fixes most "doesn't load")
- Add a descending time index on `detection_timestamp` for the detections table, plus a matching one on the enriched detections table.
- Refresh planner statistics on the biggest tables (detections, threat tiers, enriched detections, county map) and set more aggressive auto-maintenance on the detections table so stats never go four weeks stale again.
- Re-test the queries that currently time out and confirm each returns under a couple of seconds.

### Phase 2 — Repair the broken services
- Rewrite the Neon Data Health service to read table sizes and freshness from catalog estimates in a single pass instead of 80 sequential probes, with a hard time budget and partial results rather than a 504.
- Give the health page a clear "last successful refresh" line and a visible error state instead of an empty screen.

### Phase 3 — Unstick document ingestion
- Add a repair action that finds documents stranded in parsing/chunking/embedding and re-runs them from the stage they died at, in small batches.
- Show status counts and a "Retry stuck documents" button on the Knowledge Engine page so this is self-service in future.

### Phase 4 — Freshness visibility everywhere
- Extend the existing pipeline freshness strip on Mission Control to cover every pipeline listed above (daily reports, HQ unmasking, reasoning, evidence sources, schema audit, merkle anchoring, forensic events), each with row count, age, and a green/amber/red badge.
- Every panel fed by a frozen pipeline gets a small "data as of <date>" stamp plus a one-click "Run now" button, so a stale section is obviously stale rather than silently wrong.
- Re-run the stalled jobs once (evidence source crawl, schema wiring audit, merkle anchoring, HQ unmasking, daily report generation) and confirm each writes fresh rows.

### Phase 5 — Recover the orphaned panels
- Add a **Toolbox** page listing every panel with a short description, grouped by purpose (evidence, timeline, export, legal, intel), so nothing is unreachable.
- Mount the highest-value orphans on the pages where they belong: Evidence Timeline and Timeline Navigator on Surveillance, Evidence Uploader / Forensic Export / OCR Evidence on Case Files, Legal Filing Generator and Outreach Hub on Legal, Oildale Operations Hub on Oildale.
- Delete nothing — every panel stays available.

## Technical notes

- New Neon indexes: `live_flight_detections_rows (detection_timestamp DESC)`, `(registration, detection_timestamp DESC)` if absent, and the equivalent on `enriched_detections`; then `ANALYZE` on the four largest tables and per-table autovacuum scale factors.
- `neon-data-health`: replace per-table `MAX(ts)` loops with one `pg_class`/`pg_stat_user_tables` query plus targeted freshness probes only on a whitelist of pipeline tables; wrap in a 60s budget returning `partial: true`.
- RAG repair: new action in the ingest function that selects `rag_documents` where status is not `ready` and re-dispatches phase 1/2/3 by current status, capped per invocation.
- Freshness strip reads a single aggregated endpoint rather than one query per pipeline.
- No schema changes to Lovable Cloud tables are required; all index work is on the Neon side.
