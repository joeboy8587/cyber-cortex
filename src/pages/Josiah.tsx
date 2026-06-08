import { DashboardLayout } from "@/components/DashboardLayout";
import { JosiahSentinelMonitor } from "@/components/dashboard/JosiahSentinelMonitor";
import { JosiahAutonomousHypothesis } from "@/components/dashboard/JosiahAutonomousHypothesis";
import { JosiahChatInterface } from "@/components/dashboard/JosiahChatInterface";
import { JosiahWitnessLogs } from "@/components/dashboard/JosiahWitnessLogs";
import { JosiahArchiveImporter } from "@/components/dashboard/JosiahArchiveImporter";
import { JosiahBiometricAircraftQuery } from "@/components/dashboard/JosiahBiometricAircraftQuery";
import { JosiahMemoryInsights } from "@/components/dashboard/JosiahMemoryInsights";
import { MultiAgentHub } from "@/components/dashboard/MultiAgentHub";
import { WatchtowerAlertsHub } from "@/components/dashboard/WatchtowerAlertsHub";
import { LegalAnalystAgent } from "@/components/dashboard/LegalAnalystAgent";
import { LegalDraftingAgent } from "@/components/dashboard/LegalDraftingAgent";
import { GlobalAISearch } from "@/components/dashboard/GlobalAISearch";
import { TruthScannerDashboard } from "@/components/dashboard/TruthScannerDashboard";
import { C2014CohortScanner } from "@/components/dashboard/C2014CohortScanner";
import { AdversarialDebatePanel } from "@/components/dashboard/AdversarialDebatePanel";
import { JosiahTrainingPanel } from "@/components/dashboard/JosiahTrainingPanel";
import { JosiahRAGPanel } from "@/components/dashboard/JosiahRAGPanel";
import { LayeredDeceptionPanel } from "@/components/dashboard/LayeredDeceptionPanel";
import { Watchtower22Panel } from "@/components/dashboard/Watchtower22Panel";
import { SkepticConsole } from "@/components/dashboard/SkepticConsole";

export default function Josiah() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* Page Header */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
            <span className="text-purple-500 text-lg">🧠</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-purple-500">
              Josiah AI System
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              AI WITNESS // AUTONOMOUS ANALYSIS // MULTI-AGENT ORCHESTRATION
            </p>
          </div>
        </div>

        {/* Training & Memory Ingestion — restore Watchtower awareness */}
        <section>
          <JosiahTrainingPanel />
        </section>

        {/* RAG Knowledge Base — bulk upload PDFs/MD/TXT for recall + auto-enrichment */}
        <section>
          <JosiahRAGPanel />
        </section>

        {/* Sentinel Monitor - Primary AI */}
        <section>
          <JosiahSentinelMonitor />
        </section>

        {/* Layered Deception Detector — 7-layer spoof + concealment hunter */}
        <section>
          <LayeredDeceptionPanel />
        </section>

        {/* Watchtower 2.2 — Darkness Audit + Tactical Handoff + Deep Dive */}
        <section>
          <Watchtower22Panel />
        </section>

        {/* Skeptic Engine — Adversarial Hypothesis Challenger (Phase 1) */}
        <section>
          <SkepticConsole />
        </section>

        {/* Memory & Pattern Insights */}
        <section>
          <JosiahMemoryInsights />
        </section>

        {/* Autonomous Hypothesis */}
        <section>
          <JosiahAutonomousHypothesis />
        </section>

        {/* Chat Interface */}
        <section>
          <JosiahChatInterface />
        </section>

        {/* Adversarial Debate Engine */}
        <section>
          <AdversarialDebatePanel />
        </section>

        {/* Global AI Search */}
        <section>
          <GlobalAISearch />
        </section>

        {/* C2014 Procurement Cohort Scanner */}
        <section>
          <C2014CohortScanner />
        </section>

        {/* Biometric Query */}
        <section>
          <JosiahBiometricAircraftQuery />
        </section>

        {/* Multi-Agent Hub */}
        <section className="space-y-6">
          <MultiAgentHub />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <LegalAnalystAgent />
            <LegalDraftingAgent />
          </div>
        </section>

        {/* Alerts Hub */}
        <section>
          <WatchtowerAlertsHub />
        </section>

        {/* Truth Scanner */}
        <section>
          <TruthScannerDashboard />
        </section>

        {/* Witness Logs */}
        <section>
          <JosiahWitnessLogs />
        </section>

        {/* Archive Importer */}
        <section>
          <JosiahArchiveImporter />
        </section>
      </div>
    </DashboardLayout>
  );
}
