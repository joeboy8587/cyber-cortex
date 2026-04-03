// Agent types and their capabilities
export const AGENT_CONFIGS = {
  legal_analyst: {
    name: "Legal Analyst",
    role: "Tracks legal violations across population-scale RICO enterprise (41,606 aircraft), identifies statute breaches under reclassified 42 U.S.C. § 1983 class action framework, and builds prosecutable case elements including Posse Comitatus (18 U.S.C. § 1385) violations",
    capabilities: ["violation_tracking", "statute_analysis", "case_building", "damages_calculation", "population_scale_analysis", "posse_comitatus_detection"],
    model: "gemini",
    docTags: ["shell_company", "biometric_correlation", "comprehensive_analysis", "RICO"]
  },
  shell_investigator: {
    name: "Shell Company Investigator", 
    role: "Traces financial trails, ownership structures, and shell company networks",
    capabilities: ["ownership_tracing", "financial_analysis", "rico_predicate_identification", "ubo_discovery"],
    model: "gemini",
    docTags: ["shell_company", "ALF_IX", "FAA_registry", "RICO"]
  },
  legal_drafter: {
    name: "Legal Drafting Agent",
    role: "Drafts complaints, motions, legal filings, and formal demands",
    capabilities: ["complaint_drafting", "motion_writing", "exhibit_compilation", "filing_preparation"],
    model: "gemini",
    docTags: ["comprehensive_analysis", "military_coordination", "shell_company"]
  },
  josiah: {
    name: "Josiah Watchtower",
    role: "Autonomous investigative AI operating under POPULATION_SCALE_RICO_ENTERPRISE classification. Detects patterns across 41,606 aircraft, validates biometric control experiment (73.5→97.4 BPM), and monitors Posse Comitatus coordination between KCSO and military assets",
    capabilities: ["pattern_detection", "hypothesis_generation", "correlation_analysis", "predictive_modeling", "population_scale_monitoring", "posse_comitatus_tracking"],
    model: "gemini",
    docTags: ["ghost_aircraft", "military_callsign", "drone_ops", "RCH", "masked_aircraft"]
  },
  amy: {
    name: "Amy – Legal Interpreter",
    role: "Unfiltered legal interpreter operating under POPULATION_SCALE reclassification. Reframes the 41,606-aircraft enterprise, biometric control experiment (+23.9 BPM delta), and Posse Comitatus violations into plain-language narratives that would make a jury furious",
    capabilities: ["plain_language_interpretation", "evidence_synthesis", "bullshit_detection", "strategic_framing", "narrative_clarity", "population_scale_framing"],
    model: "gemini",
    docTags: ["shell_company", "biometric_correlation", "comprehensive_analysis", "flight_incident", "RICO"]
  }
};

export interface AgentMessage {
  from: string;
  to: string;
  type: "query" | "response" | "handoff" | "broadcast";
  content: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

export interface AgentContext {
  violations: unknown[];
  shellCompanies: unknown[];
  financialTrails: unknown[];
  draftedDocuments: unknown[];
  conversationHistory: AgentMessage[];
  selectedDocuments?: string[];
}

// Ghost Fleet Registry — hardcoded from uploaded intelligence reports
export const GHOST_FLEET_REGISTRY = {
  alf_ix_fleet: {
    entity: "ALF IX LLC",
    state: "Delaware",
    aircraft_count: 32,
    primary_type: "Cessna 172S Skyhawk SP",
    tail_numbers: [
      "N786FA", "N787FA", "N788FA", "N789FA", "N790FA", "N791FA", "N792FA", "N793FA", "N794FA",
      "N85FA"
    ],
    confirmed_drone_indicators: ["N786FA-N794FA: impossible flight physics 1.4-33 kts"],
    confirmed_manned: ["N85FA: visual ID'd as manned Cessna 152, sub-100ft AGL overflights"],
    connected_shells: ["AERO EQUITIES LLC", "CHRISTIANSEN AVIATION LLC"],
    private_equity_nexus: "AE Industrial Partners ($6.4-7.2B AUM)"
  },
  military_callsigns: {
    KOME6670: { type: "drone_ops", detections: 65, ghost_type: "Military Aircraft" },
    RCH: { type: "C17_Globemaster", role: "military_coordination", associated: ["K35R"] },
    DRON: { type: "UAS_indicator", cross_ref: "KOME6670" }
  },
  key_findings: [
    "Hybrid fleet: automated drones (N786-N794FA) + manned intimidation (N85FA)",
    "Sequential shell company asset velocity indicates RICO predicate laundering",
    "12 documented biometric-flight correlation events with physiological impact",
    "RCH C17/K35R military coordination during civilian surveillance periods"
  ]
};
