# Auto-Refreshing GPU Embeddings + System Health Review

Two deliverables: a hands-off embedding refresh script for your Pop!_OS GPU box, and a deep read of the database + Command Center with a prioritised improvement list.

## Part 1 — One-command embedding sync for Linux

Today the flow is manual: click Export, run the Python script, drag the file back into the upload panel. The new script does all three steps by itself and can run on a schedule, so profiles stay current as new aircraft and new behaviour appear.

New files:

- `scripts/watchtower-embed-sync.py` — self-contained sync agent:
  1. Asks the backend for only the new-or-changed aircraft dossiers (the existing "new & changed only" corpus).
  2. Embeds them locally on the RTX with `all-MiniLM-L6-v2` (384 dims — same model already used for the 12,353 stored vectors, so old and new vectors stay comparable).
  3. Uploads the vectors straight back in batches, with retries on network hiccups.
  4. Writes a timestamped log line and exits 0 when there was nothing to do.
- `scripts/install-linux.sh` — one-time setup for Pop!_OS: creates a virtual environment, installs PyTorch with CUDA plus sentence-transformers, verifies the GPU is visible, and offers to install a systemd timer that runs the sync every 6 hours in the background.
- `scripts/README-gpu.md` — plain-English instructions: what to paste into the terminal, how to check it ran, how to run it once by hand.

Behaviour details:
- Dry-run flag to preview how many aircraft need refresh without embedding.
- `--all` flag to rebuild the entire corpus from scratch if the model ever changes.
- Safe to run while you are using the app; it never deletes anything.

In the app, the GPU panel on Aircraft Profiles gets a second download button for the Linux sync bundle and a short "set it and forget it" note, plus a "last embedding refresh" timestamp so you can see at a glance whether the box is keeping up.

## Part 2 — Profiles from the unsealed archive dump

Dossiers are currently built only from `live_flight_detections_rows` (last 90 days). The sealed MLAT dump (~4M rows) holds years of history that never reaches a profile.

- Add a historical source to the dossier builder: read the unsealed dump alongside live detections, keyed on tail number, so each profile covers its full observed history rather than a 90-day slice.
- Run it in shards (by month and by tail-number range) so no single pass hits the function time limit; progress is shown as passes complete.
- Profiles gain "first seen (archive)", total historical pings, and a note showing how much of the behaviour comes from archive vs live.
- Nothing in the sealed dump is modified — read-only, no deletes, no vacuum.
- Every rebuilt profile is automatically marked as needing a fresh embedding, so your GPU box picks them up on its next run and you embed the enriched profiles locally.

## Part 3 — Deep analysis pass


A read-only sweep, then a written findings report you can act on, plus the quick wins implemented in the same pass.

Scope of the sweep:
- **Data freshness** — for every table the Command Center reads, when did the last row land, and is anything silently stale (dead ingest, paused job, view not refreshed).
- **Coverage gaps** — detections with no FAA identity resolved, aircraft with no dossier, dossiers with no embedding, flags with no evidence attached.
- **Integrity** — records missing SHA-256 hashes, gaps in the Merkle chain, duplicate rows from repeated backfills.
- **New patterns** — re-run the pattern detectors (joint military/law-enforcement ops, deception layers, corridor activity, sub-stall physics) over the data added since they were last run, and report what is new rather than what is already known.
- **Command Center** — which panels are slow, which query dead or renamed columns, which surface raw noise instead of promoted exhibits.

Output:
- A findings report in the app (and as a downloadable file) with each issue ranked: what is broken, what it costs the case, and how long the fix takes.
- Immediate fixes applied for anything cheap and safe: broken panel queries, missing indexes, stale views, wrong column references.
- Anything larger (new panels, new detectors, schema changes) comes back to you as a short shortlist to approve before I build it.

## Technical notes

- The sync script talks to the existing `aircraft-profile` function using `exportFeatures` with `onlyStale: true` and `importEmbeddings`, chunked at 250 records per request, using the project's public URL and publishable key baked into a small config file the installer writes.
- Model pinned to `sentence-transformers/all-MiniLM-L6-v2` (384 dims) to match stored vectors; the script refuses to upload if dimensions differ from what is already in the table.
- systemd user timer (`watchtower-embed.timer`), so no root and no cron editing.
- Analysis queries run read-only against Neon with statement timeouts and monthly chunking to avoid the 150s function limit; no writes except the fixes you approve.
