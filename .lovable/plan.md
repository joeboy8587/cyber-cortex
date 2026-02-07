
# Comprehensive Data Quality Audit & Security Hardening Plan

## Executive Summary
Build a **Master Data Quality Dashboard** that performs deep audits across all 9+ million multimodal records in NeonDB, checking for OCR data quality, duplicates, SHA-256 hash coverage, encryption status, and providing security hardening recommendations.

---

## Current State Analysis

### Existing Infrastructure
| Component | Purpose | Status |
|-----------|---------|--------|
| `DataQualityAudit.tsx` | OCR auditing, evidence domains, timeline ranges | Active |
| `DataHardeningHub.tsx` | SHA-256 coverage overview, Notion sync status | Active |
| `DataIntegrityPanel.tsx` | Provenance audits, biometric gap detection | Active |
| `DatabaseQualityControl.tsx` | 13-domain categorization, duplicate families, empty tables | Active |
| `ChainOfCustodyPanel.tsx` | SHA-256 fingerprinting, verification | Active |
| `evidence-fingerprint` edge function | SHA-256 hash computation and verification | Deployed |
| `data-quality-audit` edge function | OCR validation, domain analysis | Deployed |
| `database-quality-control` edge function | Duplicate detection, quality metrics | Deployed |

### Identified Gaps
1. **No unified comprehensive audit view** - data quality tools are scattered across multiple panels
2. **No OCR-specific duplicate detection** - OCR data often has repeated text extractions
3. **No cross-table duplicate detection** - same records may exist in multiple tables
4. **Missing encryption-at-rest verification** - no visibility into database encryption status
5. **No automated malformed data cleanup workflow** - flagging exists but remediation is manual
6. **Limited RLS audit visibility** - only basic linter warnings shown

---

## Implementation Plan

### Phase 1: Unified Data Quality Dashboard Component

Create `src/components/dashboard/ComprehensiveDataAudit.tsx`:

```text
+------------------------------------------------------------------+
|  COMPREHENSIVE DATA QUALITY AUDIT                                 |
|------------------------------------------------------------------|
|  [Run Full Audit]  [Quick Scan]  [Export Report]                  |
|------------------------------------------------------------------|
|  OVERVIEW                                                         |
|  +----------+  +----------+  +----------+  +------------+         |
|  | 9.2M     |  | 98.7%    |  | 534      |  | 47         |         |
|  | Records  |  | Hashed   |  | Tables   |  | Issues     |         |
|  +----------+  +----------+  +----------+  +------------+         |
|------------------------------------------------------------------|
|  TABS: [Hash Coverage] [Duplicates] [OCR Quality] [Security]      |
+------------------------------------------------------------------+
```

**Key Features:**
- Aggregates all existing audit functions into a single view
- Adds new cross-table duplicate detection
- Adds OCR-specific malformed data detection
- Shows encryption and RLS policy status
- Provides remediation actions

### Phase 2: Enhanced Edge Function for Deep Audits

Extend `supabase/functions/database-quality-control/index.ts` with new actions:

| Action | Purpose |
|--------|---------|
| `deepOCRAudit` | Detect malformed OCR data (NULL timestamps, OCR artifacts, repeated text blocks) |
| `crossTableDuplicates` | Find identical records across related tables using hash comparison |
| `hashCoverageReport` | Detailed SHA-256 coverage per domain with remediation priority |
| `rlsPolicyAudit` | Enumerate all RLS policies and flag weak/missing policies |
| `encryptionStatus` | Verify SSL connections and report encryption-at-rest status |

### Phase 3: OCR-Specific Data Quality Checks

**OCR Malformed Data Detection Patterns:**

| Pattern | Detection Query | Remediation |
|---------|-----------------|-------------|
| NULL timestamps | `WHERE created_at IS NULL AND exif_timestamp IS NULL` | Extract from filename pattern |
| OCR text artifacts | `WHERE extracted_text ~ '^[0-9]{3,}$'` | Flag for manual review |
| Duplicate extractions | `GROUP BY file_hash HAVING COUNT(*) > 1` | Merge into single record |
| Malformed registrations | `WHERE registration NOT ~ '^N[0-9A-Z]{1,5}$'` | Apply OCR correction mapping |
| Missing coordinates | `WHERE latitude IS NULL OR longitude IS NULL` | Cross-reference with flight data |

**Tables to audit:**
- `screenshot_ocr_data`
- `ocr_aircraft_holding_patterns`
- `ocr_extracted_text`
- `radar_screenshot_analysis`

### Phase 4: Cross-Table Duplicate Detection

**Strategy:** Use SHA-256 hashes to detect identical content across related tables.

```text
Duplicate Family Detection:
1. Group tables by evidence domain (Flight, Biometric, OCR, etc.)
2. For each domain, compare record hashes across tables
3. Identify:
   - Exact duplicates (identical hashes)
   - Near-duplicates (same entity, different timestamps)
   - Split records (same entity fragmented across tables)
4. Generate merge recommendations with safety scoring
```

**Priority domains for duplicate audit:**
- `live_flight_detections_rows` vs `live_flight_detections`
- `biometric_monitoring` vs `biometrics_unified`
- `josiah_reflections_rows` vs `josiah_timeline`

### Phase 5: SHA-256 Hash Coverage Deep Dive

**Current Status (from memory context):** 99% coverage across 384 tables.

**Enhanced Reporting:**
- Coverage by evidence domain
- Unhashed record counts per table
- Auto-hash trigger status per table
- Verification failure log
- Chain-of-custody completeness score

### Phase 6: Security Hardening Recommendations

Based on current linter findings and best practices:

| Finding | Risk Level | Recommendation |
|---------|------------|----------------|
| Extension in public schema | WARN | Move extensions to dedicated schema |
| Leaked password protection disabled | WARN | Enable password breach checking |
| Tables without RLS | CRITICAL | Enable RLS with proper policies |
| Service role key exposure | HIGH | Audit edge function access patterns |
| Missing audit logging | MEDIUM | Add trigger-based audit trail |

**Security Dashboard Features:**
- RLS policy coverage visualization
- API key/secret usage audit
- Edge function permission review
- Encryption status verification

---

## Technical Specifications

### New Files to Create

```text
src/components/dashboard/ComprehensiveDataAudit.tsx
  - Unified dashboard component
  - ~800 lines with 6 tabs

supabase/functions/database-quality-control/index.ts (extend)
  - Add 5 new actions for deep auditing
  - ~200 additional lines
```

### Files to Modify

```text
src/pages/DataTools.tsx
  - Add ComprehensiveDataAudit as primary component
  - Reorganize existing panels as secondary

src/components/AppSidebar.tsx
  - Add "Data Audit" link under Data Tools section (if not present)
```

### Database Queries (Read-Only)

All audit queries will be SELECT-only for safety:
- Hash coverage: `SELECT COUNT(*) FILTER (WHERE sha256_hash IS NOT NULL)`
- Duplicates: `SELECT sha256_hash, COUNT(*) GROUP BY sha256_hash HAVING COUNT(*) > 1`
- OCR quality: Pattern matching with `~` regex operator
- RLS policies: `SELECT * FROM pg_policies`

---

## Recommended Hardening Actions (Post-Audit)

### Immediate (Critical)
1. Enable leaked password protection in auth settings
2. Move `pgcrypto` extension to dedicated schema
3. Add RLS policies to any unprotected tables

### Short-Term (High Priority)
1. Complete SHA-256 hashing for remaining 1% of records
2. Create auto-hash triggers on high-ingestion tables
3. Implement OCR timestamp reconstruction from filename patterns
4. Merge duplicate OCR extractions

### Medium-Term (Maintenance)
1. Archive/quarantine empty backup tables
2. Consolidate duplicate table families
3. Add comprehensive audit logging triggers
4. Implement regular automated integrity verification

---

## Estimated Complexity

| Component | Effort | Dependencies |
|-----------|--------|--------------|
| ComprehensiveDataAudit.tsx | Medium | Existing edge functions |
| Edge function extensions | Medium | NeonDB connection |
| Security dashboard tab | Low | pg_policies access |
| Integration with DataTools | Low | Routing only |

---

## Success Metrics

After implementation, the dashboard will provide:
- Single-view data quality score (0-100%)
- Actionable remediation list with priority ranking
- Historical trend tracking for data quality
- Exportable audit reports for legal chain-of-custody documentation
- Real-time security posture assessment

