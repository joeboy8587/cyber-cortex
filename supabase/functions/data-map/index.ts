// Data Map — one-pass census of the Neon investigation database.
// Reads only catalog statistics (pg_class, pg_stat_user_tables, pg_stats): no table scans,
// so it finishes in seconds on 1,000+ tables. Nothing is ever modified or deleted.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const CATS: [string, RegExp][] = [
  ["Biometric", /biometr|whoop|ecg|heart|hrv|vital|_hr_|sleep|stress/],
  ["OCR / screenshots", /ocr|screenshot|vlm|image|vision|f24|photo/],
  ["FAA registry", /faa|registry|n_number|aircraft_ref|acftref|dereg/],
  ["Shell / corporate", /shell|compan|corporat|_sos|entity|operator|owner|registrant|llc/],
  ["Documents / embeddings", /rag_|embed|vector|chunk|document|dossier|knowledge/],
  ["Evidence / legal", /evidence|exhibit|case|legal|merkle|audit|custody|court/],
  ["Findings / AI", /wt_|josiah|finding|flag|threat|anomal|sentinel|learn|agent|ml_|score|insight|pattern/],
  ["Flight / ADS-B", /flight|detection|adsb|aircraft|track|mlat|xxb|opensky|ping|position|trajector|airspace|sweep|spacetime|hover|orbit/],
];
// The one table each data type should be read from (others are labelled copies).
const MAIN: Record<string, string> = {
  "Flight / ADS-B": "public.live_flight_detections_rows",
  "FAA registry": "public.faa_master",
  "Biometric": "public.unified_biometric_aircraft_correlation_final",
  "Documents / embeddings": "public.rag_chunks",
};
const TIME_COL = /^(detection_timestamp|timestamp|ts|event_time|recorded_at|observed_at|captured_at|created_at|time|datetime|date)$/;

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

function grade(q: { rows: number; timeNull: number | null; posNull: number | null; idNull: number | null; daysOld: number | null; analyzed: boolean }) {
  if (q.rows === 0) return { grade: "—", issues: ["Empty"] };
  let pts = 100; const issues: string[] = [];
  if (q.timeNull == null) { pts -= 15; issues.push("No time column"); }
  else if (q.timeNull > 0.05) { pts -= Math.round(q.timeNull * 40); issues.push(`${Math.round(q.timeNull * 100)}% missing times`); }
  if (q.posNull != null && q.posNull > 0.05) { pts -= Math.round(q.posNull * 30); issues.push(`${Math.round(q.posNull * 100)}% missing positions`); }
  if (q.idNull != null && q.idNull > 0.1) { pts -= Math.round(q.idNull * 25); issues.push(`${Math.round(q.idNull * 100)}% missing aircraft ID`); }
  if (!q.analyzed) { pts -= 15; issues.push("Never checked by the database — count may be off"); }
  if (q.daysOld != null && q.daysOld > 90) { pts -= 10; issues.push(`No new data for ${q.daysOld} days`); }
  const g = pts >= 85 ? "A" : pts >= 70 ? "B" : pts >= 55 ? "C" : pts >= 40 ? "D" : "F";
  return { grade: g, issues };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (body?.action === "latest") {
    const { data } = await db.from("data_map_census").select("*").order("taken_at", { ascending: false }).limit(1).maybeSingle();
    const { data: history } = await db.from("data_map_census").select("taken_at,total_rows,table_count,sha256_hash").order("taken_at", { ascending: false }).limit(10);
    return json({ ok: true, census: data, history: history ?? [] });
  }

  const sql = postgres(Deno.env.get("NEON_DATABASE_URL")!, {
    ssl: { rejectUnauthorized: false }, max: 1, prepare: false, fetch_types: false, onnotice: () => {},
    connection: { application_name: "data-map", statement_timeout: 50000 },
  });
  try {
    const tables = await sql`
      SELECT n.nspname AS s, c.relname AS t, c.relkind AS k, GREATEST(c.reltuples,0)::bigint AS r,
             pg_total_relation_size(c.oid) AS b,
             GREATEST(st.last_analyze, st.last_autoanalyze) AS an
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables st ON st.relid = c.oid
      WHERE c.relkind IN ('r','m','p')
        AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast','realtime','auth','storage','extensions','graphql','vault','net','cron')`;
    const stats = await sql`
      SELECT schemaname AS s, tablename AS t, attname AS a, null_frac AS nf,
             CASE WHEN attname ~ '(time|_at$|^ts$|date)' THEN histogram_bounds::text END AS hb
      FROM pg_stats
      WHERE schemaname NOT IN ('pg_catalog','information_schema')
        AND (attname ~ '(time|_at$|^ts$|date|^lat|latitude|^lon|lng|longitude|registration|icao|^reg$|tail|hex)')`;
    const by = new Map<string, any[]>();
    for (const r of stats as any[]) { const k = `${r.s}.${r.t}`; (by.get(k) ?? by.set(k, []).get(k)!).push(r); }

    const now = Date.now();
    const out = (tables as any[]).map((x) => {
      const key = `${x.s}.${x.t}`; const name = x.t.toLowerCase();
      const cat = CATS.find(([, re]) => re.test(name))?.[0] ?? "Unsorted";
      const cols = by.get(key) ?? [];
      const timeCols = cols.filter((c) => TIME_COL.test(c.a) || /timestamp/.test(c.a));
      const tc = timeCols.find((c) => c.a !== "created_at") ?? timeCols[0];
      let first: string | null = null, last: string | null = null;
      if (tc?.hb) {
        const parts = String(tc.hb).replace(/^\{|\}$/g, "").split(",").map((p) => p.replace(/"/g, "").trim());
        const f = Date.parse(parts[0]), l = Date.parse(parts[parts.length - 1]);
        if (Number.isFinite(f) && Number.isFinite(l) && f > Date.parse("2000-01-01")) { first = new Date(f).toISOString(); last = new Date(l).toISOString(); }
      }
      const minNull = (re: RegExp) => { const m = cols.filter((c) => re.test(c.a)).map((c) => Number(c.nf)); return m.length ? Math.min(...m) : null; };
      const rows = Number(x.r);
      const daysOld = last ? Math.round((now - Date.parse(last)) / 86400000) : null;
      const q = grade({
        rows, timeNull: tc ? Number(tc.nf) : null, posNull: minNull(/^lat|latitude/),
        idNull: cat === "Flight / ADS-B" ? minNull(/registration|icao|^reg$|tail|hex/) : null,
        daysOld, analyzed: !!x.an || rows < 1000,
      });
      const legacy = /legacy|recovery|_\d{8}|forensic_oct|backup|_bak|_old|copy|temp|tmp/.test(`${x.s}.${name}`);
      const role = rows === 0 ? "empty" : MAIN[cat] === key ? "main" : legacy ? "snapshot" : "copy_or_side";
      return { schema: x.s, table: x.t, kind: x.k === "m" ? "view" : "table", category: cat, rows, bytes: Number(x.b),
        first_seen: first, last_seen: last, grade: q.grade, issues: q.issues, role };
    }).sort((a, b) => b.rows - a.rows);

    const byCat: Record<string, any> = {};
    for (const t of out) {
      const c = byCat[t.category] ??= { tables: 0, rows: 0, empty: 0, main: MAIN[t.category] ?? null, main_rows: null, first: null, last: null, grades: {} };
      c.tables++; c.rows += t.rows; if (t.rows === 0) c.empty++;
      if (t.role === "main") c.main_rows = t.rows;
      c.grades[t.grade] = (c.grades[t.grade] ?? 0) + 1;
      if (t.first_seen && (!c.first || t.first_seen < c.first)) c.first = t.first_seen;
      if (t.last_seen && (!c.last || t.last_seen > c.last)) c.last = t.last_seen;
    }
    const totals = { table_count: out.length, total_rows: out.reduce((s, t) => s + t.rows, 0),
      total_bytes: out.reduce((s, t) => s + t.bytes, 0), empty_tables: out.filter((t) => t.rows === 0).length };
    const hash = await sha256(JSON.stringify({ totals, out }));
    const { data: saved, error } = await db.from("data_map_census")
      .insert({ ...totals, by_category: byCat, tables: out, sha256_hash: hash }).select("*").maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, census: saved });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  } finally {
    try { await sql.end(); } catch { /* noop */ }
  }
});
