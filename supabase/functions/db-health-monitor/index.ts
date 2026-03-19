import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const databaseUrl = Deno.env.get("NEON_DATABASE_URL");
  if (!databaseUrl) {
    return new Response(
      JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let sql: ReturnType<typeof postgres> | null = null;

  try {
    const { action } = await req.json();
    sql = postgres(databaseUrl, { ssl: "require", max: 1, idle_timeout: 30 });

    let result: unknown;

    switch (action) {

      // ──────────────────────────────────────────────
      // BLOAT + TABLE HEALTH STATS
      // ──────────────────────────────────────────────
      case "bloatStats": {
        const rows = await sql`
          SELECT
            relname AS table_name,
            n_live_tup AS live_rows,
            n_dead_tup AS dead_rows,
            CASE WHEN (n_live_tup + n_dead_tup) > 0
              THEN ROUND(n_dead_tup::numeric / (n_live_tup + n_dead_tup) * 100, 1)
              ELSE 0
            END AS bloat_pct,
            pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
            pg_total_relation_size(relid) AS total_size_bytes,
            last_vacuum,
            last_autovacuum,
            last_analyze
          FROM pg_stat_user_tables
          ORDER BY n_dead_tup DESC
          LIMIT 30
        `;
        result = { bloat: rows };
        break;
      }

      // ──────────────────────────────────────────────
      // VACUUM ANALYZE on bloated tables
      // ──────────────────────────────────────────────
      case "vacuumTable": {
        const body = await req.json().catch(() => ({}));
        const tableName = (body.table || "live_flight_detections_rows").replace(/[^a-zA-Z0-9_]/g, "");

        // VACUUM cannot run in a transaction, use unsafe
        await sql.unsafe(`VACUUM ANALYZE ${tableName}`);
        result = { vacuumed: tableName, timestamp: new Date().toISOString() };
        break;
      }

      case "vacuumAll": {
        const bloated = await sql`
          SELECT relname AS table_name
          FROM pg_stat_user_tables
          WHERE n_dead_tup > 1000
          ORDER BY n_dead_tup DESC
          LIMIT 10
        `;

        const outcomes: { table: string; ok: boolean; error?: string }[] = [];
        for (const row of bloated) {
          const t = (row.table_name as string).replace(/[^a-zA-Z0-9_]/g, "");
          try {
            await sql.unsafe(`VACUUM ANALYZE ${t}`);
            outcomes.push({ table: t, ok: true });
          } catch (e) {
            outcomes.push({ table: t, ok: false, error: (e as Error).message });
          }
        }
        result = { outcomes };
        break;
      }

      // ──────────────────────────────────────────────
      // INDEX HEALTH
      // ──────────────────────────────────────────────
      case "indexHealth": {
        const rows = await sql`
          SELECT
            schemaname,
            relname AS tablename,
            indexrelname AS indexname,
            idx_scan,
            idx_tup_read,
            idx_tup_fetch,
            pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
            pg_relation_size(indexrelid) AS index_size_bytes
          FROM pg_stat_user_indexes
          ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC
          LIMIT 40
        `;
        result = { indexes: rows };
        break;
      }

      // ──────────────────────────────────────────────
      // SCHEMA SPRAWL CENSUS
      // ──────────────────────────────────────────────
      case "schemaCensus": {
        const tables = await sql`
          SELECT
            t.table_name,
            pg_size_pretty(pg_total_relation_size(('public.' || t.table_name)::regclass)) AS size,
            pg_total_relation_size(('public.' || t.table_name)::regclass) AS size_bytes,
            s.n_live_tup AS live_rows,
            s.n_dead_tup AS dead_rows
          FROM information_schema.tables t
          LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
          WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          ORDER BY pg_total_relation_size(('public.' || t.table_name)::regclass) DESC NULLS LAST
          LIMIT 60
        `;

        const totalCount = await sql`
          SELECT COUNT(*) AS cnt
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `;

        result = { tables, total_tables: totalCount[0]?.cnt ?? 0 };
        break;
      }

      // ──────────────────────────────────────────────
      // CROSS-MODAL MATERIALIZED VIEWS
      // ──────────────────────────────────────────────
      case "createCrossModalViews": {
        const log: string[] = [];

        // 1. Flight ↔ Biometric convergence (30-day window)
        await sql.unsafe(`
          CREATE MATERIALIZED VIEW IF NOT EXISTS mv_flight_bio_convergence AS
          SELECT
            date_trunc('day', f.detection_timestamp) AS event_day,
            f.registration,
            COUNT(DISTINCT f.id) AS flight_detections,
            COUNT(DISTINCT b.id) AS bio_readings,
            AVG(b.heart_rate)::numeric(6,1) AS avg_heart_rate,
            AVG(b.stress_level)::numeric(6,1) AS avg_stress,
            MAX(b.medical_alert::int) = 1 AS had_medical_alert
          FROM live_flight_detections_rows f
          JOIN biometric_monitoring b
            ON date_trunc('day', f.detection_timestamp) = date_trunc('day', b.measurement_timestamp)
          WHERE f.detection_timestamp >= NOW() - INTERVAL '30 days'
            AND b.measurement_timestamp >= NOW() - INTERVAL '30 days'
          GROUP BY 1, 2
          ORDER BY event_day DESC
        `).then(() => log.push("✓ mv_flight_bio_convergence")).catch(e => log.push(`✗ mv_flight_bio_convergence: ${e.message}`));

        // 2. Flight ↔ Forensic Events timeline (90-day window)
        await sql.unsafe(`
          CREATE MATERIALIZED VIEW IF NOT EXISTS mv_flight_legal_timeline AS
          SELECT
            date_trunc('day', mfe.event_timestamp) AS event_day,
            mfe.event_type,
            COUNT(DISTINCT mfe.forensic_event_id) AS forensic_events,
            COUNT(DISTINCT f.id) AS correlated_flights,
            AVG(mfe.confidence_score)::numeric(5,1) AS avg_confidence,
            AVG(mfe.bradford_hill_score)::numeric(5,2) AS avg_bradford_hill,
            MAX(mfe.is_physical_verified::int) = 1 AS physically_verified
          FROM master_forensic_events mfe
          LEFT JOIN live_flight_detections_rows f
            ON date_trunc('day', mfe.event_timestamp) = date_trunc('day', f.detection_timestamp)
            AND f.detection_timestamp >= NOW() - INTERVAL '90 days'
          WHERE mfe.event_timestamp >= NOW() - INTERVAL '90 days'
          GROUP BY 1, 2
          ORDER BY event_day DESC
        `).then(() => log.push("✓ mv_flight_legal_timeline")).catch(e => log.push(`✗ mv_flight_legal_timeline: ${e.message}`));

        // 3. Entity threat summary (all time, from entity_registry)
        await sql.unsafe(`
          CREATE MATERIALIZED VIEW IF NOT EXISTS mv_entity_threat_summary AS
          SELECT
            er.entity_type,
            er.threat_classification,
            COUNT(*) AS entity_count,
            COUNT(CASE WHEN er.threat_classification IS NOT NULL THEN 1 END) AS classified_count,
            MIN(er.first_seen) AS earliest_seen,
            MAX(er.last_seen) AS latest_seen
          FROM entity_registry er
          GROUP BY er.entity_type, er.threat_classification
          ORDER BY entity_count DESC
        `).then(() => log.push("✓ mv_entity_threat_summary")).catch(e => log.push(`✗ mv_entity_threat_summary: ${e.message}`));

        // Indexes
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cv_fbc_day ON mv_flight_bio_convergence (event_day DESC)`).catch(() => {});
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cv_flt_day ON mv_flight_legal_timeline (event_day DESC)`).catch(() => {});
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_cv_ets_type ON mv_entity_threat_summary (entity_type)`).catch(() => {});

        result = { created: log };
        break;
      }

      case "refreshCrossModalViews": {
        const views = ["mv_flight_bio_convergence", "mv_flight_legal_timeline", "mv_entity_threat_summary"];
        const log: { view: string; ok: boolean; duration?: number; error?: string }[] = [];

        for (const v of views) {
          // Check existence first
          const exists = await sql`SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = ${v}) AS e`;
          if (!exists[0]?.e) {
            log.push({ view: v, ok: false, error: "Does not exist — run createCrossModalViews first" });
            continue;
          }
          const t0 = Date.now();
          try {
            await sql.unsafe(`REFRESH MATERIALIZED VIEW ${v}`);
            log.push({ view: v, ok: true, duration: Date.now() - t0 });
          } catch (e) {
            log.push({ view: v, ok: false, error: (e as Error).message });
          }
        }
        result = { refreshed: log };
        break;
      }

      // ──────────────────────────────────────────────
      // LIVE HEALTH SUMMARY (single call for dashboard)
      // ──────────────────────────────────────────────
      case "healthSummary": {
        const [bloatTop, indexUnused, tableCount, matviewCount] = await Promise.all([
          sql`
            SELECT relname AS table_name, n_dead_tup AS dead_rows,
              CASE WHEN (n_live_tup + n_dead_tup) > 0
                THEN ROUND(n_dead_tup::numeric / (n_live_tup + n_dead_tup) * 100, 1)
                ELSE 0 END AS bloat_pct,
              pg_size_pretty(pg_total_relation_size(relid)) AS size
            FROM pg_stat_user_tables
            ORDER BY n_dead_tup DESC LIMIT 5
          `,
          sql`
            SELECT indexname, tablename, idx_scan,
              pg_size_pretty(pg_relation_size(indexrelid)) AS size
            FROM pg_stat_user_indexes
            WHERE idx_scan = 0
            ORDER BY pg_relation_size(indexrelid) DESC LIMIT 5
          `,
          sql`SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
          sql`SELECT COUNT(*) AS cnt FROM pg_matviews WHERE schemaname='public'`,
        ]);

        const totalBloat = await sql`
          SELECT COALESCE(SUM(n_dead_tup),0) AS total_dead
          FROM pg_stat_user_tables
        `;

        result = {
          total_dead_rows: Number(totalBloat[0]?.total_dead ?? 0),
          total_tables: Number(tableCount[0]?.cnt ?? 0),
          total_matviews: Number(matviewCount[0]?.cnt ?? 0),
          top_bloated: bloatTop,
          top_unused_indexes: indexUnused,
        };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await sql.end();
    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("db-health-monitor error:", err);
    if (sql) { try { await sql.end(); } catch { /* ignore */ } }
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
