// Training-readiness sweep: labels records proven / normal / exclude / unsorted.
// Additive only — never edits or deletes source records. Runs on demand only.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { classifyFlight, classifyPolicyFlag, RULE_VERSION, BULK_TIMESTAMP_THRESHOLD, type Context } from "../_shared/training_rules.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
async function sha(t: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const UNSOURCED = ["A0B312"];
const BATCH = 5000;

const Body = z.object({
  scope: z.enum(["flights", "policy_flags", "sealed_archive"]).default("flights"),
  days: z.number().int().min(1).max(90).default(30),
  cursor: z.string().max(40).optional(), // flights: ISO time; sealed_archive: page number
});
const SEALED = "quarantine.evidence_flight_dump_20260103_sealed";
const SEALED_PAGES = 400; // disk pages per call (read-only TID range scan)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") ?? "";
  const SUPA = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(SUPA, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: "Sign in required" }, 401);
  const { data: allowed } = await userClient.rpc("is_investigator_or_admin");
  if (!allowed) return json({ error: "Investigator access required" }, 403);

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
  const { scope, days, cursor } = parsed.data;
  const admin = createClient(SUPA, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Context from the app's own evidence tables
  const [threats, fleet, facts] = await Promise.all([
    admin.from("sentinel_learned_threats").select("registration").limit(5000),
    admin.from("kcso_fleet").select("tail_number"),
    admin.from("settled_facts").select("subject").eq("superseded", false).limit(5000),
  ]);
  const ctx: Context = {
    watchlist: new Set([...(threats.data ?? []).map(r => r.registration), ...(fleet.data ?? []).map(r => r.tail_number)].filter(Boolean).map(s => String(s).toUpperCase())),
    provenSubjects: new Set((facts.data ?? []).map(r => String(r.subject).toUpperCase())),
    unsourcedHex: new Set(UNSOURCED),
    faaMatched: new Set(),
  };

  const rows: Record<string, unknown>[] = [];
  let scanned = 0, nextCursor: string | null = null;

  if (scope === "policy_flags") {
    const { data, error } = await admin.from("policy_violations")
      .select("id, icao, rule_code, evidence, altitude_ft, detected_at").order("detected_at", { ascending: false }).limit(BATCH);
    if (error) return json({ error: error.message }, 500);
    for (const f of data ?? []) {
      const d = classifyPolicyFlag({ rule_code: f.rule_code, evidence: f.evidence as any, altitude_ft: f.altitude_ft });
      rows.push({ source_db: "cloud", source_table: "policy_violations", source_id: f.id, subject: f.icao, observed_at: f.detected_at, ...d });
    }
    scanned = data?.length ?? 0;
  } else {
    const NEON = Deno.env.get("NEON_DATABASE_URL");
    if (!NEON) return json({ error: "Flight database not configured" }, 500);
    const sql = postgres(NEON, { ssl: "require", max: 1, idle_timeout: 10, prepare: false });
    try {
      await sql.unsafe(`SET statement_timeout = '25s'`);
      const isSealed = scope === "sealed_archive";
      let data: any[];
      if (isSealed) {
        // Read-only page-block scan; the sealed archive is never modified.
        const page = Math.max(0, parseInt(cursor ?? "0", 10) || 0);
        const raw: any[] = await sql.unsafe(
          `SELECT to_jsonb(t) AS j FROM ${SEALED} t WHERE t.ctid >= '(${page},0)'::tid AND t.ctid < '(${page + SEALED_PAGES},0)'::tid`);
        data = raw.map(({ j }) => ({
          icao_code: j.icao24 ?? j.icao_code ?? null, registration: j.registration ?? null, callsign: j.callsign ?? null,
          ts: j.detection_timestamp, altitude: j.altitude, speed: j.speed ?? j.ground_speed ?? null,
          on_ground: j.on_ground ?? null, taxonomy_tag: j.taxonomy_tag ?? null,
        })).filter(r => r.ts);
        const [{ pages }] = await sql.unsafe(
          `SELECT c.relpages::int AS pages FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='quarantine' AND c.relname='evidence_flight_dump_20260103_sealed'`);
        if (page + SEALED_PAGES < Math.max(pages, 1) || raw.length > 0) nextCursor = String(page + SEALED_PAGES);
        if (page + SEALED_PAGES >= pages && raw.length === 0) nextCursor = null;
        (ctx as any)._pages = pages;
      } else {
        const until = cursor ?? new Date().toISOString();
        const since = new Date(Date.now() - days * 86400000).toISOString();
        data = await sql`
          SELECT icao_code, registration, callsign, detection_timestamp AS ts, altitude, speed, on_ground, taxonomy_tag
          FROM live_flight_detections_rows
          WHERE detection_timestamp > ${since} AND detection_timestamp < ${until}
          ORDER BY detection_timestamp DESC LIMIT ${BATCH}`;
        if (data.length === BATCH) nextCursor = new Date(data[data.length - 1].ts).toISOString();
      }
      scanned = data.length;
      const regs = [...new Set(data.map(r => String(r.registration ?? "").toUpperCase()).filter(Boolean))];
      if (regs.length) {
        try {
          const faa: any[] = await sql`SELECT n_number FROM v_faa_identity WHERE n_number = ANY(${regs})`;
          for (const f of faa) ctx.faaMatched.add(String(f.n_number).toUpperCase());
        } catch { /* FAA view unavailable — no FAA-based proven labels this batch */ }
      }
      const srcTable = isSealed ? SEALED : "live_flight_detections_rows";
      const tsCount = new Map<string, number>();
      for (const r of data) { const k = new Date(r.ts).toISOString(); tsCount.set(k, (tsCount.get(k) ?? 0) + 1); }
      for (const r of data) {
        const iso = new Date(r.ts).toISOString();
        const d = classifyFlight({
          icao: r.icao_code, registration: r.registration, callsign: r.callsign, ts: iso,
          altitude: r.altitude == null ? null : Number(r.altitude), speed: r.speed == null ? null : Number(r.speed),
          on_ground: r.on_ground, taxonomy_tag: r.taxonomy_tag, sameTimestampCount: tsCount.get(iso) ?? 1,
        }, ctx);
        rows.push({ source_db: "neon", source_table: srcTable,
          source_id: `${r.icao_code ?? r.registration ?? "?"}|${iso}`, subject: r.registration || r.icao_code, observed_at: iso, ...d });
      }
    } finally { await sql.end({ timeout: 2 }).catch(() => {}); }
  }

  // Dedupe on source_id (same aircraft+time can appear twice)
  const uniq = new Map<string, Record<string, unknown>>();
  for (const r of rows) uniq.set(`${r.source_table}|${r.source_id}`, r);
  const final = await Promise.all([...uniq.values()].map(async r => ({
    ...r, rule_version: RULE_VERSION,
    sha256: await sha(`${RULE_VERSION}|${r.source_table}|${r.source_id}|${r.label}|${r.reason_code}`),
  })));
  for (let i = 0; i < final.length; i += 500) {
    const { error } = await admin.from("training_labels")
      .upsert(final.slice(i, i + 500), { onConflict: "source_table,source_id,rule_version", ignoreDuplicates: true });
    if (error) return json({ error: error.message }, 500);
  }

  const counts: Record<string, number> = { proven: 0, normal: 0, exclude: 0, unsorted: 0 };
  for (const r of final) counts[r.label as string]++;
  const resultHash = await sha(JSON.stringify({ scope, days, cursor, counts, ids: final.map(r => r.sha256) }));
  await admin.from("training_label_sweeps").insert({ scope, window_days: days, rule_version: RULE_VERSION, counts, scanned, result_sha256: resultHash, run_by: u.user.id });

  return json({ scope, scanned, labeled: final.length, counts, next_cursor: nextCursor, result_sha256: resultHash, bulk_threshold: BULK_TIMESTAMP_THRESHOLD });
});
