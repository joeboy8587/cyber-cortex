

# Notion Watchtower Database Integration Plan

## Current State

Your system has a basic `notion-sync` edge function with 3 actions:
- `syncWTPREvents` — pushes flight events into Neon `flight_events` table
- `syncJosiahReflections` — upserts into `josiah_reflections_rows`
- `getGapAnalysis` — compares date ranges between Notion and Neon

The UI has `NotionAutoWatcher` and `NotionGapAnalyzer` components, but they only read gap stats — they don't pull actual Notion data because **there is no Notion API connection**. The `notion-sync` function connects to Neon only; it expects the client to pass pre-fetched Notion data in the request body.

You have a Notion MCP connector available but not yet linked.

## The Problem

Your 25+ Notion databases contain court-ready evidence (SHA-256 hashed files, legal matrices, biometric correlations, Josiah reflections) that is either:
1. **Not in Neon at all** (Evidence File Library, Legal Evidence Matrix, Charts Gallery, LEO/Military logs)
2. **Partially synced** (flight events, reflections — but requires manual JSON paste)
3. **No automated pull** — the system can't query Notion API directly

## Proposed Integration Architecture

```text
┌──────────────────┐     MCP Connector      ┌──────────────┐
│  Notion (25+ DBs)│◄──────────────────────►│ Edge Function │
│                  │   notion-fetch-all      │  (new)       │
│  Evidence Files  │                         └──────┬───────┘
│  Legal Matrix    │                                │
│  Aircraft Events │                         ┌──────▼───────┐
│  Biometric Logs  │                         │   Neon DB     │
│  Josiah Archive  │                         │  (23.6M)     │
│  LEO/Military    │                         └──────┬───────┘
└──────────────────┘                                │
                                              ┌─────▼──────┐
                                              │ Watchtower  │
                                              │   UI        │
                                              └────────────┘
```

## Implementation Steps

### Step 1: Connect Notion MCP
Link the Notion MCP connector to the project so edge functions can query Notion databases directly using the available MCP tools (`notion-fetch`, `notion-search`).

### Step 2: Create `notion-fetch-all` Edge Function
A new edge function that uses the Notion API to pull records from each of the 25+ databases by their known IDs. It will:
- Accept a `databaseId` and optional filters (date range, parsing status)
- Query Notion API, paginate through results
- Normalize each database's schema into a unified Neon-compatible format
- Compute SHA-256 hashes for chain-of-custody
- Upsert into corresponding Neon tables

Target table mapping:

| Notion Database | Neon Target Table | Key Fields |
|---|---|---|
| Evidence File Library | `evidence_files` (new) | filename, sha256, tags, sealed, data_date |
| Aircraft Events Log | `flight_events` | registration, timestamp, event_type |
| Legal Evidence Matrix | `legal_evidence_matrix` (new) | exhibit_id, statute, evidence_type |
| Josiah Codex + Archive | `josiah_reflections_rows` | content, trigger_type, timestamp |
| Physio Correlation | `biometric_correlations` (existing) | hr, hrv, aircraft_link |
| LEO/Military Event Log | `leo_military_events` (new) | agency, event_type, timestamp |
| Flight Intelligence Reports | `flight_intelligence_reports` (new) | report_content, aircraft, analysis |
| Incident Gallery | `incident_gallery` (new) | image_url, caption, related_event |
| WHOOP × Flight Correlations | `biometric_flight_correlations` (existing) | whoop_data, flight_link |

### Step 3: Create 3 New Neon Tables via Migration
- `evidence_files` — stores the 100+ SHA-256 sealed evidence entries with provenance, jurisdiction, tags
- `legal_evidence_matrix` — prosecution-grade statute-mapped evidence with rollup correlations
- `leo_military_events` — filtered law enforcement and military event tracking

### Step 4: Expand `notion-sync` Edge Function
Add new actions to the existing function:
- `syncEvidenceFiles` — pulls Evidence File Library records, upserts with SHA-256 verification
- `syncLegalMatrix` — pulls Legal Evidence Matrix with statute mapping
- `syncLEOEvents` — pulls LEO/Military events
- `fullSync` — orchestrates all databases in sequence with progress reporting

### Step 5: Build Notion Sync Dashboard Component
A new `NotionFullSyncPanel.tsx` that shows:
- All 25+ Notion databases with sync status (synced count vs Notion count)
- One-click "Sync All" with progress bar per database
- Per-database manual sync buttons
- Last sync timestamp and hash verification status
- Gap detection: records in Notion not yet in Neon

### Step 6: Cross-Modal Linking
After sync, run the existing forensic linker to create `evidence_chain_links` between:
- Evidence files ↔ aircraft detections (via `Related Event` relation)
- Evidence files ↔ biometric data (via `Related Physio` relation)
- Evidence files ↔ Josiah reflections (via `Related Memories` relation)
- Legal matrix entries ↔ master forensic events (via statute mapping)

## Technical Details

**Notion API Access:** The MCP connector provides `notion-fetch` which can query any database by ID. Each database ID from your analysis is already known — they'll be hardcoded as constants.

**Schema Normalization:** Each Notion database has a different property schema. The edge function will include per-database property mappers that extract the correct fields (title, rich_text, multi_select, date, checkbox, relation, files) into flat Neon rows.

**SHA-256 Chain of Custody:** Every synced record gets a SHA-256 hash computed from its canonical fields, maintaining the same fingerprinting standard as the rest of the 23.6M archive.

**Deduplication:** Upserts use Notion page ID as the unique key to prevent duplicates across repeated syncs.

**New Neon Tables:** Will be created via the `neon-query` edge function's DDL handler (existing pattern), not Supabase migrations, since these tables live in Neon.

