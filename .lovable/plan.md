# Watchtower System & Database Audit — Findings and Improvement Plan

I ran a live audit of the backend and the command center. Below is what the data actually shows, then what I propose to fix, in priority order.

## What the audit found (verified, not assumed)

**1. Alert flood — the war room is drowning in duplicates**
- 145,542 autonomous flags total, but only 23,192 unique signatures. About 84% are repeats of the same finding re-logged on every scan.
- `PRE_CONFIRMED_PRESENCE` alone is 105,624 flags across just 341 aircraft (~310 per tail).
- 26,663 flags are marked **critical**. When everything is critical, nothing is.

**2. The evidence pipeline has been stalled for months**
- Master forensic events: last write **May 23**.
- Merkle chain-of-custody ledger: last anchor **May 25** — nothing since then is cryptographically sealed.
- Exhibits registry: last update **May 6**, still only 38 exhibits (26 in Tier 1).
- Unmasked HQ locations: last update **March 24**.
- Daily flight intelligence reports table: **completely empty (0 rows)**.

Meanwhile detection and flagging kept running through **July 29**. So months of live surveillance data never made it into court-ready evidence.

**3. FAA violation scanning is barely running**
- `policy_violations` holds only 35 rows, last written July 24 — despite the full FAA registry and FAA regulations tables now being loaded and the "below 1,000 ft is critical" rule being in force.

**4. Command center sprawl**
- 213 dashboard components spread across 21 routes. Many panels overlap (multiple data-quality, archive, and biometric-correlation panels doing near-identical work), which makes the daily workflow hard to follow and slows every page.

## Proposed plan

### Phase 1 — Stop the alert flood (highest impact)
- Add deduplication so a repeated finding updates an existing flag (occurrence count + last-seen) instead of creating a new row. No history is destroyed — existing flags stay, they get grouped.
- Roll the 145k rows into a grouped view: one card per aircraft + finding type, showing "seen 310 times, first/last seen".
- Re-tier severity so "critical" means something: presence-only findings drop to informational; critical reserved for physics violations, sub-1,000 ft over the AOI, identity mismatches, and biometric-correlated events.
- Result: the flags panel shows roughly 23k meaningful findings instead of 145k rows, with a genuinely short critical list.

### Phase 2 — Restart the stalled evidence pipeline
- Backfill forensic events and re-anchor the Merkle ledger for everything detected since May 23, so the chain of custody is unbroken and current.
- Re-run the exhibit promotion rules against the last ~3 months of data so qualifying detections are promoted into the exhibit registry automatically.
- Generate the missing daily intelligence reports for the backlog period and put them on a schedule so they never go empty again.
- A "pipeline freshness" strip at the top of the dashboard: green/amber/red per stage, so a stall is visible the same day instead of two months later.

### Phase 3 — Turn on full FAA-backed violation scanning
- Run the violation scanner across the full detection history (not just recent days), citing the FAA regulation and registry-confirmed operator on every hit.
- Every violation gets its regulation citation, altitude, location, operator identity, and hash — ready to drop straight into a complaint or exhibit.

### Phase 4 — Consolidate the command center
- Merge duplicated panels (data-quality, archive, biometric-correlation families) into single canonical panels.
- Reorganize the daily workflow around: Today's Critical Findings → Evidence to Promote → Exhibits → Export.
- Retire dead panels whose backing tables no longer receive data.

## Technical notes
- Dedupe uses a stable signature (flag type + registration + normalized description) with an occurrence counter and first/last-seen columns; existing rows are collapsed by a one-time grouping migration, never deleted.
- Backfills run as chunked background jobs with time-window caps to stay inside edge function budgets (the same pattern already used for biometric enrichment).
- Merkle re-anchoring appends new sequence numbers; prior chain hashes remain untouched, preserving reproducibility.
- Freshness strip reads max-timestamp per pipeline table via the existing data-health function.

## Suggested order
Phase 1 first (immediate daily relief), then Phase 2 (legal exposure — unsealed evidence), then 3, then 4. Each phase is independently shippable.
