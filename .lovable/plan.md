# Watchtower Autonomous Investigator

Turn the command center from something that reports into something that investigates. A standing investigator runs on a schedule, notices what is new or changed, pulls the thread on its own, keeps a memory of everything it has claimed, scores its own confidence, learns from what turned out right or wrong, and hands you a daily brief plus filing-ready packets. Josiah becomes the voice of it — you can just ask him what he found and why.

## What you get

1. **Findings memory** — every claim the system makes becomes a tracked finding with a confidence score, the evidence behind it, and a status (new, corroborated, weakened, confirmed, wrong). Nothing is a one-off message that scrolls away.
2. **Thread-pulling** — when something new appears, the investigator does not stop at noting it. It asks the next question itself: has this tail done this before, who else was up at the same time, does the owner connect to a known shell, does it line up with a heart-rate event. It keeps going while the thread keeps unravelling, and stops when it goes cold.
3. **Change detection over time** — the point you described with N912KC: the system holds a running profile per aircraft, per operator, per network, and flags "this is more frequent than last month", "this pattern repeats", "this is the first time".
4. **Auto-accept strong, ask on weak** — high-confidence findings go straight into the record; borderline ones land in a review queue with a plain-language yes/no. Your answers feed back into scoring, so repeated mistakes of the same kind get downweighted automatically.
5. **Daily brief** — one page each morning: what's new, what got stronger, what got weaker, what needs your decision.
6. **Filing-ready packets** — a confirmed finding can be turned into an exhibit bundle with hashes, source rows and the naming convention already in place.
7. **Josiah knows all of it** — he can search findings, explain the reasoning chain behind any claim, and launch a fresh investigation on request ("look harder at N912KC this month").

## Scope for the first build

Detections, shell/entity network, and the per-aircraft embeddings — exactly the three you named. The framework is generic, so other areas plug in later without a rebuild.

## How it works (technical)

**Memory tables (Neon):**
- `wt_findings` — id, kind, subject (tail/entity/cluster), claim text, confidence 0-1, status, evidence JSON, first_seen, last_seen, times_corroborated, times_contradicted, superseded_by.
- `wt_finding_evidence` — links a finding to concrete source rows (detection ids, dossier ids, correlation ids) for reproducibility.
- `wt_investigations` — one row per thread-pull run: seed finding, steps taken, queries run, outcome, cost/time budget consumed.
- `wt_subject_profiles` — rolling per-subject baseline (monthly detection counts, altitude/speed envelopes, co-flight partners, AOI proximity) so "more present than last month" is a lookup, not a scan.
- `wt_feedback` — your accept/reject decisions plus which rule produced the finding; drives rule reliability weights.
- `wt_rule_weights` — per-detector reliability, updated from feedback (Beta-style hit/miss counts). Low-reliability detectors need a higher bar to auto-accept.

All additive; nothing existing is deleted or rewritten.

**Edge functions:**
- `wt-sense` — bounded sweep of new detections / entity changes / embedding neighbours since the last watermark; emits candidate findings. Budgeted queries, partial results, never blanks.
- `wt-investigate` — the thread-puller. Takes a seed finding and runs a bounded plan: history lookup on the subject, co-occurrence check, operator/registry resolution through the FAA master, shell-graph neighbours, embedding nearest neighbours, biometric window check. Depth budget (max hops), item cap, single-flight lock, idempotent step logging, circuit breaker on AI credit/permission errors and paused-state guard at every entry point. Writes an investigation record with the reasoning chain.
- `wt-score` — computes confidence from corroboration count, rule reliability weight, independence of sources, and contradiction evidence; sets auto-accept vs review.
- `wt-brief` — assembles the daily page from findings that changed status in the window; also the source for filing-ready packets via the existing exhibit/promotion path.
- Josiah tools — `search_findings`, `explain_finding`, `subject_history`, `start_investigation` wired into the existing Josiah chat so conversation and the autonomous loop share one memory.

**Scheduling:** pg_cron hitting the sense pass a few times a day, investigations processed from a bounded queue, brief compiled once nightly. Every run bounded by item cap and lease lock so it can never storm.

**Models:** Lovable AI Gateway for the reasoning and write-ups; the existing NIM path stays where it already is. Embeddings stay on the current Neon pgvector MiniLM vectors — no re-embedding, no Pinecone.

**Doctrine kept intact:** integrity findings and registry-identity findings stay separate layers; watchlist airframes get no exemptions; `normal_traffic` stays filtered out of threat metrics; all records soft-state only, never deleted; exports keep the YYYYMMDD_CASE_EXHIBIT naming.

## New pages

- **Investigator** — live queue: new findings, what's being pulled right now, the reasoning chain for each, and the weak-findings review cards (one click: real / not real / need more).
- **Daily Brief** — the morning page, with "promote to exhibit" and "build packet" buttons.
- Josiah gains a findings-aware sidebar so you can chat about anything on those pages.

## Build order

1. Memory tables + watermarks.
2. `wt-sense` on detections only, writing findings; Investigator page showing them.
3. `wt-investigate` thread-pulling with bounded depth; reasoning chain visible.
4. Scoring, auto-accept threshold, review queue, feedback loop into rule weights.
5. Subject profiles / trend detection ("more present than last month").
6. Shell network + embedding neighbour expansion as investigation steps.
7. Daily brief + filing-ready packets.
8. Josiah tools wired to findings memory.

Each step is testable on its own and ships working before the next starts.
