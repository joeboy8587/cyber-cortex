

# System Enrichment & Upgrade Plan

## What This Covers
Import 6 uploaded intelligence files into the agent system AND implement targeted upgrades identified from analyzing the reports against the current architecture.

---

## Part 1: Import Files as Agent Intelligence

**Files to import:**
- `ghost_aircraft_unmasking_results.json` — 65 military callsign detections, KOME6670 drone ops
- `COMPREHENSIVE_ANALYSIS_FINAL_REPORT.md` — 4-phase ghost aircraft & biometric correlation
- `GHOST_AIRCRAFT_UNMASKING_REPORT.md` — Masked aircraft identification
- `FLIGHT_INCIDENT_BIOMETRIC_CORRELATION_REPORT.md` — 12 biometric-flight events
- `EXHIBIT_RCH_MILITARY_COORDINATION.md` — RCH C17/K35R coordination evidence
- `SHELL_COMPANY_ENTERPRISE_ANALYSIS_1.md` — ALF IX 32-aircraft fleet, shell network

**Action:** Copy all 6 files to `public/data/` and insert into `evidence_documents` table with SHA-256 hashes and tags. Then update the agent-orchestrator to load these as contextual intelligence.

---

## Part 2: Agent Orchestrator Upgrades

### Upgrade 1: Enriched Database Context
The current `getDbContext()` only queries 4 tables (violations, shell companies, enterprise, flights). Expand to include:
- `biometric_monitoring` — recent stress events
- `watchtower_autonomous_flags` — active threat flags
- `sentinel_learned_threats` — escalated threats
- `evidence_documents` — the newly imported reports (summary snippets)

This gives agents real-time awareness of biometric harm, active threats, and uploaded intelligence.

### Upgrade 2: Document-Aware Agent Prompts
Add a new section to `buildAgentSystemPrompt()` that injects summaries from `evidence_documents` tagged with relevant categories. Each agent gets documents matching their specialty:
- Amy/Legal Analyst: shell company analysis, biometric correlation reports
- Shell Investigator: shell company enterprise analysis
- Josiah: ghost aircraft unmasking, RCH military coordination
- Legal Drafter: exhibit documents, comprehensive analysis

### Upgrade 3: Cross-Callsign Persistence in Agent Context
Add a `ghost_fleet_registry` section to agent context with the ALF IX fleet (32 Cessnas), RCH military callsigns, and KOME6670 drone data extracted from the uploaded reports. This allows agents to reference specific aircraft without re-discovering them each session.

---

## Part 3: Frontend Upgrades

### Upgrade 4: Agent Intelligence Feed Panel
Add a collapsible "Intelligence Feed" section to `MultiAgentHub.tsx` showing the 6 imported documents as clickable references. When clicked, the document content is injected into the agent prompt as context, enabling document-specific analysis.

### Upgrade 5: Handoff Chain Visualization Enhancement
Currently shows breadcrumb trail. Upgrade to show:
- Time elapsed per agent in the chain
- Token count per response (from SSE stream)
- Which documents were referenced

---

## Technical Details

### Files Modified
| File | Change |
|------|--------|
| `supabase/functions/agent-orchestrator/index.ts` | Expand `getDbContext()` with 4 new tables, add document intelligence injection, add ghost fleet registry to prompts |
| `src/components/dashboard/MultiAgentHub.tsx` | Add Intelligence Feed panel, document injection on click, enhanced chain stats |
| `public/data/` | Copy 6 uploaded files |

### Database Changes
- Insert 6 rows into `evidence_documents` table with document content, SHA-256 hashes, and tags (`ghost_aircraft`, `shell_company`, `military_coordination`, `biometric_correlation`)

### Edge Function Changes
- `agent-orchestrator`: Add 4 new DB queries in `getDbContext()`, truncate results to prevent token overflow (200-char summaries for documents, last 10 records for biometrics/threats)

---

## Priority Order
1. Import files to `public/data/` and `evidence_documents` table
2. Expand agent-orchestrator DB context (biggest impact)
3. Add document-aware prompts per agent specialty
4. Add ghost fleet registry to agent context
5. Build Intelligence Feed UI panel

