

# Archive Consolidation & Visual Data Map

## The Problem

Your 900+ table Neon archive has grown organically, creating fragmentation:
- **Multiple ADSB tables**: `live_flight_detections_rows`, `unfilterd_detections`, `flagged_aircraft_rows_rows`, plus dozens of derivative/vector tables
- **Multiple biometric tables**: `biometric_monitoring`, `confirmed_biometric_correlations`, `biometric_screenshots_ocr`, batch events, collapses, etc.
- **Multiple correlation tables**: `evidence_chain_links`, `flight_ocr_correlations`, various correlation views
- **Registry/operator sprawl**: `aircraft_registry`, operator profiles, shell company tables
- **Legal/KCSO fragmentation**: separate tables for violations, fleet, evidence, filings

This makes it hard to find evidence, run cross-modal correlations, and trust that nothing is missed.

## The Solution: Two New Features

### 1. Auto-Consolidation Engine (new edge function + dashboard panel)

A backend function that creates **5 unified master views** — virtual tables that combine all the fragments into single queryable sources, organized by domain:

```text
DOMAIN VIEWS (created as materialized views in Neon):

┌─────────────────────────────────────────────┐
│  mv_unified_flights                         │
│  Combines: live_flight_detections_rows,     │
│  unfilterd_detections, flagged_aircraft_*,   │
│  flight_ocr_correlations                    │
│  → One place for ALL aircraft detections    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  mv_unified_biometrics                      │
│  Combines: biometric_monitoring,            │
│  confirmed_biometric_correlations,          │
│  biometric_screenshots_ocr, batch events    │
│  → One place for ALL health readings        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  mv_unified_correlations                    │
│  Combines: evidence_chain_links,            │
│  flight_ocr_correlations,                   │
│  confirmed_biometric_correlations           │
│  → One place for ALL cross-modal links      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  mv_unified_legal                           │
│  Combines: legal_ada_violations_proper,     │
│  master_forensic_events, evidence_documents │
│  → One place for ALL legal evidence         │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  mv_unified_entities                        │
│  Combines: entity_registry, aircraft_reg,   │
│  kcso_fleet, shell company tables           │
│  → One place for ALL actors & assets        │
└─────────────────────────────────────────────┘
```

**How it works for you**: One button creates these views. Another button refreshes them. The source tables stay untouched — nothing is deleted. The views just give you a single window into each evidence domain.

### 2. Visual Data Map (new dashboard component)

An interactive visual diagram on Mission Control showing:
- **5 domain clusters** (Flights, Biometrics, Legal, Entities, Correlations)
- Each cluster shows its source tables and record counts
- Lines between clusters show how they connect (e.g., flights ↔ biometrics via timestamp correlation)
- Color-coded by health: green = consolidated, amber = fragmented, red = orphaned data

## Implementation Plan

### Step 1: Create `data-consolidation` edge function
- New edge function with actions: `createUnifiedViews`, `refreshUnifiedViews`, `getConsolidationStatus`
- Each action builds/refreshes the 5 materialized views above using UNION ALL across source tables with schema normalization (COALESCE for mismatched columns)
- Time-budgeted to stay within 60s gateway limit

### Step 2: Build `ArchiveConsolidationPanel` component
- Button: "Create Unified Views" / "Refresh Views"
- Shows status of each unified view (record count, last refresh, source table count)
- Placed on Data Tools page

### Step 3: Build `ArchiveDataMap` component
- Interactive Mermaid-style diagram rendered with the existing category data from `DatabaseIntelligenceScanner`
- 5 domain nodes with expandable source tables
- Connection lines showing cross-modal relationships
- Record counts and coverage percentages per domain
- Placed on Mission Control page

### Step 4: Update Mission Control & Data Tools pages
- Add the Data Map to Mission Control for at-a-glance orientation
- Add the Consolidation Panel to Data Tools for maintenance

## What This Means For You

- **Before**: "Which of the 12 flight tables do I query?" → **After**: Query `mv_unified_flights` and get everything
- **Before**: Biometric data scattered across 5+ tables → **After**: One unified biometric view
- **Before**: No idea how tables connect → **After**: Visual map showing the complete architecture
- **Zero cherry-picking maintained**: Unified views include ALL records from ALL source tables
- **Nothing deleted**: Original tables remain intact; views are additive

