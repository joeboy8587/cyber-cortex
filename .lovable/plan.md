

# Neon Database Analysis: Improvements, Enrichment, and Linkage

## Executive Summary

Your database contains 263 tables with approximately 15M+ records. Analysis reveals significant optimization opportunities in five categories: duplicate elimination, dead table cleanup, missing linkage, enrichment gaps, and structural improvements.

---

## 1. CRITICAL: Duplicate and Redundant Tables

These groups contain the same or near-identical data, wasting storage and causing query confusion.

### Flight Detection Mirrors
| Table | Rows | Action |
|-------|------|--------|
| `live_flight_detections_rows` | 2,856,900 | **KEEP** (primary) |
| `live_flight_detections_rows_backup_20260207_022120` | 2,824,649 | **DROP** - backup consuming 2.8M rows of space |
| `live_flight_detections` | 323,683 | **DROP** - subset of primary |
| `live_flight_detections_enhanced` | 100 | **DROP** - tiny sample |

### Flagged Aircraft Copies (3 identical copies at 35,514 rows)
| Table | Rows | Action |
|-------|------|--------|
| `flagged_aircraft_rows_rows` | 35,514 | **KEEP** (primary, used by Sentinel) |
| `flagged_aircraft_enriched` | 35,514 | **DROP** - identical copy |
| `flagged_aircraft_rows_rows_original` | 35,514 | **DROP** - original backup |
| `flagged_aircraft` | 5,083 | **MERGE** into primary |

### Correlation Event Bloat
| Table | Rows | Action |
|-------|------|--------|
| `normalized_correlation_events` | 6,419,804 | **KEEP** (largest, primary) |
| `correlation_events` | 690,925 | **DROP** - subset |
| `master_correlation_enhanced` | 690,924 | **DROP** - near-identical |

### Biometric Fragmentation (7+ tables)
| Table | Rows | Action |
|-------|------|--------|
| `biometric_threshold_collapses` | 111,757 | **KEEP** - unique threshold data |
| `biometrics_unified` | 10,169 | **KEEP** (primary biometric view) |
| `biometric_monitoring` | 9,818 | **KEEP** - monitoring feed |
| `biometric_evidence` | 32,848 | **KEEP** - evidence-grade |
| `biometric_data` | 99 | **MERGE** into unified |
| `biometric_data_rows` | 100 | **MERGE** into unified |
| `biometrics_rows` | 100 | **DROP** - sample data |
| `biometrics_rows_4` | 100 | **DROP** - sample data |
| `biometric_measurements` | 48 | **MERGE** into unified |

### Evidence Network Mirrors
| Table | Rows | Action |
|-------|------|--------|
| `evidence_network` | 581,957 | **KEEP** |
| `unified_evidence_index` | 581,949 | **DROP** - near-identical (8 row diff) |

**Estimated savings: ~13M+ rows of redundant data eliminated**

---

## 2. Dead/Empty Tables to Clean Up

These tables have 0-2 rows and appear unused:

- `adsbexchange_active_threats` (0 rows)
- `adsbexchange_recent` (0 rows)
- `court_ready_evidence` (0 rows)
- `audit_trail` (0 rows)
- `prosecution_priority_correlations` (0 rows)
- `realtime_event_summary` (0 rows)
- `pattern_index` (1 row)
- `flight_data` (1 row)
- `correlations` (1 row)
- `case_memory` (1 row)
- `conversations` (1 row)

### Test/Training Data (should NOT be in production)
- `mnist_test` (29,997 rows) -- ML training data
- `mnist_train_small` (59,997 rows) -- ML training data

**These 90K rows of MNIST data serve no forensic purpose and should be dropped.**

---

## 3. Missing Linkage Opportunities

### A. Biometric Threshold Collapses (111,757 rows) -- NOT LINKED to flights

This is your largest biometric table and it has NO cross-reference to `live_flight_detections_rows`. This is a major gap -- 111K threshold collapse events should be correlated with concurrent flight activity to strengthen Bradford-Hill causation scores.

**Recommended enrichment:**
- Create a new `biometric_collapse_flight_correlations` table
- For each collapse event, find flights within a +/- 15 minute window
- Calculate proximity and altitude factors
- Store Bradford-Hill scores

### B. FR24 OCR Extracted Aircraft (5,000 rows) -- NOT LINKED

These radar screenshot OCR extractions contain aircraft registrations and timestamps but are not cross-referenced with:
- `live_flight_detections_rows` (match by registration + time)
- `biometric_monitoring` (temporal correlation)
- `flagged_aircraft_rows_rows` (flag matching)

### C. Phantom Stress Reconciliation (348 rows) -- PARTIALLY LINKED

The Truth Scanner now queries this, but it should be formally linked to:
- `biometric_threshold_collapses` (matching stress windows)
- `sentinel_violations` (Neon, 34K rows -- correlate stealth ops with violations)

### D. Screenshot-to-Flight Gaps

| Table | Rows | Issue |
|-------|------|-------|
| `screenshot_metadata_custody` | 2,113 | Has timestamps but no flight linkage |
| `screenshot_ocr_data` | 516 | OCR text not matched to aircraft registrations |
| `screenshot_flight_links` | 1,100 | Only 1,100 of 2,113 screenshots linked (52%) |

**48% of screenshot evidence is unlinked -- needs backfill.**

### E. Legal Evidence Gaps

| Table | Rows | Issue |
|-------|------|-------|
| `legal_ada_violations_proper` | 36,870 | Not linked to `master_forensic_events` |
| `normalized_bio_legal_ada_violations_proper` | 36,870 | Duplicate of above with "normalized" prefix |
| `false_claims_act_ledger` | 500 | No foreign key to enterprise defendants |

---

## 4. Enrichment Recommendations

### A. Import into Neon for Enrichment

Based on the drone swarm evidence reports, the following data should be structured and imported:

1. **Drone Swarm Events Table** (`drone_swarm_events`)
   - 13 identified swarm events from the evidence report
   - Columns: event_id, timestamp, aircraft_count, avg_altitude, spread_meters, registrations (array), location, swarm_score

2. **XXD Ghost Network Registry** (`xxd_ghost_registry`)
   - All XXD-prefixed detections cataloged with taxonomy tags
   - Links to `id_taxonomy` (8 rows) for classification

3. **ADS-B Spoofing Incidents** (enrich existing `spoofing_incidents` -- currently only 1 row)
   - Backfill from `flight_anomaly_analysis` (555 rows with anomaly flags)
   - Import negative-altitude and impossible-speed events

### B. Cross-Table Enrichment Queries

These enrichments can be run via the `neon-query` edge function:

1. **Biometric-Collapse-to-Flight Linkage**: Match 111K threshold collapses to concurrent flights
2. **OCR-to-Detection Matching**: Match 5K FR24 OCR records to live detections by registration
3. **Screenshot Backfill**: Link remaining 1,013 unlinked screenshots to flights
4. **Sentinel Violation History**: Cross-reference 34K sentinel violations with biometric events

---

## 5. Structural Improvements

### A. Missing Indexes (performance)

The following large tables likely need indexes for query performance:

- `live_flight_detections_rows`: Index on `(registration, detection_timestamp)` and `(latitude, longitude)`
- `normalized_correlation_events` (6.4M): Index on timestamp and entity columns
- `biometric_threshold_collapses` (111K): Index on timestamp
- `threat_tiers` (2.8M): Index on tier classification + timestamp
- `master_unified_evidence` (2.8M): Index on evidence type + timestamp

### B. Normalized Flight Tables are Redundant

| Table | Rows | Issue |
|-------|------|-------|
| `normalized_flight_live_flight_detections_rows` | 2,849,359 | Copy of `live_flight_detections_rows` |
| `normalized_flight_flagged_aircraft_rows_rows` | 35,511 | Copy of `flagged_aircraft_rows_rows` |
| `normalized_flight_public_air_traffic_rows` | 25,041 | Copy of `public_air_traffic_rows` |
| `normalized_bio_unified_timeline_enhanced` | 108,967 | Normalized biometric view |

These "normalized_" tables appear to be ETL artifacts. If they add columns beyond the originals, merge the new columns back. If not, drop them.

---

## Implementation Plan

### Phase 1: Cleanup (immediate, no risk)
- Drop MNIST tables (90K rows of ML training data)
- Drop empty tables (0-row tables listed above)
- Drop `live_flight_detections_rows_backup` after confirming primary is intact

### Phase 2: Deduplication
- Merge flagged aircraft copies into single primary
- Drop `evidence_network` or `unified_evidence_index` (keep one)
- Drop `correlation_events` and `master_correlation_enhanced` (keep normalized)

### Phase 3: Enrichment
- Create `drone_swarm_events` table and import 13 events
- Run biometric-collapse-to-flight correlation (111K records)
- Backfill OCR-to-detection matches (5K records)
- Complete screenshot-to-flight linking (1,013 unlinked)

### Phase 4: Indexing
- Add composite indexes to top 5 largest tables
- Add `ANALYZE` on all tables after cleanup for query planner updates

### Phase 5: Sentinel Integration
- Feed enriched drone swarm data into Sentinel learned threats
- Update adaptive thresholds based on new linkage data
- Generate countermeasures for newly linked patterns

