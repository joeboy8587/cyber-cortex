# Aircraft Profile Graph — learned embeddings + interactive network

Turn the detection archive (live detections, unsealed dumps, FAA identity, flags, violations) into one page that shows **who each aircraft is, who it flies with, and why it matters** — with a learned model behind the scoring, not just rules.

## What you get

1. **Profile Cards** — one per aircraft: FAA-authoritative operator, fleet siblings, total detections, AOI proximity, night ratio, sub-stall pings, flag history, repeat-offender rank, and a plain-English risk summary.
2. **Interactive Graph** — drag/zoom canvas where nodes are aircraft, operators/LLCs, and AOI clusters. Edges mean: same registrant, same shell address, co-present in time and space, shared callsign pattern. Click a node to open its profile; click an edge to see the evidence that created it.
3. **Learned similarity ("neural" layer)** — an autoencoder-style embedding trained on the daily feature vectors already in `ml_features_daily`, so aircraft with the same *behavioral signature* cluster together even when they never share an owner. Surfaces as "behavioral twins of N720CA".
4. **Repeat-offender ranking** — combines deduplicated flags, policy violations, and graph centrality (PageRank) into one 0–100 score per aircraft and per operator.
5. **One-click promotion** — any profile or cluster can be pushed to Exhibits with a SHA-256 fingerprint and audit entry, following the existing promotion rules.

## Build order

**Phase A — Profile + graph build (Neon)**
- New edge function `entity-graph-build`: writes `entity_graph_nodes` and `entity_graph_edges` in Neon from FAA identity, shell registrant matches, spatio-temporal co-presence (same 5nm / ±10 min window), and flag/violation counts. Incremental by date window so it never hits the 120s budget.
- Reuse `graph-pagerank` to score node centrality on the new edge table.

**Phase B — Learned embeddings**
- New edge function `entity-embed`: reads `ml_features_daily`, standardizes features, trains a small linear autoencoder (pure numeric, runs in the function — no GPU/ONNX), stores a 16-dim vector per aircraft in `entity_embeddings`, plus nearest-neighbor lists. Retrainable on demand and nightly.
- Behavioral-twin edges get added back into the graph, tagged so they're visually distinct from documentary links.

**Phase C — UI**
- New route `/network-intel` with three regions: graph canvas (left), profile drawer (right), ranked offender table (bottom).
- Filters: date range, AOI-only, flagged-only, operator search, edge-type toggles.
- Graph rendered with an existing lightweight force layout in-app (same approach as the tanker network SVG graph, extended for pan/zoom and larger node counts, capped at the top N nodes for performance).

**Phase D — Wiring into the case**
- "Promote profile to exhibit" and "Promote cluster to exhibit" buttons.
- Cross-links: profile → Forensic Trajectory, → biometric correlation window, → Sentinel flags.

## Technical notes

- All heavy work stays in Neon-backed edge functions with windowed queries and statement timeouts; the UI only reads precomputed node/edge/embedding tables so the page loads fast.
- The autoencoder is trained in-function on standardized numeric features (no external ML runtime); results are deterministic and hash-stamped so any cluster shown in court can be reproduced.
- Identity always comes from `v_faa_identity`; feed operator strings are never used as node labels.
- No raw records are modified or deleted — new tables only.

## Scope note

Phases A and C are the visible payoff and can ship first. Phase B (learned embeddings) adds the "neural" clustering on top and needs `ml_features_daily` rebuilt over the full timeline, which runs as a background job.
