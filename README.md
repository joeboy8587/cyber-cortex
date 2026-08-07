# Cyber-Cortex

Internal command center for The Watchtower Project. Hosted at [cyber-cortex-fawn.vercel.app](https://cyber-cortex-fawn.vercel.app).

## What this is

Cyber-Cortex is the internal analytics and integrity layer for the Watchtower Project's 35.2M+ record multimodal archive. It is **not** public-facing. It provides operators with tools for aerial surveillance analysis, data integrity verification, and investigative workflows.

## Tech stack

- **Frontend**: Vite, React, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Supabase Edge Functions (Neon), Neon Postgres
- **Deployment**: Vercel (static build via `vercel.json`)

## Key pages

| Route | Description |
|-------|-------------|
| `/sentinel-v2` | Sentinel detection dashboard |
| `/neon-data-health` | Neon database health monitoring |
| `/tanker-network` | Aerial tanker network visualization |
| `/network-intel` | Network intelligence: profiles, graph, repeat offenders |
| `/archive-integrity` | Index health, SHA-256 hash coverage, Merkle chain of custody |

## Deployment configuration

- **`vercel.json`** — Configures `@vercel/static-build` to output Vite's `dist/` directory and routes all paths (`/(.*)`) to `/index.html` for SPA client-side routing.
- **`.npmrc`** — Sets `legacy-peer-deps=true` to avoid peer dependency install failures during Vercel builds.

## Supabase Edge Functions

### `neon-archive-integrity`
Archive integrity and query speed engine. Actions:
- `indexAudit` — finds unused/duplicate indexes and bloated tables
- `indexCleanup` — drops redundant indexes (batch, time-budgeted)
- `vacuumTables` — VACUUM ANALYZE bloated tables (never FULL, evidence tables stay online)
- `tagsView` — rebuilds `v_detection_tags` unified tag view
- `hashCoverage` — reports SHA-256 fingerprint coverage across all base tables

### `merkle-anchor`
Merkle chain of custody anchoring. Actions:
- `stats` — chain statistics (total entries, unique tables, last/first entry)
- `backfillHashes` — batch SHA-256 hashing of unhashed rows (skips up-to-date tables)
- `anchorDeep` — anchors new records into the Merkle chain
- `verify` — full chain integrity verification

### `tanker-network-analysis`
Aerial tanker refueling encounter detection. Identifies tanker-receiver pairs by spatial/temporal proximity.

## Development

```bash
npm install
npm run dev
```

Requires Node.js and npm. Environment variables (NEON_DATABASE_URL, Supabase keys) must be configured.