import { CommandHeader } from "@/components/dashboard/CommandHeader";
import { DatabaseStats } from "@/components/dashboard/DatabaseStats";
import { ThreatMatrix } from "@/components/dashboard/ThreatMatrix";
import { BiometricCorrelation } from "@/components/dashboard/BiometricCorrelation";
import { LegalAnalysisAI } from "@/components/dashboard/LegalAnalysisAI";
import { EvidenceTimeline } from "@/components/dashboard/EvidenceTimeline";
import { DataStreams } from "@/components/dashboard/DataStreams";
import { NullHypothesisPanel } from "@/components/dashboard/NullHypothesisPanel";
import { TableExplorer } from "@/components/dashboard/TableExplorer";
import { SqlConsole } from "@/components/dashboard/SqlConsole";

const Index = () => {
  return (
    <div className="min-h-screen bg-background hex-pattern">
      {/* Animated background effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 data-grid opacity-20" />
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-30" />
        <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-secondary to-transparent opacity-30" />
      </div>

      <div className="relative z-10">
        <CommandHeader />

        <main className="container py-6 space-y-6">
          {/* Database Statistics */}
          <section>
            <DatabaseStats />
          </section>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              <ThreatMatrix />
              <TableExplorer />
            </div>

            {/* Center Column */}
            <div className="space-y-6">
              <BiometricCorrelation />
              <DataStreams />
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              <LegalAnalysisAI />
              <NullHypothesisPanel />
            </div>
          </div>

          {/* SQL Console - Full Width */}
          <section>
            <SqlConsole />
          </section>

          {/* Evidence Timeline - Full Width */}
          <section>
            <EvidenceTimeline />
          </section>

          {/* Footer */}
          <footer className="border-t border-border pt-6 mt-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <span className="font-display uppercase tracking-wider">
                  WATCHTOWER INTELLIGENCE PLATFORM
                </span>
                <span className="hidden md:inline">|</span>
                <span>Oildale Grid Exposure System</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-primary">Status: LIVE DATA</span>
                <span>|</span>
                <span>Connected to NeonDB</span>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
};

export default Index;