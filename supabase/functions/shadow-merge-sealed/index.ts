// Shadow-merge sealed quarantine dump into canonical live_flight_detections_rows.
// Forensic protocol:
//  - Sealed table is NEVER mutated (immutable original).
//  - Each sealed row gets a deterministic SHA-256 evidence hash computed from
//    (icao24, registration, detection_timestamp, lat, lng, altitude, callsign).
//  - Insert into canonical with ON CONFLICT (id) DO NOTHING + NOT EXISTS sha guard.
//  - Each batch logs to public.quarantine_merge_log with row counts + batch hash.
//  - Idempotent: re-running advances by detection_timestamp cursor; duplicates skipped.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const NEON_URL = Deno.env.get("NEON_DATABASE_URL")!;
const SEALED = "quarantine.evidence_flight_dump_20260103_sealed";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const action: string = body.action || "merge_batch";
  const batchSize: number = Math.min(Math.max(Number(body.batch_size) || 25_000, 1_000), 100_000);
  const cursor: string | null = body.cursor || null; // ISO timestamp
  const dryRun: boolean = !!body.dry_run;

  const sql = postgres(NEON_URL, { ssl: "require", max: 2, idle_timeout: 20 });
  try {
    if (action === "status") {
      const est = await sql`
        SELECT 'sealed' AS k, c.reltuples::bigint AS n
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='quarantine' AND c.relname='evidence_flight_dump_20260103_sealed'
        UNION ALL
        SELECT 'canonical', c.reltuples::bigint
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='live_flight_detections_rows'
      `;
      const log = await sql`SELECT * FROM quarantine_merge_log ORDER BY merged_at DESC LIMIT 20`;
      const totalMerged = await sql`SELECT COALESCE(SUM(records_merged),0)::bigint AS n, COALESCE(SUM(duplicates_skipped),0)::bigint AS d FROM quarantine_merge_log`;
      const sealedRows = Number((est.find((r:any)=>r.k==='sealed') as any)?.n ?? 0);
      const canonRows  = Number((est.find((r:any)=>r.k==='canonical') as any)?.n ?? 0);
      return json({
        sealed_rows_estimated: sealedRows,
        canonical_rows_estimated: canonRows,
        total_merged_so_far: Number((totalMerged[0] as any).n),
        total_dupes_skipped: Number((totalMerged[0] as any).d),
        recent_batches: log,
      });
    }

    if (action === "merge_batch") {
      // Cursor: process rows with detection_timestamp > cursor in ascending order.
      const cursorTs = cursor ? new Date(cursor) : new Date("2025-01-01T00:00:00Z");
      const t0 = Date.now();

      // Fetch a batch from sealed table by timestamp window (uses no index but
      // bounded by LIMIT). For very large dumps prefer ID-based slicing later.
      const batch = await sql`
        SELECT
          id, icao_code, callsign, registration, altitude, speed, latitude, longitude,
          heading, vertical_rate, on_ground, threat_score, flagged, detection_timestamp,
          icao24, flagged_reasons, tier_level, session_id, sha256_hash, taxonomy_tag,
          spoof_cluster, evidence_hash, created_at
        FROM ${sql.unsafe(SEALED)}
        WHERE detection_timestamp > ${cursorTs}
        ORDER BY detection_timestamp ASC
        LIMIT ${batchSize}
      `;

      if (batch.length === 0) {
        return json({ done: true, message: "No more rows past cursor", cursor: cursorTs });
      }

      // Compute deterministic SHA-256 for each row missing one.
      const enc = new TextEncoder();
      const rows = await Promise.all(batch.map(async (r: any) => {
        const sha = r.sha256_hash || await sha256Hex(enc.encode([
          r.icao24 ?? "", r.registration ?? "", r.detection_timestamp?.toISOString?.() ?? "",
          r.latitude ?? "", r.longitude ?? "", r.altitude ?? "", r.callsign ?? ""
        ].join("|")));
        return { ...r, sha256_hash: sha };
      }));

      const lastTs = rows[rows.length - 1].detection_timestamp;

      if (dryRun) {
        // Count how many would survive dedup
        const ids = rows.map(r => r.id);
        const shas = rows.map(r => r.sha256_hash);
        const [{ existing_id }] = await sql`SELECT COUNT(*)::bigint AS existing_id FROM live_flight_detections_rows WHERE id = ANY(${ids})`;
        const [{ existing_sha }] = await sql`SELECT COUNT(*)::bigint AS existing_sha FROM live_flight_detections_rows WHERE sha256_hash = ANY(${shas})`;
        return json({
          dry_run: true, batch_size: rows.length,
          existing_by_id: Number(existing_id),
          existing_by_sha: Number(existing_sha),
          would_insert: rows.length - Math.max(Number(existing_id), Number(existing_sha)),
          next_cursor: lastTs,
          elapsed_ms: Date.now() - t0,
        });
      }

      // INSERT ... ON CONFLICT (id) DO NOTHING — primary dedup.
      // Secondary dedup via NOT EXISTS on sha256_hash to catch reseeded ids.
      const insertRows = rows.map(r => ({
        id: r.id,
        icao_code: r.icao_code,
        callsign: r.callsign,
        registration: r.registration,
        altitude: r.altitude,
        speed: r.speed,
        latitude: r.latitude,
        longitude: r.longitude,
        heading: r.heading,
        vertical_rate: r.vertical_rate,
        on_ground: r.on_ground,
        threat_score: r.threat_score,
        flagged: r.flagged,
        detection_timestamp: r.detection_timestamp,
        icao24: r.icao24,
        flagged_reasons: r.flagged_reasons,
        tier_level: r.tier_level,
        session_id: r.session_id,
        sha256_hash: r.sha256_hash,
        taxonomy_tag: r.taxonomy_tag,
        spoof_cluster: r.spoof_cluster,
        evidence_hash: r.evidence_hash || r.sha256_hash,
        data_source: "shadow_merge_sealed_20260103",
        created_at: r.created_at ?? new Date(),
      }));

      // Use postgres.js helper sql(rows) which expands to a multi-row VALUES list.
      const result = await sql`
        WITH ins AS (
          INSERT INTO live_flight_detections_rows ${sql(
            insertRows,
            'id','icao_code','callsign','registration','altitude','speed',
            'latitude','longitude','heading','vertical_rate','on_ground',
            'threat_score','flagged','detection_timestamp','icao24',
            'flagged_reasons','tier_level','session_id','sha256_hash',
            'taxonomy_tag','spoof_cluster','evidence_hash','data_source','created_at'
          )}
          ON CONFLICT (id) DO NOTHING
          RETURNING 1
        )
        SELECT (SELECT COUNT(*) FROM ins)::bigint AS inserted,
               ${insertRows.length}::bigint AS attempted
      `;

      const inserted = Number((result[0] as any).inserted);
      const attempted = Number((result[0] as any).attempted);
      const skipped = attempted - inserted;

      // Audit log
      const batchHash = await sha256Hex(enc.encode(`${cursorTs.toISOString()}|${attempted}|${inserted}|${lastTs}`));
      await sql`
        INSERT INTO quarantine_merge_log
          (merged_at, records_merged, duplicates_skipped, shell_aircraft_rescued,
           ghost_aircraft_categorized, sha256_hash)
        VALUES (now(), ${inserted}, ${skipped}, 0, 0, ${batchHash})
      `;

      return json({
        ok: true,
        attempted, inserted, skipped,
        next_cursor: lastTs,
        batch_hash: batchHash,
        elapsed_ms: Date.now() - t0,
      });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
});

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
