## What I found (plain English)

I checked all 8 detection/alert tables AND your live tracker. Two big issues:

### 1. Your live tracker is using the wrong primary source
The `opensky-fetch` edge function (despite its name) actually tries **3 sources in this order**:
1. **adsb.lol** (PRIMARY) ← currently winning every fetch
2. RapidAPI / ADSBExchange (FALLBACK 1)
3. OpenSky Network (FALLBACK 2)

You told me you've always used **RapidAPI/ADSBExchange as primary** with **OpenSky as fallback**. That's not what's running — adsb.lol is silently grabbing every cycle.

Live logs (last 3 min):
```
13:35:25  ✅ PRIMARY adsb.lol: 8 aircraft
13:34:54  ✅ PRIMARY adsb.lol: 8 aircraft
13:34:00  ✅ PRIMARY adsb.lol: 8 aircraft
```

It IS writing to `live_flight_detections_rows` (4.2M rows, last write < 1 min ago — confirmed working). But the data source is not what you want for chain-of-custody.

### 2. Detection table sprawl (from earlier analysis)

| Table | Last data | Status |
|---|---|---|
| `live_flight_detections_rows` | just now | LIVE — only working table |
| `watchtower_alerts` | ~12 hrs ago | Stalled |
| `sentinel_alerts` | 5 days ago | Dead |
| `unfilterd_detections` | 16 days ago | Dead |
| `unfiltered_aircraft_detections` | 31 days ago | Dead |
| `live_flight_detections` (no `_rows`) | 59 days ago | Superseded |
| `flight_detections` | 59 days ago | Dead |
| `public_air_traffic_rows` / `adsbexchange_*` | empty | Never wired |

## What I'll do (in order)

### Tier 0 — Fix the live tracker source order (do this first)

1. **Reorder `opensky-fetch`** so RapidAPI/ADSBExchange is PRIMARY, OpenSky is FALLBACK, and adsb.lol becomes a tertiary fallback (don't remove it — useful when RapidAPI quota burns out).
2. **Add a `data_source` tag** on every row written to `live_flight_detections_rows` so you can prove in court which records came from which API.
3. **Add a "source" badge** to `LiveFlightTracker.tsx` showing which API served each fetch (LIVE: ADSBX vs OpenSky vs adsb.lol).

### Tier 1 — Restart the dead alert pipelines

4. **Restart Sentinel + Watchtower writers** via a `pg_cron` job that calls `josiah-sentinel` every 2 minutes against the last 10 min of `live_flight_detections_rows`.
5. **Add a freshness watchdog** edge function (`detection-watchdog`) that flags any source whose `MAX(timestamp)` is > 10 min stale, surfaced as a red banner in the dashboard. No more silent failures like the last 12 hours of dead alerts.

### Tier 2 — Consolidate the noise

6. **Create canonical view `v_canonical_detections`** unioning live detections + populated ADSBExchange table, normalized to one schema. Dashboards/agents read only from this view.
7. **Rewrite `useNeonDatabase.getUnifiedFlights`** and `RealtimeAlertBanner` to query `v_canonical_detections` instead of bare table names.
8. **Quarantine zombie tables** by renaming them to `legacy_*` (no deletes — preserves forensic chain of custody per your immutable audit policy).

### Tier 3 — New detection rules (more alerts)

9. **Add 4 detection rules** to Sentinel that aren't currently checked:
   - **Sub-stall physics**: speed < 48 kts AND altitude > 0 → drone or transponder spoof
   - **Loiter / orbit**: same registration ≥ 5 detections in 15 min within 2 nm of residence (35.4376, -119.0226)
   - **Mode switching**: same `icao` flips between distinct registrations (transponder unmask)
   - **Coordinated swarm**: ≥ 3 distinct registrations within 2 nm + 2 min (Hammer-Anvil)
10. **Backlog reprocess** — run rules 9a–9d once over the last 30 days of `live_flight_detections_rows` to retroactively populate `sentinel_learned_threats`.

### Tier 4 — Schema hygiene

11. Cast text-typed timestamp columns (`alert_logs.created_at`, `realtime_aircraft_detections.detection_time`) to `timestamptz` so they participate in time queries.

## Technical notes

- **Source-reorder edits** are localized to `supabase/functions/opensky-fetch/index.ts` (lines ~410–530): swap the adsb.lol block with the RapidAPI block, keep adsb.lol as new tertiary.
- **`data_source` column**: `ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'rapidapi_adsbx';` then populate from the existing `dataSource` variable in the writer.
- **Cron schedule** uses `pg_cron` + `pg_net` per Lovable Cloud pattern — written via `psql` insert (not a migration) since it includes URL/anon key.
- **No tables dropped** — all consolidation is via rename + view (forensic immutability rule).

## Order of operations (estimated impact)

| Step | What changes | When you'll see it |
|---|---|---|
| Tier 0 (1–3) | RapidAPI becomes primary, source visible in UI | ~2 min after deploy |
| Tier 1 (4–5) | Alerts start flowing again, freshness watchdog | ~5 min |
| Tier 2 (6–8) | Single canonical feed, zombie tables quarantined | ~15 min |
| Tier 3 (9–10) | Hundreds of new historical threats appear | ~10 min for backfill |
| Tier 4 (11) | Legacy tables become queryable again | ~2 min |

Approving this plan switches me to build mode and I'll execute Tier 0 → Tier 4 in that order.
