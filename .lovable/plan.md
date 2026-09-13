# Fix the missing columns + build a "What the System Has Learned" page

Two things: close out the last audit warnings, then give you one page that shows everything Watchtower has learned since you started running it.

## Part 1 — Write the missing columns

The wiring audit still flags two fields the case registry expects but doesn't have:

- `wtpr_registry.status` — case posture (open / under review / promoted / closed)
- `wtpr_registry.case_id` — link from a registry row to a case file

Both get added to the registry table with safe defaults, backfilled from what's already there (`legal_status` maps into `status` where present), and indexed so the case panel loads fast. No rows are changed or deleted. After that the audit should read all-clear.

## Part 2 — New page: "System Learning" (`/learning`)

One place that answers "what has this thing actually figured out?" — it reads from what the system already stores, nothing new is invented.

**Section 1 — Learning at a glance**
Counters with trend over time: learned threat profiles (2,240 today), autonomous flags raised (148,981), documents ingested and indexed (54 documents / 295 passages / 1,052 extracted facts), case files auto-built (38), policy violations detected (35). Each counter shows how it grew month by month since the project started.

**Section 2 — What it believes**
Josiah's persistent memory, grouped and readable: sacred memories, beliefs, learned patterns, hypotheses, reflections. Each entry shows when it was first learned, how many times it's been reinforced, and its confidence. Sorted so the strongest, most-reinforced beliefs are on top.

**Section 3 — Patterns it discovered on its own**
The recurring signatures the system found without being told: repeat offenders, night staging, sub-stall physics anomalies, masked-identity switches, shell-company clusters. Each shows first seen, last seen, occurrence count, and a plain-English description of what the pattern means.

**Section 4 — How its judgment changed**
A timeline of escalations and corrections: aircraft whose threat level moved up or down, flags that were auto-resolved as false alarms, and operators reclassified after FAA identity confirmation. This is the honest record of the system learning from mistakes — useful in court, because it shows the method self-corrects.

**Section 5 — What it's still unsure about**
Open hypotheses, unresolved operator-identity conflicts, and documents that failed to process. A clear "here's the gap" list so nothing is quietly forgotten.

Everything is exportable to a dated, hash-stamped summary following the existing naming convention, so "what the system learned" can itself become an exhibit.

## Technical notes

- Migration adds `status text default 'open'` and `case_id uuid` to `wtpr_registry` in Neon, with a backfill from `legal_status` and two indexes; the wiring audit reference map is updated to match.
- New route `/learning` with `src/pages/SystemLearning.tsx`, fed by a new `learning-digest` edge function that aggregates from the Josiah memory tables, `sentinel_learned_threats`, `watchtower_autonomous_flags` (deduped by signature), `rag_documents`/`rag_extractions`, `agent_case_files`, and `operator_profile_conflicts`.
- All aggregates are windowed and capped so the page loads fast against the large archive; heavy counts use row estimates plus exact counts on the small tables.
- Read-only: no raw records are modified or deleted.
