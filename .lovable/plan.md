
# Case File Architecture — Universe vs Exhibits

## Phase 1: Database Schema (Migration)
Create 4 new tables in Supabase:

- **`cases`** — 4 primary legal theories (RICO, Posse Comitatus, FAA Violations, Civil Rights)
- **`exhibits`** — Tiered exhibit registry (Tier 1: Smoking Gun → Tier 4: Supporting) linked to cases and universe records
- **`promotion_rules`** — Objective criteria that promote universe records to exhibits (altitude < 1000ft, grade_a_causation, etc.)
- **`exhibit_audit_trail`** — Every filter/promotion logged with SHA-256 hashes for anti-cherry-pick defense

All tables get RLS policies for investigator/admin access.

## Phase 2: Seed Case Data
Pre-populate:
- 4 cases (CASE-001-RICO through CASE-004-CIVIL-RIGHTS)
- 17 exhibits (A through Q) with tiers, descriptions, and legal significance
- 10 default promotion rules from the framework

## Phase 3: Ingest Kimi Agent Swarm Files
Import all 48 case files from the zip into `evidence_documents` with proper SHA-256 hashing and tags.

## Phase 4: Case Files Dashboard UI
New `/case-files` page with:
- Case overview cards (4 legal theories with status/priority)
- Exhibit registry table (tiered, filterable)
- Promotion rules panel (view/run rules against universe)
- Audit trail viewer

## What This Achieves
- **Anti-cherry-pick**: Every exhibit traces back to an objective rule + universe record
- **Reproducibility**: Same rules always produce same exhibits
- **Court-ready**: Chain of custody, SHA-256 hashing, audit logging
- **Structured**: Raw data → organized case files prosecutors can use
