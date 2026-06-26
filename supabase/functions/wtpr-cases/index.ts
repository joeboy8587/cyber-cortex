// WTPR Case System Adapter — surfaces WTPR case records from Neon for the dashboard.
// Auto-detects the WTPR table name across schema variants.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CANDIDATE_TABLES = [
  "wtpr_cases", "wtpr_case_files", "wtpr_case", "wtpr_records",
  "wtpr_case_system", "wtpr", "wtpr_evidence",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const neonUrl = Deno.env.get("NEON_DATABASE_URL");
  if (!neonUrl) return jerr("NEON_DATABASE_URL missing", 500);

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "list";
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 500);
    const filter: string = String(body.search || "").trim();

    sql = postgres(neonUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '30000'`).catch(() => {});

    // Detect available WTPR-like tables
    const detected = await sql.unsafe(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type='BASE TABLE'
        AND lower(table_name) SIMILAR TO '%(wtpr|case_file|case_record)%'
        AND table_schema NOT IN ('pg_catalog','information_schema')
      ORDER BY table_name
      LIMIT 50
    `) as any[];

    if (action === "detect") {
      return ok({ candidates: detected });
    }

    if (detected.length === 0) {
      return ok({ ok: true, tables: [], cases: [], message: "No WTPR-style tables found in Neon yet." });
    }

    // Use the first candidate that matches our list or just first detected
    const preferred = detected.find((t: any) => CANDIDATE_TABLES.includes(t.table_name)) || detected[0];
    const tableName = `"${preferred.table_schema}"."${preferred.table_name}"`;

    // Get column list to build a safe SELECT *
    const cols = await sql.unsafe(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2
      ORDER BY ordinal_position
    `, [preferred.table_schema, preferred.table_name]) as any[];

    const colNames = cols.map((c: any) => c.column_name.toLowerCase());
    const timeCol = ["updated_at", "created_at", "case_date", "event_time", "ts", "timestamp"]
      .find(c => colNames.includes(c));
    const orderBy = timeCol ? `ORDER BY "${timeCol}" DESC` : "";

    let where = "";
    if (filter) {
      const textCols = cols
        .filter((c: any) => /char|text/i.test(c.data_type || ""))
        .map((c: any) => `"${c.column_name}"::text ILIKE '%${filter.replace(/'/g, "''")}%'`)
        .slice(0, 10);
      if (textCols.length > 0) where = `WHERE ${textCols.join(" OR ")}`;
    }

    const cases = await sql.unsafe(
      `SELECT * FROM ${tableName} ${where} ${orderBy} LIMIT ${limit}`
    ) as any[];

    const stats = await sql.unsafe(`SELECT COUNT(*) AS total FROM ${tableName}`) as any[];

    return ok({
      ok: true,
      table: `${preferred.table_schema}.${preferred.table_name}`,
      detected,
      columns: cols.map((c: any) => ({ name: c.column_name, type: c.data_type })),
      total: Number(stats[0]?.total || 0),
      cases,
    });
  } catch (e: any) {
    return jerr(String(e?.message || e), 500);
  } finally {
    try { await sql?.end({ timeout: 5 }); } catch {}
  }

  function ok(payload: any) {
    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  function jerr(message: string, status: number) {
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
