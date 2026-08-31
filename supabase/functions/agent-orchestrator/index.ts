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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentType, message, context: inputContext, provider } = await req.json();
    
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    
    if (!AGENT_CONFIGS[agentType as keyof typeof AGENT_CONFIGS]) {
      return new Response(
        JSON.stringify({ error: `Unknown agent type: ${agentType}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const config = AGENT_CONFIGS[agentType as keyof typeof AGENT_CONFIGS];
    
    // Get database context + document intelligence
    let dbContext: Record<string, unknown> = {};
    let relevantDocuments = "";
    
    if (NEON_DATABASE_URL) {
      const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1 });
      try {
        dbContext = await getDbContext(sql);
        relevantDocuments = await getDocumentsForAgent(sql, config.docTags);
      } finally {
        await sql.end();
      }
    }
    
    // Also fetch from Supabase evidence_documents if selected docs provided
    if (inputContext?.selectedDocuments?.length) {
      // Append selected doc IDs to context for the prompt
      relevantDocuments += `\n\n[USER SELECTED DOCUMENTS: ${inputContext.selectedDocuments.join(", ")}]`;
    }
    
    // Build agent context
    const agentContext: AgentContext = {
      violations: inputContext?.violations || [],
      shellCompanies: inputContext?.shellCompanies || [],
      financialTrails: inputContext?.financialTrails || [],
      draftedDocuments: inputContext?.draftedDocuments || [],
      conversationHistory: inputContext?.conversationHistory || [],
      selectedDocuments: inputContext?.selectedDocuments || []
    };
    
    const systemPrompt = await buildAgentSystemPrompt(agentType, dbContext, agentContext, relevantDocuments);
    const contextString = JSON.stringify({ dbContext, agentContext }, null, 2);
    
    const response = await callAI(systemPrompt, message, contextString, provider);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Lovable AI error:`, response.status, errorText);
      
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
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
    
  } catch (err) {
    console.error("Agent orchestrator error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
