// Military Tanker Network Analysis
// Finds air-refueling tankers (KC-135/KC-46/KC-10) and their probable receivers
// via space-time co-presence (< ~20 nm, ±10 min, altitude within ±3000 ft, > FL180).
// Returns { nodes, edges, encounters } for a force-directed graph.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Common USAF tanker callsign prefixes (KC-135 / KC-46 / KC-10)
const TANKER_CALLSIGN_PREFIXES = [
  "PACK", "TEAM", "GOLD", "ESSO", "SHELL", "QID", "BLUE", "ROMA",
  "KING", "GASSR", "COKE", "PEPSI", "BREW", "TOGA", "PANTHR",
  "TIGER", "DIESEL", "JOLLY", "OMEGA", "TEXACO",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) return json({ ok: false, error: "NEON_DATABASE_URL missing" }, 500);

  const body = await req.json().catch(() => ({}));
  const days = Math.max(1, Math.min(Number(body.days ?? 30), 180));
  const proximityNm = Number(body.proximityNm ?? 25);
  const timeWindowMin = Number(body.timeWindowMin ?? 15);
  const minAltFt = Number(body.minAltFt ?? 15000);
  const maxEncounters = Math.min(Number(body.maxEncounters ?? 2000), 10000);

  const sql = postgres(NEON, {
    ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 15, prepare: false,
    connection: { statement_timeout: 45000 },
  });

  try {
    await sql.unsafe(`SET statement_timeout = '45s'`).catch(() => {});

    const prefixPattern = TANKER_CALLSIGN_PREFIXES.map(p => `${p}%`);

    // Detect columns available on live_flight_detections_rows
    const colRows = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='live_flight_detections_rows'
    ` as Array<{column_name: string}>;
    const have = new Set(colRows.map(r => r.column_name));
    const typeCol = have.has("aircraft_type_desc") ? "aircraft_type_desc"
                   : have.has("aircraft_type") ? "aircraft_type" : "NULL";
    const opCol = have.has("owner_operator") ? "owner_operator"
                 : have.has("faa_registrant_name") ? "faa_registrant_name" : "NULL";
    // The detection table uses icao24 / icao_code (not "hex") and
    // detection_timestamp (not "event_time"). Resolve defensively.
    const hexCol = have.has("icao24") ? "icao24"
                  : have.has("icao_code") ? "icao_code"
                  : have.has("hex") ? "hex" : "NULL";
    const timeCol = have.has("detection_timestamp") ? "detection_timestamp"
                   : have.has("event_time") ? "event_time" : "created_at";
    const altCol = have.has("altitude") ? "altitude"
                  : have.has("altitude_ft") ? "altitude_ft" : "NULL";

    // 1) Identify tanker tracks (sampled)
    const tankers = await sql.unsafe(`
      SELECT ${hexCol} AS hex, callsign, ${typeCol} AS aircraft_type, ${opCol} AS operator,
             ${timeCol} AS event_time, latitude, longitude, ${altCol} AS altitude
      FROM live_flight_detections_rows
      WHERE ${timeCol} >= NOW() - INTERVAL '${days} days'
        AND ${altCol} >= ${minAltFt}
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND (
          ${typeCol} ILIKE 'KC-135%' OR ${typeCol} ILIKE 'KC-46%' OR ${typeCol} ILIKE 'KC-10%'
          OR ${typeCol} ILIKE '%tanker%'
          OR callsign ILIKE ANY (ARRAY[${prefixPattern.map(p => `'${p}'`).join(",")}])
        )
      LIMIT 5000
    `) as any[];


    if (tankers.length === 0) {
      return json({ ok: true, nodes: [], edges: [], encounters: [], stats: { tankers: 0, receivers: 0, encounters: 0 } });
    }

    // 2) For each tanker sample, find co-present aircraft within window
    const encounters: any[] = [];
    const nodeMap = new Map<string, any>();
    const edgeMap = new Map<string, any>();
    const upsertNode = (hex: string, callsign: string, type: string, op: string, role: "tanker" | "receiver") => {
      const key = hex || callsign;
      if (!key) return;
      const existing = nodeMap.get(key);
      if (existing) {
        existing.count += 1;
        if (role === "tanker") existing.role = "tanker";
      } else {
        nodeMap.set(key, { id: key, hex, callsign: callsign || "—", aircraft_type: type || "", operator: op || "", role, count: 1 });
      }
    };

    // Sample tankers (limit workload) — take first 250 rows
    const sampledTankers = tankers.slice(0, 250);
    for (const t of sampledTankers) {
      if (encounters.length >= maxEncounters) break;
      const nearby = await sql.unsafe(`
        SELECT ${hexCol} AS hex, callsign, ${typeCol} AS aircraft_type, ${opCol} AS operator,
               ${timeCol} AS event_time, latitude, longitude, ${altCol} AS altitude,
               (
                 3440.065 * acos(LEAST(1.0,
                   cos(radians(${t.latitude})) * cos(radians(latitude)) *
                   cos(radians(longitude) - radians(${t.longitude})) +
                   sin(radians(${t.latitude})) * sin(radians(latitude))
                 ))
               ) AS dist_nm
        FROM live_flight_detections_rows
        WHERE ${timeCol} BETWEEN ('${new Date(t.event_time).toISOString()}'::timestamptz - INTERVAL '${timeWindowMin} minutes')
                             AND ('${new Date(t.event_time).toISOString()}'::timestamptz + INTERVAL '${timeWindowMin} minutes')
          AND ${altCol} BETWEEN ${Number(t.altitude) - 3000} AND ${Number(t.altitude) + 3000}
          AND latitude  BETWEEN ${Number(t.latitude) - 0.6}  AND ${Number(t.latitude) + 0.6}
          AND longitude BETWEEN ${Number(t.longitude) - 0.7} AND ${Number(t.longitude) + 0.7}
          AND COALESCE(${hexCol}, '') <> '${(t.hex || "").replace(/'/g, "")}'
        LIMIT 20

      `).catch(() => []) as any[];

      upsertNode(t.hex, t.callsign, t.aircraft_type, t.operator, "tanker");

      for (const r of nearby) {
        if (Number(r.dist_nm) > proximityNm) continue;
        upsertNode(r.hex, r.callsign, r.aircraft_type, r.operator, "receiver");
        const tKey = t.hex || t.callsign;
        const rKey = r.hex || r.callsign;
        if (!tKey || !rKey) continue;
        const eKey = `${tKey}|${rKey}`;
        const edge = edgeMap.get(eKey);
        if (edge) {
          edge.weight += 1;
          edge.min_dist_nm = Math.min(edge.min_dist_nm, Number(r.dist_nm));
        } else {
          edgeMap.set(eKey, {
            source: tKey, target: rKey,
            tanker_callsign: t.callsign, receiver_callsign: r.callsign,
            weight: 1, min_dist_nm: Number(r.dist_nm),
          });
        }
        encounters.push({
          tanker_hex: t.hex, tanker_callsign: t.callsign,
          receiver_hex: r.hex, receiver_callsign: r.callsign,
          receiver_type: r.aircraft_type, receiver_operator: r.operator,
          event_time: r.event_time, altitude: r.altitude,
          dist_nm: Number(Number(r.dist_nm).toFixed(2)),
          latitude: r.latitude, longitude: r.longitude,
        });
        if (encounters.length >= maxEncounters) break;
      }
    }

    const nodes = [...nodeMap.values()];
    const edges = [...edgeMap.values()].sort((a, b) => b.weight - a.weight);

    return json({
      ok: true,
      params: { days, proximityNm, timeWindowMin, minAltFt },
      stats: {
        tanker_tracks: tankers.length,
        sampled_tankers: sampledTankers.length,
        unique_tankers: nodes.filter(n => n.role === "tanker").length,
        unique_receivers: nodes.filter(n => n.role === "receiver").length,
        encounters: encounters.length,
        edges: edges.length,
      },
      nodes, edges, encounters: encounters.slice(0, 500),
    });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch {}
  }
});
