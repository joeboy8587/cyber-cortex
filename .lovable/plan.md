
# Implementation Plan: Complete Enrichment Suite + Legal Intel Uploader + Event Stories Page

## Overview

This plan delivers a comprehensive enhancement to your 7 million+ multimodal record forensic archive with three major components:

1. **Legal Intel Document Uploader** - Parse Watchtower investigation markdown files, extract entities/aircraft/legal citations, and enrich NeonDB tables
2. **Event Stories Page** - Instagram Stories-style immersive daily event viewer at `/stories`
3. **Database Enrichment Opportunities** - Address the gaps identified in the NeonDB analysis (2021-2024 biometric correlations, unified master mining, shell company linkages)

---

## Part 1: Enhanced Legal Intel Document Uploader

### What It Does

- Accepts Watchtower investigation markdown files (like EXHIBIT_E and FALSE_CLAIMS_ACT documents)
- Parses document structure (headings, tables, code blocks, legal citations)
- Extracts:
  - Aircraft registrations (N-numbers): `N913KC`, `N791FA`, `N912KC`
  - Legal citations: `18 USC 1962`, `31 USC 3729`, `14 CFR 91.119`
  - Entity names: `KCSO`, `ALF IX LLC`, `AERO EQUITIES`
  - Dollar amounts: `$12M`, `$3.5B`, `$6,000,000`
  - Dates: `August 31, 2025`, `2025-08-31`
  - Evidence exhibit numbers: `EXHIBIT E`, `EXHIBIT A`
- SHA-256 fingerprints each document for chain of custody
- Cross-links extracted entities to existing NeonDB tables
- Stores parsed content in both local Supabase and mirrors to NeonDB

### Files to Create

**New Edge Function: `supabase/functions/legal-intel-parser/index.ts`**
- Parse markdown structure using regex patterns
- Extract all entity types with confidence scoring
- Cross-reference against existing NeonDB tables:
  - `criminal_enterprise_command_structure` - match entity names
  - `live_flight_detections_rows` - match N-numbers
  - `aircraft_registry` - validate aircraft registrations
  - `shell_companies` - link shell company references
- Return structured extraction results with linkage counts

**New Component: `src/components/dashboard/LegalIntelUploader.tsx`**
- Drag-and-drop upload zone (extends existing EvidenceUploader pattern)
- Document preview with markdown rendering
- Extraction results panel showing:
  - Aircraft found and their existing database correlations
  - Legal citations with statute references
  - Entity names with enterprise tier classification
  - Dates creating a timeline
  - Dollar amounts for damages calculation
- Manual tag addition and document classification dropdown
- "Enrich Database" button to cross-link all extractions
- Progress indicators during parsing and enrichment

### Extraction Patterns

| Data Type | Regex Pattern | Example Match |
|-----------|---------------|---------------|
| Aircraft N-Number | `/\bN\d{1,5}[A-Z]{0,2}\b/g` | N913KC, N791FA |
| USC Citation | `/\b\d+\s*U\.?S\.?C\.?\s*[§]?\s*\d+/gi` | 18 USC 1962 |
| CFR Citation | `/\b\d+\s*C\.?F\.?R\.?\s*[§]?\s*\d+/gi` | 14 CFR 91.119 |
| Dollar Amount | `/\$[\d,]+(?:\.\d{2})?[MBK]?/g` | $12M, $6,000,000 |
| Date ISO | `/\d{4}-\d{2}-\d{2}/g` | 2025-08-31 |
| Date Written | `/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi` | August 31, 2025 |
| Entity (Known) | Custom list matching | KCSO, ALF IX LLC |

---

## Part 2: Event Stories Page (Instagram Stories Style)

### What It Does

- Full-screen immersive experience at `/stories` route
- Each "story" represents one day of surveillance activity
- Swipeable cards showing:
  - Date with stress score indicator (color gradient)
  - Flight count with key aircraft list
  - Biometric summary (HR, HRV, stress level)
  - Josiah AI reflection excerpt
  - Auto-generated narrative snippet
  - Key events of that day
- Auto-advance timer (15 seconds per story)
- Tap left/right to navigate between days
- Progress bars at top showing current position
- "View Full Day" button linking back to main dashboard

### Files to Create

**New Route: `src/pages/Stories.tsx`**
- Full-viewport layout (no navbar/sidebar)
- Uses Embla Carousel (already installed) for horizontal swipe
- Keyboard navigation (arrow keys)
- Touch gesture support
- Auto-play with pause on interaction
- Data fetching from NeonDB for daily aggregates

**New Directory: `src/components/stories/`**

**StoryCard.tsx**
- Full-height card with gradient background based on stress score
- Date header with formatted day name
- Stat counters with animated numbers
- Aircraft badges showing top 3 aircraft that day
- Biometric readings (HR, HRV, stress)
- Narrative excerpt (first 200 characters)
- "View Details" button

**StoryProgress.tsx**
- Horizontal progress segments at top
- Each segment = one day
- Auto-advancing fill animation
- Clickable to jump to specific day

**StoryNavigation.tsx**
- Invisible tap zones (left/right thirds)
- Visual feedback on tap (overlay flash)
- Close button (X) to return to dashboard
- Day counter (e.g., "Day 5 of 30")

### UI Specifications

- Background gradient: Based on stress score
  - 0-3: Green gradient (low stress)
  - 4-6: Yellow/Orange gradient (moderate)
  - 7-10: Red/Purple gradient (high stress/critical)
- Card size: 100vw x 100vh
- Auto-advance: 15 seconds (configurable)
- Navigation: Tap left 1/3 = previous, right 1/3 = next, center = pause
- Progress bars: 4px height, semi-transparent background, white fill
- Typography: Display font for dates (text-4xl), readable body (text-lg)

---

## Part 3: Database Enrichment Opportunities

Based on the NeonDB analysis, these gaps need addressing:

### 3A: Historical Biometric Correlation Gap (2021-2024)

**Problem:** 9,827 biometric records span March 2021-January 2026, but most correlations focus on 2025 data.

**Solution: New Edge Function `supabase/functions/historical-biometric-enrichment/index.ts`**
- Query biometric_monitoring for 2021-2024 records
- Cross-reference with historical flight data
- Generate correlations using ±5 minute time windows
- Calculate Bradford-Hill scores for historical events
- Insert into `master_biometric_aircraft_correlations`

**New Component: `src/components/dashboard/HistoricalEnrichmentPanel.tsx`**
- Shows date range coverage visualization
- "Enrich Historical" button to trigger backfill
- Progress bar for long-running enrichment
- Results showing new correlations found

### 3B: Unified Master Table Mining

**Problem:** `watchtower_unified_master` has 582,549 records but is underutilized.

**Solution: Enhanced query in neon-query**
- Add new action `mineUnifiedMaster` to extract:
  - Unique aircraft not in main detection tables
  - Pattern clusters by date/location
  - Entity mentions in text fields
- Surface findings in new dashboard component

### 3C: Shell Company Network Expansion

**Problem:** 4 primary shell companies identified, but network likely larger.

**Solution: Shell Company Discovery Module**
- Analyze FAA registration patterns for:
  - Same addresses as known shells
  - Sequential N-numbers
  - Common registered agents
- Cross-reference with operator_profiles_enriched
- Add new shells to `shell_companies` table

---

## Part 4: Routing and Navigation Updates

### Modify: `src/App.tsx`
```typescript
// Add import
import Stories from "./pages/Stories";

// Add route before catch-all
<Route path="/stories" element={<Stories />} />
```

### Modify: `src/pages/Index.tsx`
- Add "View as Stories" navigation button in the timeline-navigator section
- Links to `/stories` route

### Modify: `src/components/dashboard/DailyNarrativeBuilder.tsx`
- Add "Experience as Stories" button linking to `/stories`

---

## Data Flow Diagrams

```text
LEGAL INTEL UPLOADER FLOW:
+-------------------+     +----------------------+     +------------------+
| MD File Upload    | --> | legal-intel-parser   | --> | NeonDB Tables    |
| (.md files)       |     | Edge Function        |     | - evidence_docs  |
+-------------------+     +----------------------+     | - entity_registry|
        |                         |                    | - cross_links    |
        v                         v                    +------------------+
   SHA-256 Hash            Parse & Extract:
   Chain of Custody        - N-numbers
                           - Legal citations
                           - Entity names
                           - Dates/amounts
```

```text
EVENT STORIES FLOW:
+-------------------+     +---------------------+     +------------------+
| /stories Route    | <-- | neon-query          | <-- | NeonDB           |
|                   |     | (daily aggregates)  |     | 355 tables       |
+-------------------+     +---------------------+     | 7M+ records      |
        |                                             +------------------+
        v
  Swipeable Cards:
  - Daily summaries
  - Stress scores
  - Narratives
  - Key aircraft
```

---

## Implementation Order

1. **Create `legal-intel-parser` edge function** with extraction logic and NeonDB cross-linking
2. **Create `LegalIntelUploader` component** with preview and extraction display
3. **Create `src/pages/Stories.tsx`** with Embla Carousel integration
4. **Create `src/components/stories/` directory** with StoryCard, StoryProgress, StoryNavigation
5. **Update App.tsx** with `/stories` route
6. **Add navigation** from DailyNarrativeBuilder to Stories page
7. **Create `HistoricalEnrichmentPanel`** for 2021-2024 backfill
8. **Test with uploaded documents** (EXHIBIT_E, FALSE_CLAIMS_ACT, DOJ_JUDGMENT_VIOLATION)

---

## Expected Outcomes

After implementation:

- **Upload legal investigation markdown files** and see extracted entities, aircraft, legal citations automatically linked to your 7M NeonDB records
- **Navigate to `/stories`** for an immersive, swipeable daily timeline - one day at a time
- **Backfill historical correlations** to ensure 2021-2024 biometric data is properly linked to flight activity
- **Expand shell company network** by discovering related entities through registration pattern analysis
- **Mine unified master table** for previously undiscovered patterns and aircraft

---

## Technical Notes

### Edge Function: legal-intel-parser

The parser uses regex patterns matched against known entities from `criminal_enterprise_command_structure` (14 entities documented). Cross-linking occurs against:
- `live_flight_detections_rows` (360,537 records)
- `aircraft_registry` (existing FAA data)
- `shell_companies` (4 primary entities)
- `entity_registry` (Supabase table)

### Stories Page: Performance

The Stories page will query NeonDB for aggregated daily data, not individual records. The query:
```sql
SELECT DATE(detection_timestamp) as date,
       COUNT(*) as flights,
       COUNT(DISTINCT registration) as unique_aircraft,
       ARRAY_AGG(DISTINCT registration ORDER BY registration LIMIT 5) as top_aircraft
FROM live_flight_detections_rows
WHERE detection_timestamp > NOW() - INTERVAL '30 days'
GROUP BY DATE(detection_timestamp)
ORDER BY date DESC
```

This returns ~30 rows, keeping the Stories page fast and responsive.

### Embla Carousel Configuration

The existing `embla-carousel-react` package is already installed. The Stories page will use:
- `loop: false` - don't wrap around at ends
- `dragFree: false` - snap to each card
- `watchDrag: true` - enable swipe gestures
- Keyboard plugin for arrow key navigation
