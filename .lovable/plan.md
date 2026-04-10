

# Full Archive Connection Engine — Unifying 1000+ Neon Tables

## The Problem You're Describing

Your archive grew organically — built in real-time under pressure. Tables got recreated instead of continued. Detection data is spread across `live_flight_detections`, `live_flight_detections_rows`, `adsb_exchange`, `aircraft_detections`, `unfiltered_detections`, and more. Same pattern repeats for biometrics, correlations, OCR, legal, KCSO, operator, and registry data. The connective tissue between these fragments is the real power of the archive, but right now nothing stitches them together automatically.

## What This Plan Builds

A **Universal Table Registry + Auto-Linker** that catalogs every table in Neon, classifies it by domain, identifies shared join keys, and creates a master linkage map. Then a UI dashboard lets you see the full picture and run cross-domain queries without writing SQL.

---

## Technical Design

### Step 1: New Edge Function Action — `fullArchiveCensus`

Add to `handlers6.ts` a new action that:
1. Queries `pg_class` + `information_schema.columns` for ALL 1000+ tables (no LIMIT)
2. For each table, records: name, row count, columns, size
3. Identifies shared join keys across tables (registration, icao_code, hex_id, callsign, tail_number, n_number, operator, entity_id, forensic_event_id, detection_id, session_id, timestamp columns)
4. Auto-classifies tables into domains: Flight Detection, Biometric, Correlation, OCR/Visual, Legal/ADA/RICO, KCSO, Aircraft Registry, Operator, Agent/Josiah, Forensic, Shell Company, Military, Infrastructure
5. Flags duplicate/fragmented table clusters (e.g., tables sharing 80%+ column overlap)
6. Returns a complete archive manifest with linkage density scores

### Step 2: New Edge Function Action — `crossDomainQuery`

A smart query builder that:
- Takes a domain pair (e.g., "flight + biometric" or "KCSO + military")
- Automatically identifies the best join key between them
- Runs a temporal or identity-based JOIN with configurable windows
- Returns linked records showing the connective tissue

### Step 3: Archive Manifest Dashboard (New Component)

`ArchiveManifestDashboard.tsx` — a full-page view showing:
- **Domain Map**: Visual grid of all 13+ domains with table counts and record totals
- **Linkage Matrix**: Which domains connect to which, via what keys, with how many linkable records
- **Fragmentation Alerts**: Tables that look like duplicates or re-creations, with merge recommendations
- **Cross-Domain Explorer**: Pick two domains, see the join keys, preview linked records
- **Total Archive Stats**: Every table, every record, every connection — the full picture

### Step 4: Add to Navigation

Add "Archive Manifest" as a new page accessible from the sidebar, or integrate into the existing `/data-tools` or Knowledge Engine page.

---

## What This Achieves

- **No table left behind**: Every one of the 1000+ tables is cataloged and classified
- **Connective tissue visible**: You can see exactly which tables link to which, and through what keys
- **Fragmentation exposed**: Duplicate tables from real-time rebuilds are identified and flagged for consolidation
- **Cross-domain power unlocked**: Flight data connects to biometrics connects to KCSO connects to military — through the actual shared keys in the data
- **Non-technical operation**: No SQL required — click domains, see connections, explore linked records

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/neon-query/handlers6.ts` | Add `fullArchiveCensus` and `crossDomainQuery` actions |
| `supabase/functions/neon-query/index.ts` | Register new actions in HANDLER6_ACTIONS |
| `src/components/dashboard/ArchiveManifestDashboard.tsx` | New component — full archive visualization |
| `src/pages/DataTools.tsx` | Add ArchiveManifestDashboard tab |

