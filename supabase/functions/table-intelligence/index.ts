// Table Intelligence Catalog — Phase 1 of the Discovery Layer
// Scans every table in Neon, classifies by domain, identifies entity columns,
// and produces a searchable map. Also supports per-entity cross-table lookup.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---- Domain classification heuristics ----
// Each domain has keyword patterns matched against table_name + column names.
const DOMAINS: { domain: string; patterns: RegExp[] }[] = [
  { domain: "flight",     patterns: [/flight|adsb|opensky|detection|track|telemetry|live_|aircraft_position|opensky/i] },
  { domain: "aircraft",   patterns: [/aircraft|registry|tail|n_number|icao|faa_|fleet|operator/i] },
  { domain: "biometric",  patterns: [/biometric|whoop|heart|hrv|stress|ecg|sleep|recovery|hr_/i] },
  { domain: "legal",      patterns: [/legal|case|exhibit|statute|complaint|filing|rico|foia|violation/i] },
  { domain: "financial",  patterns: [/shell|company|ein|sos|llc|corp|owner|registrant|funding|grant|contract|vendor/i] },
  { domain: "ai_pattern", patterns: [/pattern|ai_|ml_|anomaly|score|confidence|cluster|embed|rag_|josiah/i] },
  { domain: "kcso_mil",   patterns: [/kcso|sheriff|posse|military|navy|army|blackhawk|huey|nws|china_lake|national_guard/i] },
  { domain: "geo",        patterns: [/oildale|residence|aoi|hq|location|address|geo_|lat|lng|coord/i] },
  { domain: "audit",      patterns: [/audit|merkle|hash|chain|provenance|sha256|inventory|snapshot/i] },
  { domain: "report",     patterns: [/report|brief|narrative|summary|sentinel|daily|witness/i] },
];

// Canonical entity column aliases — same identity, different names across tables
const ENTITY_ALIASES: { canonical: string; aliases: string[] }[] = [
  { canonical: "aircraft_id", aliases: ["icao24","icao","registration","tail_number","tail","n_number","linked_aircraft","linked_aircraft_tail","aircraft_id","reg","callsign"] },
  { canonical: "company_id",  aliases: ["company_name","ein","entity_name","registrant_name","operator","operator_name","llc_name","shell_name"] },
  { canonical: "person_id",   aliases: ["person","name","officer","agent","pilot","owner_name"] },
  { canonical: "case_id",     aliases: ["case_id","case_code","exhibit_id","statute","violation_id"] },
  { canonical: "geo",         aliases: ["lat","latitude","lng","longitude","geo_lat","geo_lng"] },
  { canonical: "time",        aliases: ["timestamp","ts","observed_at","event_timestamp","created_at","scraped_at","first_seen","last_seen"] },
];

function classifyDomain(tableName: string, columns: string[]): string[] {
  const haystack = (tableName + " " + columns.join(" ")).toLowerCase();
  const matches: string[] = [];
  for (const d of DOMAINS) {
    if (d.patterns.some((p) => p.test(haystack))) matches.push(d.domain);
  }
  return matches.length ? matches : ["uncategorized"];
}

function detectEntities(columns: string[]): { canonical: string; column: string }[] {
  const found: { canonical: string; column: string }[] = [];
  const lower = columns.map((c) => c.toLowerCase());
  for (const e of ENTITY_ALIASES) {
    for (const a of e.aliases) {
      const idx = lower.findIndex((c) => c === a || c.endsWith("_" + a));
      if (idx >= 0) {
        found.push({ canonical: e.canonical, column: columns[idx] });
        break;
      }
    }
  }
  return found;
}

function qualityScore(rowCount: number, hasEntity: boolean, domains: string[]): "high" | "medium" | "low" {
  // Small, manually-curated tables with strong entity columns are HIGH value
  if (hasEntity && rowCount > 0 && rowCount < 5000) return "high";
  if (hasEntity && domains.some((d) => ["legal","financial","kcso_mil","biometric"].includes(d))) return "high";
  if (rowCount === 0) return "low";
  return "medium";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("NEON_DATABASE_URL");
  if (!url) return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not set" }), { status: 500, headers: corsHeaders });

  const sql = postgres(url, {
    max: 8, idle_timeout: 20, connect_timeout: 10, prepare: false,
    connection: { statement_timeout: "3000" },
  });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "buildCatalog";

    if (action === "buildCatalog") {
      // 1. Pull every table + columns from public + legacy schemas
      const cols = await sql`
        SELECT table_schema, table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog','information_schema','auth','storage','realtime','supabase_functions','vault','extensions','net','graphql','graphql_public')
        ORDER BY table_schema, table_name, ordinal_position
      `;
      // 2. Pull row count estimates
      const counts = await sql`
        SELECT n.nspname AS schema, c.relname AS table, GREATEST(c.reltuples,0)::bigint AS rows
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema','auth','storage','realtime','supabase_functions','vault','extensions','net','graphql','graphql_public')
      `;
      const countMap = new Map<string, number>();
      for (const r of counts) countMap.set(`${r.schema}.${r.table}`, Number(r.rows));

      // 3. Group columns by table
      const byTable = new Map<string, { schema: string; table: string; columns: string[] }>();
      for (const c of cols) {
        const key = `${c.table_schema}.${c.table_name}`;
        if (!byTable.has(key)) byTable.set(key, { schema: c.table_schema, table: c.table_name, columns: [] });
        byTable.get(key)!.columns.push(c.column_name);
      }

      // 4. Build catalog entries
      const catalog = [];
      const domainCounts: Record<string, number> = {};
      const entityIndex: Record<string, { table: string; column: string; rows: number }[]> = {};

      for (const [key, t] of byTable) {
        const rows = countMap.get(key) ?? 0;
        const domains = classifyDomain(t.table, t.columns);
        const entities = detectEntities(t.columns);
        const quality = qualityScore(rows, entities.length > 0, domains);

        catalog.push({
          schema: t.schema, table: t.table, full_name: key,
          row_count: rows, column_count: t.columns.length,
          domains, entities, quality,
          sample_columns: t.columns.slice(0, 10),
        });

        for (const d of domains) domainCounts[d] = (domainCounts[d] ?? 0) + 1;
        for (const e of entities) {
          if (!entityIndex[e.canonical]) entityIndex[e.canonical] = [];
          entityIndex[e.canonical].push({ table: key, column: e.column, rows });
        }
      }

      catalog.sort((a, b) => {
        const qOrd = { high: 0, medium: 1, low: 2 };
        if (qOrd[a.quality] !== qOrd[b.quality]) return qOrd[a.quality] - qOrd[b.quality];
        return b.row_count - a.row_count;
      });

      return new Response(JSON.stringify({
        scanned_at: new Date().toISOString(),
        summary: {
          total_tables: catalog.length,
          high_quality: catalog.filter((c) => c.quality === "high").length,
          medium_quality: catalog.filter((c) => c.quality === "medium").length,
          low_quality: catalog.filter((c) => c.quality === "low").length,
          domain_counts: domainCounts,
          canonical_entities: Object.fromEntries(Object.entries(entityIndex).map(([k, v]) => [k, v.length])),
        },
        catalog,
        entity_index: entityIndex,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "findEntity") {
      // Cross-table lookup for a single identifier (e.g. "N229AM")
      const term = String(body.term ?? "").trim();
      if (!term) return new Response(JSON.stringify({ error: "term required" }), { status: 400, headers: corsHeaders });

      // Pull columns + row estimates to skip mega-tables that would time out
      const cols = await sql`
        SELECT c.table_schema, c.table_name, c.column_name,
               COALESCE(pc.reltuples, 0)::bigint AS rows
        FROM information_schema.columns c
        LEFT JOIN pg_namespace pn ON pn.nspname = c.table_schema
        LEFT JOIN pg_class pc ON pc.relname = c.table_name AND pc.relnamespace = pn.oid AND pc.relkind = 'r'
        WHERE c.table_schema NOT IN ('pg_catalog','information_schema','auth','storage','realtime','supabase_functions','vault','extensions','net','graphql','graphql_public')
      `;

      const aircraftAliases = ENTITY_ALIASES.find((e) => e.canonical === "aircraft_id")!.aliases;
      const MAX_ROWS = Number(body.max_rows ?? 500_000); // skip tables larger than this
      const MAX_TARGETS = Number(body.max_targets ?? 80); // hard cap on probes
      const targets: { table: string; column: string; rows: number }[] = [];
      for (const c of cols) {
        if (!aircraftAliases.includes(c.column_name.toLowerCase())) continue;
        const rows = Number(c.rows ?? 0);
        if (rows > MAX_ROWS) continue;
        targets.push({ table: `"${c.table_schema}"."${c.table_name}"`, column: c.column_name, rows });
      }
      // Smaller tables first — they're fastest and most likely curated
      targets.sort((a, b) => a.rows - b.rows);

      // Global deadline so we never exceed the edge timeout
      const DEADLINE_MS = Number(body.deadline_ms ?? 90_000);
      const startedAt = Date.now();

      const upperTerm = term.toUpperCase();
      const lowerTerm = term.toLowerCase();
      const variants = Array.from(new Set([term, upperTerm, lowerTerm, upperTerm.replace(/^N/, ""), lowerTerm.replace(/^n/, "")]));
      const probe = async (t: { table: string; column: string; rows: number }) => {
        if (Date.now() - startedAt > DEADLINE_MS) return null;
        try {
          const q = `SELECT COUNT(*)::int AS n FROM ${t.table} WHERE "${t.column}"::text ILIKE ANY($1::text[])`;
          const r = await sql.unsafe(q, [variants]);
          const n = Number(r[0]?.n ?? 0);
          return n > 0 ? { table: t.table.replace(/"/g, ""), column: t.column, matches: n } : null;
        } catch (e) { return null; }
      };

      const hits: any[] = [];
      const BATCH = 8;
      const slice = targets.slice(0, MAX_TARGETS);
      let probed = 0;
      for (let i = 0; i < slice.length; i += BATCH) {
        if (Date.now() - startedAt > DEADLINE_MS) break;
        const results = await Promise.all(slice.slice(i, i + BATCH).map(probe));
        probed += slice.slice(i, i + BATCH).length;
        for (const r of results) if (r) hits.push(r);
      }
      hits.sort((a, b) => b.matches - a.matches);

      return new Response(JSON.stringify({
        term,
        targets_probed: slice.length,
        targets_skipped_too_large: targets.length === 0 ? 0 : Math.max(0, cols.filter((c: any) => aircraftAliases.includes(c.column_name.toLowerCase())).length - slice.length),
        total_tables_with_hits: hits.length,
        total_records_across_db: hits.reduce((s, h) => s + h.matches, 0),
        hits,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await sql.end();
  }
});
