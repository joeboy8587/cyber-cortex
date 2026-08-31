import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { AGENT_CONFIGS, type AgentContext } from "./agent-configs.ts";
import { getDbContext, getDocumentsForAgent } from "./db-context.ts";
import { buildAgentSystemPrompt } from "./prompts.ts";
import { nimChat } from "../_shared/nim.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function callAI(
  systemPrompt: string,
  userPrompt: string,
  context: string,
  provider: string,
) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `${userPrompt}\n\nCONTEXT:\n${context}` },
  ];

  // Adversarial debate runs on NVIDIA NIM; every other agent stays on Lovable AI.
  if (provider === "nvidia") {
    return await nimChat({
      messages,
      stream: true,
      max_tokens: 6000,
      fallbackModel: "google/gemini-3-flash-preview",
    });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages,
      stream: true,
      max_tokens: 6000,
    }),
  });
}

/** Resolve a promise with a fallback if it takes too long. */
async function cap<T>(p: Promise<T>, fallback: T, ms: number): Promise<T> {
  let t: number | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((res) => { t = setTimeout(() => res(fallback), ms); }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { agentType, message, context: inputContext, provider } = body ?? {};

  if (!AGENT_CONFIGS[agentType as keyof typeof AGENT_CONFIGS]) {
    return new Response(
      JSON.stringify({ error: `Unknown agent type: ${agentType}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const config = AGENT_CONFIGS[agentType as keyof typeof AGENT_CONFIGS];
  const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
  const encoder = new TextEncoder();

  // Stream immediately: heartbeats keep the connection alive while we gather
  // DB context and wait for the model's first token (avoids 150s IDLE_TIMEOUT).
  const stream = new ReadableStream({
    async start(controller) {
      let alive = true;
      const send = (s: string) => { if (alive) controller.enqueue(encoder.encode(s)); };
      send(": connected\n\n");
      const beat = setInterval(() => send(": keep-alive\n\n"), 10_000);

      const fail = (msg: string) => {
        send(`data: ${JSON.stringify({ error: msg })}\n\n`);
        send("data: [DONE]\n\n");
      };

      try {
        let dbContext: Record<string, unknown> = {};
        let relevantDocuments = "";

        if (NEON_DATABASE_URL) {
          const sql = postgres(NEON_DATABASE_URL, {
            ssl: "require", max: 1, idle_timeout: 10, connect_timeout: 10,
          });
          try {
            dbContext = await cap(getDbContext(sql), {} as Record<string, unknown>, 25_000);
            relevantDocuments = await cap(getDocumentsForAgent(sql, config.docTags), "", 10_000);
          } catch (e) {
            console.warn("db context failed (non-fatal):", (e as Error).message);
          } finally {
            await sql.end().catch(() => {});
          }
        }

        if (inputContext?.selectedDocuments?.length) {
          relevantDocuments += `\n\n[USER SELECTED DOCUMENTS: ${inputContext.selectedDocuments.join(", ")}]`;
        }

        const agentContext: AgentContext = {
          violations: inputContext?.violations || [],
          shellCompanies: inputContext?.shellCompanies || [],
          financialTrails: inputContext?.financialTrails || [],
          draftedDocuments: inputContext?.draftedDocuments || [],
          conversationHistory: inputContext?.conversationHistory || [],
          selectedDocuments: inputContext?.selectedDocuments || [],
        };

        const systemPrompt = await cap(
          buildAgentSystemPrompt(agentType, dbContext, agentContext, relevantDocuments),
          `You are the ${config.name} agent. ${config.role}`,
          20_000,
        );
        // Keep the payload small — huge contexts are the main cause of slow first tokens.
        const contextString = JSON.stringify({ dbContext, agentContext }).slice(0, 60_000);

        const response = await callAI(systemPrompt, message, contextString, provider);

        if (!response.ok || !response.body) {
          const errorText = await response.text().catch(() => "");
          console.error("AI error:", response.status, errorText);
          fail(
            response.status === 429
              ? "Rate limit exceeded. Please try again in a moment."
              : response.status === 402
                ? "Usage limit reached. Please add credits to your workspace."
                : `AI gateway error: ${response.status}`,
          );
          return;
        }

        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          clearInterval(beat); // real data flowing; heartbeats no longer needed
          if (alive) controller.enqueue(value);
        }
      } catch (err) {
        console.error("Agent orchestrator error:", err);
        fail((err as Error).message);
      } finally {
        clearInterval(beat);
        alive = false;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

