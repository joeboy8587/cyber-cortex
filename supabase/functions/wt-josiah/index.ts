// Josiah — conversational investigator bound to a single finding.
// Natural-language chat with real tools over the Watchtower data, plus the
// ability to record what the user contributes as evidence on the finding.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const AOI = { lat: 35.4377286, lng: -119.0252189 };
const PAD = 0.18;

function neon() {
  const url = Deno.env.get("NEON_DATABASE_URL");
  if (!url) throw new Error("NEON_DATABASE_URL not configured");
  return postgres(url, {
    ssl: { rejectUnauthorized: false },
    max: 2, idle_timeout: 15, connect_timeout: 15,
    prepare: false, fetch_types: false, onnotice: () => {},
    connection: { application_name: "wt-josiah", statement_timeout: 20000 },
  });
}

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try { return await p; } catch (e) { console.warn("tool step skipped:", (e as Error).message); return fallback; }
};

async function migrate(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS wt_finding_chat (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL DEFAULT '',
    tool_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS wt_finding_chat_fid ON wt_finding_chat (finding_id, created_at)`;
}

// ------------------------------------------------------------------- tools
async function coPresence(sql: any, subject: string, days = 7) {
  const mine = await safe(sql`
    SELECT DISTINCT FLOOR(EXTRACT(EPOCH FROM detection_timestamp) / 900)::bigint AS bucket
    FROM live_flight_detections_rows
    WHERE UPPER(registration) = ${subject}
      AND detection_timestamp > NOW() - (${days} || ' days')::interval
      AND latitude BETWEEN ${AOI.lat - PAD} AND ${AOI.lat + PAD}
      AND longitude BETWEEN ${AOI.lng - PAD} AND ${AOI.lng + PAD}
    ORDER BY 1 DESC LIMIT 300
  `, [] as any[]);
  if (!mine.length) return { partners: [], note: "no contacts for this aircraft in the window" };

  const buckets = mine.map((r: any) => Number(r.bucket));
  const lo = new Date(Math.min(...buckets) * 900_000).toISOString();
  const hi = new Date((Math.max(...buckets) + 1) * 900_000).toISOString();

  const partners = await safe(sql`
    SELECT UPPER(d.registration) AS registration, COUNT(DISTINCT FLOOR(EXTRACT(EPOCH FROM d.detection_timestamp)/900))::int AS shared_windows,
           MIN(d.altitude::numeric) AS min_altitude_ft
    FROM live_flight_detections_rows d
    WHERE d.detection_timestamp BETWEEN ${lo}::timestamptz AND ${hi}::timestamptz
      AND d.registration IS NOT NULL AND d.registration <> '' AND UPPER(d.registration) <> ${subject}
      AND d.latitude BETWEEN ${AOI.lat - PAD} AND ${AOI.lat + PAD}
      AND d.longitude BETWEEN ${AOI.lng - PAD} AND ${AOI.lng + PAD}
      AND FLOOR(EXTRACT(EPOCH FROM d.detection_timestamp)/900)::bigint = ANY(
            string_to_array(${buckets.join("|")}, '|')::bigint[])
    GROUP BY 1
    HAVING COUNT(DISTINCT FLOOR(EXTRACT(EPOCH FROM d.detection_timestamp)/900)) >= 2
    ORDER BY shared_windows DESC LIMIT 15
  `, [] as any[]);
  return { window_days: days, subject_windows: buckets.length, partners };
}

const TOOLS = {
  subject_history: {
    def: {
      type: "function",
      function: {
        name: "subject_history",
        description: "Month-by-month contact counts over the area of interest for an aircraft registration, for the last year.",
        parameters: { type: "object", properties: { registration: { type: "string" } }, required: ["registration"] },
      },
    },
    run: (sql: any, a: any) => safe(sql`
      SELECT to_char(date_trunc('month', detection_timestamp), 'YYYY-MM') AS month, COUNT(*)::int AS contacts,
             MIN(altitude::numeric) AS min_altitude_ft
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = ${String(a.registration).toUpperCase()}
        AND detection_timestamp > NOW() - INTERVAL '365 days'
        AND latitude BETWEEN ${AOI.lat - PAD} AND ${AOI.lat + PAD}
        AND longitude BETWEEN ${AOI.lng - PAD} AND ${AOI.lng + PAD}
      GROUP BY 1 ORDER BY 1`, [] as any[]),
  },
  co_presence: {
    def: {
      type: "function",
      function: {
        name: "co_presence",
        description: "Which other aircraft were over the area in the same 15-minute windows as this one.",
        parameters: {
          type: "object",
          properties: { registration: { type: "string" }, days: { type: "number", description: "lookback days, default 7" } },
          required: ["registration"],
        },
      },
    },
    run: (sql: any, a: any) => coPresence(sql, String(a.registration).toUpperCase(), Math.min(30, Number(a.days) || 7)),
  },
  registry_identity: {
    def: {
      type: "function",
      function: {
        name: "registry_identity",
        description: "Authoritative FAA registry identity for a registration: operator, type, city/state, hex code.",
        parameters: { type: "object", properties: { registration: { type: "string" } }, required: ["registration"] },
      },
    },
    run: async (sql: any, a: any) => {
      const reg = String(a.registration).toUpperCase();
      const d = await safe(sql`
        SELECT registration, icao24, operator, operator_type, operator_city, operator_state, aircraft_type, faa_matched
        FROM aircraft_dossier WHERE UPPER(registration) = ${reg} LIMIT 1`, [] as any[]);
      if (d.length) return d[0];
      const m = await safe(sql`
        SELECT n_number, name AS operator, type_aircraft AS aircraft_type, city AS operator_city, state AS operator_state
        FROM faa_master WHERE UPPER(TRIM(n_number)) = ${reg.replace(/^N/, "")} LIMIT 1`, [] as any[]);
      return m[0] ?? { registration: reg, note: "no registry record found" };
    },
  },
  similar_tails: {
    def: {
      type: "function",
      function: {
        name: "similar_tails",
        description: "Aircraft with a similar registration prefix or the same operator — use when checking near-identical tail numbers.",
        parameters: { type: "object", properties: { registration: { type: "string" }, operator: { type: "string" } }, required: ["registration"] },
      },
    },
    run: async (sql: any, a: any) => {
      const reg = String(a.registration).toUpperCase();
      const prefix = reg.slice(0, Math.max(3, reg.length - 2));
      const byPrefix = await safe(sql`
        SELECT registration, operator, aircraft_type, operator_city, operator_state
        FROM aircraft_dossier WHERE UPPER(registration) LIKE ${prefix + "%"} LIMIT 20`, [] as any[]);
      const op = a.operator ? String(a.operator) : null;
      const byOperator = op ? await safe(sql`
        SELECT registration, operator, aircraft_type
        FROM aircraft_dossier WHERE operator ILIKE ${"%" + op.slice(0, 24) + "%"} LIMIT 25`, [] as any[]) : [];
      return { prefix, same_prefix: byPrefix, same_operator: byOperator };
    },
  },
  behaviour_neighbours: {
    def: {
      type: "function",
      function: {
        name: "behaviour_neighbours",
        description: "Airframes whose flight-profile embedding is closest to this one (pre-computed neighbours).",
        parameters: { type: "object", properties: { registration: { type: "string" } }, required: ["registration"] },
      },
    },
    run: async (sql: any, a: any) => {
      const r = await safe(sql`SELECT neighbors FROM aircraft_dossier_embeddings
        WHERE UPPER(registration) = ${String(a.registration).toUpperCase()} LIMIT 1`, [] as any[]);
      const list = (r[0]?.neighbors ?? []) as any[];
      return { neighbours: Array.isArray(list) ? list.slice(0, 12) : [] };
    },
  },
  shell_match: {
    def: {
      type: "function",
      function: {
        name: "shell_match",
        description: "Check an owner or company name against the known shell-entity list.",
        parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      },
    },
    run: (sql: any, a: any) => safe(sql`
      SELECT company_name FROM shell_companies
      WHERE company_name ILIKE ${"%" + String(a.name).slice(0, 20) + "%"} LIMIT 10`, [] as any[]),
  },
  biometric_correlation: {
    def: {
      type: "function",
      function: {
        name: "biometric_correlation",
        description: "Recorded correlations between this aircraft's passes and physiological (heart-rate) events.",
        parameters: { type: "object", properties: { registration: { type: "string" } }, required: ["registration"] },
      },
    },
    run: (sql: any, a: any) => safe(sql`
      SELECT aircraft_registration AS registration, threat_score, threat_level, correlation_strength
      FROM unified_biometric_aircraft_correlation_final
      WHERE UPPER(aircraft_registration) = ${String(a.registration).toUpperCase()}
      ORDER BY COALESCE(threat_score,0) DESC LIMIT 8`, [] as any[]),
  },
  recent_track: {
    def: {
      type: "function",
      function: {
        name: "recent_track",
        description: "Most recent individual contacts (time, altitude, speed, distance from the residence) for an aircraft.",
        parameters: {
          type: "object",
          properties: { registration: { type: "string" }, limit: { type: "number" } },
          required: ["registration"],
        },
      },
    },
    run: (sql: any, a: any) => safe(sql`
      SELECT detection_timestamp, altitude, speed, callsign,
             ROUND(ST_DistanceSphere(ST_MakePoint(longitude::float8, latitude::float8),
                   ST_MakePoint(${AOI.lng}, ${AOI.lat}))::numeric) AS distance_m
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = ${String(a.registration).toUpperCase()}
      ORDER BY detection_timestamp DESC LIMIT ${Math.min(60, Number(a.limit) || 25)}`, [] as any[]),
  },
  other_findings: {
    def: {
      type: "function",
      function: {
        name: "other_findings",
        description: "Everything the system has already recorded about this subject or a related one.",
        parameters: { type: "object", properties: { subject: { type: "string" } }, required: ["subject"] },
      },
    },
    run: (sql: any, a: any) => safe(sql`
      SELECT rule_code, claim, confidence, status, layer, occurrences, last_seen
      FROM wt_findings WHERE subject = ${String(a.subject).toUpperCase()}
      ORDER BY confidence DESC LIMIT 20`, [] as any[]),
  },
  record_evidence: {
    def: {
      type: "function",
      function: {
        name: "record_evidence",
        description: "Attach something the user contributed (research, a screenshot description, an observation) to this finding as evidence. Use it whenever the user supplies new information worth keeping.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "One or two sentences describing what was contributed." },
            source: { type: "string", description: "Where it came from, e.g. 'user research', 'radar screenshot'." },
            supports: { type: "boolean", description: "true if it supports the finding, false if it weakens it." },
          },
          required: ["summary", "source", "supports"],
        },
      },
    },
    run: async (sql: any, a: any, ctx: { findingId: string; subject: string }) => {
      await safe(sql`INSERT INTO wt_finding_evidence (finding_id, source_table, source_ref, detail)
        VALUES (${ctx.findingId}, 'user_contribution', ${ctx.subject},
                ${sql.json({ summary: a.summary, source: a.source, supports: !!a.supports })})`, null);
      await safe(sql`UPDATE wt_findings SET
          times_corroborated = times_corroborated + ${a.supports ? 1 : 0},
          times_contradicted = times_contradicted + ${a.supports ? 0 : 1},
          updated_at = now() WHERE id = ${ctx.findingId}`, null);
      return { recorded: true };
    },
  },
} as const;

type ToolKey = keyof typeof TOOLS;

// ------------------------------------------------------------------- chat
async function chat(sql: any, body: any) {
  const findingId = String(body.finding_id);
  const f = (await sql`SELECT * FROM wt_findings WHERE id = ${findingId}`)[0];
  if (!f) throw new Error("finding not found");

  const history = await safe(sql`
    SELECT role, content FROM wt_finding_chat WHERE finding_id = ${findingId}
    ORDER BY created_at ASC LIMIT 40`, [] as any[]);

  const investigations = await safe(sql`
    SELECT outcome, narrative, steps FROM wt_investigations
    WHERE finding_id = ${findingId} ORDER BY created_at DESC LIMIT 1`, [] as any[]);

  const userText = String(body.message ?? "").slice(0, 20000);
  const attachments: string[] = (Array.isArray(body.attachments) ? body.attachments : [])
    .filter((a: unknown) => typeof a === "string" && a.length < 3_000_000)
    .slice(0, 3);


  const system = [
    "You are Josiah, the Watchtower investigator, working side by side with a non-technical investigator.",
    "You are looking at ONE finding. Talk plainly, in short paragraphs. No jargon, no hedging.",
    "Use your tools freely and more than once when a question needs several checks — you can pull the thread yourself.",
    "State only what the evidence supports. If a check comes back empty, say so plainly.",
    "Keep three layers apart at all times: behaviour observations, integrity/physics anomalies, and registry-identity facts.",
    "The FAA registry is authoritative for identity; tracking-app labels and icons are crowd-sourced guesses.",
    "Never call anything a civil-rights violation — cite the pattern and the regulation instead.",
    "When the user contributes research, a screenshot, or an observation, call record_evidence to keep it on the record.",
    `Finding under discussion: ${f.claim}`,
    `Pattern: ${f.rule_code} · layer: ${f.layer} · confidence ${Math.round(Number(f.confidence) * 100)}% · status ${f.status}`,
    `Subject: ${f.subject}`,
    investigations[0]?.narrative ? `Earlier automated write-up: ${investigations[0].narrative}` : "",
  ].filter(Boolean).join("\n");

  const userContent: any = attachments.length
    ? [{ type: "text", text: userText || "Look at these." },
       ...attachments.map((url) => ({ type: "image_url", image_url: { url } }))]
    : userText;

  const messages: any[] = [
    { role: "system", content: system },
    ...history.map((h: any) => ({ role: h.role, content: h.content })),
    { role: "user", content: userContent },
  ];

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const trace: any[] = [];
  let answer = "";
  const deadline = Date.now() + 100_000;

  for (let turn = 0; turn < 4; turn++) {
    if (Date.now() > deadline) {
      answer = "I ran out of time on that one. Ask me a narrower question and I'll get you an answer.";
      break;
    }
    let res: Response;
    try {
      res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-6-astra",
          reasoning_effort: "none",

          messages,
          tools: Object.values(TOOLS).map((t) => t.def),
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      return { ok: false, error: `Josiah could not reach the model (${(e as Error).name}). Try again.` };
    }

    if (res.status === 429) return { ok: false, error: "Josiah is rate limited — try again in a moment." };
    if (res.status === 402 || res.status === 403) {
      return { ok: false, error: "AI credits are exhausted or blocked for this workspace. Add credits to continue." };
    }
    if (!res.ok) return { ok: false, error: `AI error ${res.status}: ${(await res.text()).slice(0, 300)}` };

    const d = await res.json().catch(() => null);
    const msg = d?.choices?.[0]?.message;
    if (!msg) return { ok: false, error: "Empty response from the model." };

    const calls = msg.tool_calls ?? [];
    if (!calls.length) { answer = msg.content ?? ""; break; }

    messages.push(msg);
    for (const c of calls.slice(0, 6)) {
      const name = c.function?.name as ToolKey;
      let args: any = {};
      try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* ignore */ }
      const tool = TOOLS[name];
      let result: unknown = { error: `unknown tool ${name}` };
      if (tool) {
        result = await safe(
          Promise.resolve((tool.run as any)(sql, args, { findingId, subject: f.subject })),
          { error: "this data isn't captured yet" },
        );
      }
      trace.push({ tool: name, args, result });
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result).slice(0, 12000) });
    }
  }

  if (!answer) answer = "I ran the checks but did not get a written answer back. Ask again and I'll try a narrower question.";


  await safe(sql`INSERT INTO wt_finding_chat (finding_id, role, content, attachments)
    VALUES (${findingId}, 'user', ${userText}, ${sql.json(attachments.map(() => "image"))})`, null);
  await safe(sql`INSERT INTO wt_finding_chat (finding_id, role, content, tool_trace)
    VALUES (${findingId}, 'assistant', ${answer}, ${sql.json(trace)})`, null);

  return { ok: true, answer, trace };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let sql: any;
  try {
    const body = await req.json().catch(() => ({}));
    const findingId = String(body.finding_id ?? "");
    if (!UUID.test(findingId)) {
      return json({ ok: false, error: "No finding was selected — pick a finding first." });
    }
    sql = neon();
    await migrate(sql);

    if (body.action === "history") {
      const rows = await safe(sql`SELECT id, role, content, tool_trace, created_at
        FROM wt_finding_chat WHERE finding_id = ${findingId}
        ORDER BY created_at ASC LIMIT 60`, [] as any[]);
      return json({ ok: true, messages: rows });
    }
    if (body.action === "clear") {
      await safe(sql`DELETE FROM wt_finding_chat WHERE finding_id = ${findingId}`, null);
      return json({ ok: true, cleared: true });
    }
    return json(await chat(sql, { ...body, finding_id: findingId }));
  } catch (e) {
    console.error("wt-josiah error:", e);
    return json({ ok: false, error: (e as Error).message });
  } finally {

    try { await sql?.end(); } catch { /* ignore */ }
  }
});
