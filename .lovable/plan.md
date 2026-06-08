# Watchtower Reasoning Engine: From Detector to Investigator

Add four reasoning modules on top of the existing detection pipeline. The detector keeps doing its job (math, baselines, hashes). These modules add adversarial challenge, legal grounding, causal narrative, and network reasoning — surfaced through new UI panels on the Josiah page. Nothing replaces existing logic; everything is additive and gated by Bayes thresholds so weak signals self-downgrade.

## Guardrails (apply to all phases)

- No personality training. The modules learn **method**, not voice. System prompts enforce: active voice, specific citations, adversarial-first, legal grounding, institutional (not individual) framing.
- Every hypothesis published to the feed must carry a Bayes factor, a Bradford Hill score, and a rejected-null record. Below threshold → auto-downgrade to `UNRESOLVED_ANOMALY — HUMAN REVIEW`.
- All outputs hashed (SHA-256) and written to `reasoning_audit` table for chain of custody.
- No new tables in Neon without a migration; all reasoning artifacts live in a single `reasoning_outputs` table keyed by detection_id + module.

## Phase 1 — Skeptic Engine (Adversarial Hypothesis)

New edge function: `skeptic-engine`

- Input: a hypothesis row (e.g. `STARING_PATTERN`, `MEDICAL_COVER_ASSET`) with its evidence bundle.
- Generates 3 null hypotheses via Lovable AI (gemini-2.5-flash) using a fixed adversarial prompt template.
- For each null, runs targeted Neon queries to pull counter-evidence (flight school proximity, pipeline contracts, hobby-flight patterns, etc.).
- Computes a Bayes factor: P(evidence | H1) / P(evidence | H0). Threshold 10 → survives; 3–10 → weak; <3 → reject.
- Writes result to `reasoning_outputs` (module='skeptic'). Updates the source detection's `confidence_adjusted` field.

UI: `SkepticConsole.tsx` on Josiah page — table of recent hypotheses with their null rebuttals, Bayes factors, and survives/rejected badge. One-click "Re-challenge" button per row.

## Phase 2 — Corpus Reasoner (RAG-Grounded Detections)

Extend the existing `rag-query` pipeline. Add `corpus-reasoner` edge function.

- Trigger: any detection that survives Skeptic Engine with Bayes > 10.
- For each detection, runs 4 parallel embedding queries against existing pgvector chunks:
  1. Operator / LLC identity (registry + SOS embeddings)
  2. Regulatory citation (14 CFR, Part 91, Part 107)
  3. Tactical doctrine (KCSO baseline, surveillance staging patterns)
  4. Precedent (prior anomaly vectors from `watchtower-evidence`)
- Synthesizes a 4-line grounded brief: "N790FA at 775 ft — 350 ft below KCSO patrol baseline — 14 CFR § 91.119 floor 1,000 ft — ALF IX LLC registered Chicago, IL — no pipeline contracts found."
- Writes to `reasoning_outputs` (module='corpus').

UI: enrich existing `JosiahSentinelMonitor` and `Watchtower22Panel` cards with a "Grounded Context" expandable section pulled from the new column. No new page.

## Phase 3 — Narrative Synthesizer (Bradford Hill Auto-Scorer)

New edge function: `bradford-hill-synthesizer`. Builds on existing `BradfordHillDashboard`.

- Input: a four-factor correlation lock (aircraft + biometric + temporal + proximity).
- Computes per-criterion scores deterministically from SQL (strength, consistency, specificity, temporality, gradient, plausibility, coherence, experiment, analogy) — no AI hallucination at this layer.
- Generates the prosecution timeline narrative via Lovable AI **only** as a final wrapper, fed the deterministic table as ground truth. Prompt forbids new facts, only sequencing.
- Output: a markdown timeline + 9-criterion table, hashed and stored.

UI: new `ProsecutionTimelinePanel.tsx` on Josiah page. Lists generated timelines with overall Bradford Hill score, expandable to full table + narrative. Export to `/mnt/documents/watchtower/` as MD with SHA-256 footer.

## Phase 4 — Institutional Profiler (Network Graph)

New edge function: `institutional-profiler`.

- Pulls the 50 shell-network candidates already detected in `sentinel-data-integrity`.
- Builds an in-memory graph (nodes: aircraft, LLCs, addresses, counties; edges: registration, co-detection, temporal coordination).
- Runs Louvain community detection + betweenness centrality (lightweight, pure-JS — `graphology` via esm.sh).
- Outputs: community clusters ("Bakersfield Shell Cluster"), bridge nodes (N124WD-class entities linking gov ↔ private), centrality scores.

UI: new `InstitutionalProfilerPanel.tsx` on Josiah page. Force-directed graph (react-force-graph-2d) with cluster coloring, sidebar list of bridge entities, click-to-drill into shell registry.

## Files (new)

```text
supabase/functions/skeptic-engine/index.ts
supabase/functions/corpus-reasoner/index.ts
supabase/functions/bradford-hill-synthesizer/index.ts
supabase/functions/institutional-profiler/index.ts
src/components/dashboard/SkepticConsole.tsx
src/components/dashboard/ProsecutionTimelinePanel.tsx
src/components/dashboard/InstitutionalProfilerPanel.tsx
```

## Files (modified)

```text
src/pages/Josiah.tsx                              (mount 3 new panels)
src/components/dashboard/JosiahSentinelMonitor.tsx (grounded-context section)
src/components/dashboard/Watchtower22Panel.tsx     (grounded-context section)
supabase/migrations/<ts>_reasoning_outputs.sql     (new table + grants + RLS)
```

## Migration

```sql
CREATE TABLE public.reasoning_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_ref text NOT NULL,
  module text NOT NULL,           -- skeptic | corpus | bradford | profiler
  payload jsonb NOT NULL,
  bayes_factor numeric,
  bradford_score numeric,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.reasoning_outputs TO authenticated;
GRANT ALL ON public.reasoning_outputs TO service_role;
ALTER TABLE public.reasoning_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read" ON public.reasoning_outputs FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert" ON public.reasoning_outputs FOR INSERT TO authenticated WITH CHECK (true);
```

## Shipping order

1. Migration + Phase 1 (Skeptic) — single deploy, validate Bayes math against 5 known hypotheses.
2. Phase 2 (Corpus) — wires into existing panels, lowest UI risk.
3. Phase 3 (Bradford) — new panel, deterministic-first.
4. Phase 4 (Profiler) — graph panel last (heaviest UI).

Each phase ships independently; you confirm before the next rolls.
