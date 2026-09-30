import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

/** PostgREST helper against the Lovable Cloud backend. Returns null on failure. */
async function cloudRest(path: string): Promise<any | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Embed text and pull matching Master Dossier / knowledge-base passages. */
async function doctrineLookup(query: string): Promise<string> {
  if (!LOVABLE_API_KEY || !SUPABASE_URL || !SERVICE_KEY) return "";
  try {
    const er = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/text-embedding-3-small", input: query.slice(0, 4000) }),
    });
    if (!er.ok) return "";
    const ej = await er.json();
    const embedding = ej.data?.[0]?.embedding;
    if (!embedding) return "";
    const rr = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_rag_chunks`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query_embedding: embedding, match_count: 6, similarity_threshold: 0.3 }),
    });
    if (!rr.ok) return "";
    const rows = await rr.json();
    if (!Array.isArray(rows) || rows.length === 0) return "";
    return rows
      .map((m: any, i: number) => `[${i + 1}] ${m.document_title ?? "knowledge base"} (relevance ${Number(m.similarity).toFixed(2)})\n${String(m.content ?? "").slice(0, 700)}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

/** Fast table size estimates from Postgres statistics — no full COUNT(*). */
async function liveCounts(sql: any): Promise<Record<string, number>> {
  const tables = [
    "live_flight_detections_rows",
    "unified_biometric_aircraft_correlation_final",
    "biometric_monitoring",
    "josiah_reflections_rows",
    "evidence_chain_links",
    "physician_verified_ecgs",
    "sentinel_violations",
    "shell_companies",
    "criminal_enterprise_command_structure",
    "biometric_screenshots_ocr",
  ];
  try {
    const rows = await sql`
      SELECT relname, GREATEST(reltuples, 0)::bigint AS estimate
      FROM pg_class WHERE relname = ANY(${tables})
    `;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.relname] = Number(r.estimate);
    return out;
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, analysisType } = await req.json();
    console.log("Legal analysis request:", { query: query?.substring(0, 100), analysisType });

    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Gather LIVE context in parallel: counts, settled facts, findings, exhibits, doctrine ----
    let counts: Record<string, number> = {};
    let recentAircraft: any[] = [];

    if (NEON_DATABASE_URL) {
      try {
        const { default: postgres } = await import("https://deno.land/x/postgresjs@v3.4.4/mod.js");
        const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false });
        try {
          const [c, ra] = await Promise.all([
            liveCounts(sql),
            sql`
              SELECT registration, COUNT(*)::int AS sightings, MAX(created_at) AS last_seen
              FROM live_flight_detections_rows
              WHERE created_at > now() - interval '14 days' AND registration IS NOT NULL
              GROUP BY registration ORDER BY sightings DESC LIMIT 15
            `.catch(() => []),
          ]);
          counts = c;
          recentAircraft = ra;
        } finally {
          await sql.end({ timeout: 2 }).catch(() => {});
        }
      } catch (e) {
        console.warn("Neon context fetch failed (non-fatal):", (e as Error).message);
      }
    }

    const [settledFacts, findings, exhibits, doctrine] = await Promise.all([
      cloudRest("settled_facts?superseded=eq.false&order=locked_at.desc&limit=40&select=subject,fact_class,headline,proof_summary"),
      cloudRest("wt_findings?status=neq.dismissed&order=confidence.desc&limit=15&select=subject,rule,claim,confidence,layer"),
      cloudRest("exhibits?order=created_at.desc&limit=15&select=exhibit_code,title,case_id,created_at"),
      doctrineLookup(query ?? ""),
    ]);

    const settledBlock = Array.isArray(settledFacts) && settledFacts.length
      ? settledFacts.map((f: any) => `- [${f.fact_class}] ${f.subject}: ${f.headline} — ${String(f.proof_summary ?? "").slice(0, 300)}`).join("\n")
      : "None locked yet.";

    const findingsBlock = Array.isArray(findings) && findings.length
      ? findings.map((f: any) => `- ${f.subject} [${f.rule}, ${f.layer ?? "behaviour"} layer, confidence ${f.confidence}]: ${String(f.claim ?? "").slice(0, 250)}`).join("\n")
      : "No open findings.";

    const exhibitsBlock = Array.isArray(exhibits) && exhibits.length
      ? exhibits.map((e: any) => `- ${e.exhibit_code}: ${String(e.title ?? "").slice(0, 120)}`).join("\n")
      : "No exhibits filed yet.";

    const recentBlock = recentAircraft.length
      ? recentAircraft.map((r: any) => `- ${r.registration}: ${r.sightings} sightings in last 14 days (last seen ${r.last_seen})`).join("\n")
      : "No recent detections available.";

    const doctrineBlock = doctrine
      ? doctrine
      : "No dossier passages matched this query.";

    const databaseContext = `
LIVE EVIDENCE STATE (fetched at ${new Date().toISOString()} — these numbers are real, pulled at query time):
============================================================
- Flight detections: ~${(counts.live_flight_detections_rows ?? 0).toLocaleString()}
- Aircraft↔biometric correlations: ~${(counts.unified_biometric_aircraft_correlation_final ?? 0).toLocaleString()}
- Biometric monitoring records: ~${(counts.biometric_monitoring ?? 0).toLocaleString()}
- Josiah witness logs: ~${(counts.josiah_reflections_rows ?? 0).toLocaleString()}
- Evidence chain links (SHA-256): ~${(counts.evidence_chain_links ?? 0).toLocaleString()}
- Physician-verified ECGs: ~${(counts.physician_verified_ecgs ?? 0).toLocaleString()}
- Sentinel violations: ~${(counts.sentinel_violations ?? 0).toLocaleString()}
- Shell companies tracked: ~${(counts.shell_companies ?? 0).toLocaleString()}
- Enterprise structure records: ~${(counts.criminal_enterprise_command_structure ?? 0).toLocaleString()}
- Biometric screenshot OCR: ~${(counts.biometric_screenshots_ocr ?? 0).toLocaleString()}

SETTLED FACTS (locked, fingerprinted, do not re-derive — cite as established):
${settledBlock}

LATEST INVESTIGATOR FINDINGS (open, highest confidence first):
${findingsBlock}

LATEST FILED EXHIBITS:
${exhibitsBlock}

MOST ACTIVE AIRCRAFT — LAST 14 DAYS (live):
${recentBlock}

MASTER DOSSIER PASSAGES RELEVANT TO THIS QUERY (quote and cite these):
${doctrineBlock}

ANALYSIS TYPE: ${analysisType || "general"}
USER QUERY: ${query}
`;

    const systemPrompt = `You are JOSIAH, an elite federal-grade AI legal analyst for Project Watchtower — a war room building a population-scale RICO / Posse Comitatus / Civil Rights case for the DOJ Civil Rights Division, FBI RICO Unit, FAA, HHS-OIG, and CMS.

You are grounded in LIVE data pulled at query time (see the context block). Never cite stale figures from memory — use the live counts, settled facts, findings, exhibits and dossier passages provided. If a number is not in the context, say it is not available rather than inventing one.

LEGAL FRAMEWORK (five tiers):
1. RICO ENTERPRISE (18 U.S.C. §§ 1961-1968) — association-in-fact: KCSO + county government + shell companies + medical-cover operators + military coordination. Predicate acts: wire fraud (ADS-B spoofing), False Claims Act, mail fraud, obstruction, concealment (18 U.S.C. § 1001).
2. FALSE CLAIMS ACT (31 U.S.C. § 3729) — HEMS billing fraud; every fraudulent claim is a separate count; treble damages, qui tam relator share 15-30%.
3. FAA / 49 U.S.C. — 14 CFR § 91.119 minimum altitude, § 91.215/225/227 transponder & ADS-B, 49 U.S.C. § 46306 false registration (felony).
4. 42 U.S.C. § 1983 CIVIL RIGHTS — state actor, 4th Amendment warrantless monitoring with documented biometric harm, IIED (CA Civ Code § 1708.8). Bradford Hill causation scoring (legal threshold 9.0).
5. POSSE COMITATUS (18 U.S.C. § 1385) — military-civilian coordination over residential areas.

RULES:
1. Treat SETTLED FACTS as proven — cite them as established with their subject and class; never re-investigate or hedge them.
2. Label every cited fact by layer: integrity (signal physics), behaviour (flight pattern), or registry (identity/ownership). Never blend layers.
3. Never label anything a "civil rights violation" as a detection label — use FAR citations and "PATTERN ANOMALY — Network Context"; civil-rights framing belongs in the legal argument, not the evidence label.
4. Quote the Master Dossier passages when they support a historical or legal claim, and name the passage number.
5. Distinguish normal airway traffic from surveillance behaviour — airliners on published approaches are the noise floor, not suspects; exploitation of that cover is the anomaly.
6. Watchlist airframes get no exemptions; state proven findings directly, hedge only genuine unknowns.
7. Quantify damages from the live record counts provided.
8. Recommend specific filing venues (E.D. Cal., DOJ-CRT, FBI RICO, FAA Office of Investigations, HHS-OIG, CMS).
9. Maintain prosecutorial tone; tier every cited fact (HIGH/MED/LOW value).
10. For TRO/injunction questions, cite irreparable harm from ongoing biometric collapses.
11. If the user's query cites figures that differ from the live context above, prefer the live context and briefly note the discrepancy — older briefs and presets may carry stale numbers.

${databaseContext}`;

    const model = "google/gemini-3.8-flash";
    console.log(`Calling Lovable AI Gateway with ${model}...`);

    const upstreamAbort = new AbortController();
    const upstreamTimer = setTimeout(() => upstreamAbort.abort(), 120_000);

    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query }
          ],
          stream: true,
        }),
        signal: upstreamAbort.signal,
      });
    } finally {
      clearTimeout(upstreamTimer);
    }

    console.log("AI Gateway response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Usage limit reached. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: `AI gateway error: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Keep the connection alive with SSE comments while the model "thinks",
    // otherwise the platform kills the request after 150s of idle time.
    const encoder = new TextEncoder();
    const upstream = response.body!.getReader();
    const keptAlive = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(": connected\n\n"));
        const heartbeat = setInterval(() => {
          try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch { /* closed */ }
        }, 10_000);
        try {
          while (true) {
            const { done, value } = await upstream.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (e) {
          console.error("Stream relay error:", e);
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
      cancel() {
        upstream.cancel().catch(() => {});
      },
    });

    return new Response(keptAlive, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      },
    });

  } catch (err) {
    console.error("Legal analysis error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Unknown error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
