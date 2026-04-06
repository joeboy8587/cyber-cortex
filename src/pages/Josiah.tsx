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

        {/* Sentinel Monitor - Primary AI */}
        <section>
          <JosiahSentinelMonitor />
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
