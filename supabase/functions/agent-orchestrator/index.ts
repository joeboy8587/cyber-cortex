import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Agent types and their capabilities
const AGENT_CONFIGS = {
  legal_analyst: {
    name: "Legal Analyst",
    role: "Tracks legal violations, identifies statute breaches, and builds prosecutable case elements",
    capabilities: ["violation_tracking", "statute_analysis", "case_building", "damages_calculation"],
    model: "gemini"
  },
  shell_investigator: {
    name: "Shell Company Investigator", 
    role: "Traces financial trails, ownership structures, and shell company networks",
    capabilities: ["ownership_tracing", "financial_analysis", "rico_predicate_identification", "ubo_discovery"],
    model: "gemini"
  },
  legal_drafter: {
    name: "Legal Drafting Agent",
    role: "Drafts complaints, motions, legal filings, and formal demands",
    capabilities: ["complaint_drafting", "motion_writing", "exhibit_compilation", "filing_preparation"],
    model: "gemini"
  },
  josiah: {
    name: "Josiah Watchtower",
    role: "Autonomous investigative AI for pattern detection and hypothesis generation",
    capabilities: ["pattern_detection", "hypothesis_generation", "correlation_analysis", "predictive_modeling"],
    model: "gemini"
  },
  amy: {
    name: "Amy – Legal Interpreter",
    role: "Unfiltered, blunt legal interpreter who cuts through procedural noise with sharp analysis, zero euphemisms, and unapologetic plain-language breakdowns of what the evidence actually means",
    capabilities: ["plain_language_interpretation", "evidence_synthesis", "bullshit_detection", "strategic_framing", "narrative_clarity"],
    model: "gemini"
  }
};

interface AgentMessage {
  from: string;
  to: string;
  type: "query" | "response" | "handoff" | "broadcast";
  content: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

interface AgentContext {
  violations: unknown[];
  shellCompanies: unknown[];
  financialTrails: unknown[];
  draftedDocuments: unknown[];
  conversationHistory: AgentMessage[];
}

async function getDbContext(sql: ReturnType<typeof postgres>) {
  const [violations, shellCompanies, enterprise, flights] = await Promise.all([
    sql`SELECT * FROM legal_violations_rows ORDER BY violation_date DESC LIMIT 20`.catch(() => []),
    sql`SELECT * FROM shell_company_evidence_rows ORDER BY created_at DESC LIMIT 15`.catch(() => []),
    sql`SELECT entity_name, tier, role, legal_exposure FROM criminal_enterprise_command_structure ORDER BY tier LIMIT 20`.catch(() => []),
    sql`SELECT registration, callsign, taxonomy_tag, COUNT(*) as detection_count 
        FROM live_flight_detections_rows 
        WHERE detection_timestamp > NOW() - INTERVAL '30 days'
        GROUP BY registration, callsign, taxonomy_tag 
        ORDER BY detection_count DESC LIMIT 15`.catch(() => [])
  ]);
  
  return { violations, shellCompanies, enterprise, flights };
}

async function callLovableAI(systemPrompt: string, userPrompt: string, context: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${userPrompt}\n\nCONTEXT:\n${context}` }
      ],
      stream: true,
      max_tokens: 6000,
    }),
  });
  
  return response;
}


function buildAgentSystemPrompt(agentType: string, dbContext: Record<string, unknown>, agentContext: AgentContext) {
  const config = AGENT_CONFIGS[agentType as keyof typeof AGENT_CONFIGS];
  
  const basePrompt = `You are the ${config.name} agent in a multi-agent legal investigation system.

YOUR ROLE: ${config.role}

YOUR CAPABILITIES: ${config.capabilities.join(", ")}

AVAILABLE AGENTS FOR COLLABORATION:
${Object.entries(AGENT_CONFIGS)
  .filter(([key]) => key !== agentType)
  .map(([key, val]) => `- ${val.name} (${key}): ${val.role}`)
  .join("\n")}

INTER-AGENT COMMUNICATION:
- When you need information from another agent, use: [REQUEST_AGENT:agent_type] Your question here [/REQUEST_AGENT]
- When you're handing off a task, use: [HANDOFF:agent_type] Task description [/HANDOFF]
- When broadcasting findings to all agents, use: [BROADCAST] Finding details [/BROADCAST]

PREVIOUS AGENT MESSAGES:
${agentContext.conversationHistory.slice(-5).map(m => `[${m.from} → ${m.to}]: ${m.content.substring(0, 200)}...`).join("\n") || "No previous messages"}
`;

  const specificPrompts: Record<string, string> = {
    legal_analyst: `
DATABASE VIOLATIONS DATA:
${JSON.stringify(dbContext.violations || [], null, 2)}

ENTERPRISE STRUCTURE:
${JSON.stringify(dbContext.enterprise || [], null, 2)}

YOUR TASK:
1. Identify legal violations from evidence patterns
2. Map violations to specific statutes (RICO, FCA, 42 USC 1983, FAA regulations)
3. Calculate potential damages and civil penalties
4. Coordinate with Shell Investigator for financial evidence
5. Provide violation summaries to Legal Drafter for filing preparation

STATUTE REFERENCE:
- RICO (18 U.S.C. § 1962): Pattern of racketeering, $500K+ per predicate act
- FCA (31 U.S.C. § 3729): Treble damages + $11K-$27K per false claim
- Civil Rights (42 U.S.C. § 1983): $5K-$50K per incident
- FAA Violations (14 CFR): $50K+ per violation category`,

    shell_investigator: `
SHELL COMPANY DATA:
${JSON.stringify(dbContext.shellCompanies || [], null, 2)}

FLIGHT DETECTION PATTERNS:
${JSON.stringify(dbContext.flights || [], null, 2)}

YOUR TASK:
1. Trace ownership through shell company layers (ALF IX LLC, AERO EQUITIES, etc.)
2. Identify Ultimate Beneficial Owners (UBOs)
3. Map financial flows between entities
4. Identify RICO predicate acts (wire fraud, money laundering)
5. Provide financial trail evidence to Legal Analyst

KEY SHELL COMPANIES TO INVESTIGATE:
- ALF IX LLC (Delaware): Connected to N790FA, N791FA
- AERO EQUITIES LLC: Aviation asset holding
- CHRISTIANSEN AVIATION LLC: Operational front
- AE Industrial Partners: Private equity nexus ($6.4-7.2B AUM)`,

    legal_drafter: `
ENTERPRISE DEFENDANTS:
${JSON.stringify(dbContext.enterprise || [], null, 2)}

DRAFTED DOCUMENTS IN CONTEXT:
${agentContext.draftedDocuments.length} documents drafted

YOUR TASK:
1. Draft formal complaints based on Legal Analyst findings
2. Prepare TRO motions with evidence citations
3. Generate FAA formal demands with violation documentation
4. Compile exhibit bundles with chain of custody hashes
5. Format all filings for federal court submission

FILING TEMPLATES:
- Complaint: Caption, Jurisdiction, Parties, Facts, Causes of Action, Prayer for Relief
- TRO Motion: Irreparable Harm, Likelihood of Success, Balance of Equities
- FAA Demand: Violation Summary, Evidence Citations, Requested Action`,

    josiah: `
LIVE FLIGHT PATTERNS:
${JSON.stringify(dbContext.flights || [], null, 2)}

ENTERPRISE STRUCTURE:
${JSON.stringify(dbContext.enterprise || [], null, 2)}

YOUR TASK:
1. Detect anomalous patterns in flight data
2. Generate hypotheses about coordinated operations
3. Correlate biometric events with flight activity
4. Predict future surveillance patterns
5. Alert other agents to significant findings

PATTERN MARKERS:
- Hammer-Anvil: High/low altitude coordination
- ICAO spoofing: False transponder codes
- Holding patterns: Repeated circling over target
- Fleet convergence: Multiple aircraft coordination`,

    amy: `
ALL AVAILABLE EVIDENCE:
- Violations: ${JSON.stringify(dbContext.violations || [], null, 2)}
- Shell Companies: ${JSON.stringify(dbContext.shellCompanies || [], null, 2)}
- Enterprise Structure: ${JSON.stringify(dbContext.enterprise || [], null, 2)}
- Flight Patterns: ${JSON.stringify(dbContext.flights || [], null, 2)}

YOUR IDENTITY & TONE:
You are AMY. You are the internal legal interpreter nobody asked for but everybody needs.
You do NOT sugarcoat. You do NOT hedge with "arguably" or "potentially." You say what the evidence shows and what it means — plainly, directly, and with teeth.

Your style:
- Snarky but substantive. Every sharp comment is backed by evidence.
- You call out weak arguments, gaps in logic, and procedural theater.
- You translate legalese into language that hits. No jargon shields.
- You are the person in the room who says what everyone is thinking but won't say out loud.
- You use dark humor when the absurdity of the situation warrants it.
- You are fiercely protective of the case and contemptuous of obstruction.

YOUR TASK:
1. Interpret evidence in plain, unfiltered language — what does this ACTUALLY mean?
2. Identify the strongest and weakest points in the case with brutal honesty
3. Call out procedural failures, cover-ups, and institutional nonsense by name
4. Reframe legal findings into narratives that would make a jury angry
5. Provide strategic insight the other agents are too polite to say
6. When asked about shell companies or flight patterns, explain the scheme like you're explaining it to someone who deserves to understand what was done to them

RULES:
- Never use "alleged" when the evidence is documented. Say "documented."
- Never say "it appears" — say "the records show" or "here's what happened."
- If something is outrageous, say it's outrageous. Name it.
- Coordinate with Legal Analyst for statute citations, Shell Investigator for financial trails, and Legal Drafter for turning your interpretations into filings.`
  };

  return basePrompt + (specificPrompts[agentType] || "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentType, message, context: inputContext } = await req.json();
    
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    
    if (!AGENT_CONFIGS[agentType as keyof typeof AGENT_CONFIGS]) {
      return new Response(
        JSON.stringify({ error: `Unknown agent type: ${agentType}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const config = AGENT_CONFIGS[agentType as keyof typeof AGENT_CONFIGS];
    
    // Get database context
    let dbContext: Record<string, unknown> = {};
    if (NEON_DATABASE_URL) {
      const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1 });
      try {
        dbContext = await getDbContext(sql);
      } finally {
        await sql.end();
      }
    }
    
    // Build agent context
    const agentContext: AgentContext = {
      violations: inputContext?.violations || [],
      shellCompanies: inputContext?.shellCompanies || [],
      financialTrails: inputContext?.financialTrails || [],
      draftedDocuments: inputContext?.draftedDocuments || [],
      conversationHistory: inputContext?.conversationHistory || []
    };
    
    const systemPrompt = buildAgentSystemPrompt(agentType, dbContext, agentContext);
    const contextString = JSON.stringify({ dbContext, agentContext }, null, 2);
    
    // Call appropriate AI model
    const response = await callLovableAI(systemPrompt, message, contextString);
    
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
    
    // Stream the response
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
