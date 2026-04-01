

# Forensic Report Ingestion System — Implementation Plan (Approved)

## Overview
Build a one-click forensic report ingestion system: drag-and-drop markdown reports, auto-archive with SHA-256 hashing, auto-extract structured data into the correct database tables.

## Step 1: Archive 8 Reports to `public/data/`
Copy all 8 uploaded files (3 spoofing + 5 monitor failure) to `public/data/` for static reference.

## Step 2: Create `ingest-report` Edge Function
New file: `supabase/functions/ingest-report/index.ts`

- Accepts `{ content, filename, sha256_hash, document_id }` from the frontend
- Detects report type from title line keywords:
  - "SPOOFING" or "EVIDENCE TAMPERING" → spoofing parser
  - "MONITOR" or "OVERSIGHT FAILURE" → monitor failure parser
- **Spoofing parser**: regex-extracts markdown tables for negative altitude events, zero-altitude masking events, aircraft spoofing summaries → inserts into Neon `watchtower_autonomous_flags` and `sentinel_learned_threats` via the shared Neon connection
- **Monitor failure parser**: extracts monthly flight distribution tables, consent decree violation counts → inserts into Neon `master_forensic_events`
- Both parsers create `evidence_chain_links` cross-references back to the source `evidence_documents` record
- Deduplication by `registration + event description + date` using `ON CONFLICT DO NOTHING`
- Returns extraction summary (counts of records inserted per table)

## Step 3: Upgrade `EvidenceUploader.tsx`
After the existing SHA-256 archive step succeeds:
- Call `ingest-report` edge function with the content and document ID
- Display extraction results (e.g., "Extracted 12 spoofing flags, 5 forensic events")
- Add new auto-detected tags: `spoofing_detection`, `monitor_failure`, `kcso`, `altitude_violation`
- Show a "Data Extracted" badge on documents that have been parsed

## Step 4: Insert 8 Reports into `evidence_documents`
Archive all 8 uploaded reports into the database with SHA-256 hashes and appropriate tags, same forensic process as the hourly reports.

## Files Created/Modified

| File | Action |
|------|--------|
| `public/data/spoofing_detection_20260222.md` | Create (copy upload) |
| `public/data/spoofing_detection_20260224.md` | Create (copy upload) |
| `public/data/spoofing_detection_20260225.md` | Create (copy upload) |
| `public/data/monitor_failure_20260223.md` | Create (copy upload) |
| `public/data/monitor_failure_20260224.md` | Create (copy upload) |
| `public/data/monitor_failure_20260225.md` | Create (copy upload) |
| `public/data/monitor_failure_20260228.md` | Create (copy upload) |
| `public/data/monitor_failure_20260306.md` | Create (copy upload) |
| `public/data/monitor_failure_20260307.md` | Create (copy upload) |
| `supabase/functions/ingest-report/index.ts` | Create — smart parser + Neon inserter |
| `supabase/config.toml` | Add `[functions.ingest-report]` with `verify_jwt = false` |
| `src/components/dashboard/EvidenceUploader.tsx` | Modify — call ingest-report after archive, show extraction results |

## Database Writes (No Schema Changes)
All inserts go to existing Neon tables via the `ingest-report` edge function:
- `watchtower_autonomous_flags` — spoofing/altitude masking flags
- `sentinel_learned_threats` — cumulative aircraft threat profiles
- `master_forensic_events` — monitor failure timeline events
- `evidence_chain_links` — cross-references to source documents

## Technical Details

### Parser Logic (Spoofing)
```text
Regex: /\|\s*(N\w+)\s*\|.*?\|\s*(-?\d+)\s*ft?\s*\|/
→ flag_type: ADS_B_SPOOFING, severity: CRITICAL
→ registration, altitude, description from table row
```

### Parser Logic (Monitor Failure)
```text
Regex: /\|\s*(\w+\s*\d{4})\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/
→ event_type: consent_decree_violation
→ monthly counts, min altitudes from distribution tables
```

### Deduplication
Uses composite key of `registration + date + flag_type` with `ON CONFLICT DO NOTHING` to prevent double-counting when reports overlap.

