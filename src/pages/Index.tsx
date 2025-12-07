import { Suspense, lazy } from "react";
import { CommandHeader } from "@/components/dashboard/CommandHeader";
import { DatabaseStats } from "@/components/dashboard/DatabaseStats";

// Lazy load heavy components to prevent initial render crash
const ThreatMatrix = lazy(() => import("@/components/dashboard/ThreatMatrix").then(m => ({ default: m.ThreatMatrix })));
const BiometricCorrelation = lazy(() => import("@/components/dashboard/BiometricCorrelation").then(m => ({ default: m.BiometricCorrelation })));
const LegalAnalysisAI = lazy(() => import("@/components/dashboard/LegalAnalysisAI").then(m => ({ default: m.LegalAnalysisAI })));
const EvidenceTimeline = lazy(() => import("@/components/dashboard/EvidenceTimeline").then(m => ({ default: m.EvidenceTimeline })));
const DataStreams = lazy(() => import("@/components/dashboard/DataStreams").then(m => ({ default: m.DataStreams })));
const NullHypothesisPanel = lazy(() => import("@/components/dashboard/NullHypothesisPanel").then(m => ({ default: m.NullHypothesisPanel })));
const TableExplorer = lazy(() => import("@/components/dashboard/TableExplorer").then(m => ({ default: m.TableExplorer })));
const SqlConsole = lazy(() => import("@/components/dashboard/SqlConsole").then(m => ({ default: m.SqlConsole })));
const OutreachHub = lazy(() => import("@/components/dashboard/OutreachHub").then(m => ({ default: m.OutreachHub })));
const BradfordHillDashboard = lazy(() => import("@/components/dashboard/BradfordHillDashboard").then(m => ({ default: m.BradfordHillDashboard })));
const ConsentDocumentation = lazy(() => import("@/components/dashboard/ConsentDocumentation").then(m => ({ default: m.ConsentDocumentation })));
const EnterpriseProfiles = lazy(() => import("@/components/dashboard/EnterpriseProfiles").then(m => ({ default: m.EnterpriseProfiles })));
const PhysicianVerifiedECGs = lazy(() => import("@/components/dashboard/PhysicianVerifiedECGs").then(m => ({ default: m.PhysicianVerifiedECGs })));
const CriminalEnterpriseNetwork = lazy(() => import("@/components/dashboard/CriminalEnterpriseNetwork").then(m => ({ default: m.CriminalEnterpriseNetwork })));
const BaselineDefensePanel = lazy(() => import("@/components/dashboard/BaselineDefensePanel").then(m => ({ default: m.BaselineDefensePanel })));
const ChainOfCustodyPanel = lazy(() => import("@/components/dashboard/ChainOfCustodyPanel").then(m => ({ default: m.ChainOfCustodyPanel })));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="animate-pulse text-primary font-mono">Loading...</div>
    </div>
  );
}

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
          <section id="database-stats">
            <DatabaseStats />
          </section>

          {/* Baseline Defense Destroyer */}
          <section id="baseline-defense">
            <Suspense fallback={<LoadingFallback />}>
              <BaselineDefensePanel />
            </Suspense>
          </section>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              <Suspense fallback={<LoadingFallback />}>
                <ThreatMatrix />
              </Suspense>
              <Suspense fallback={<LoadingFallback />}>
                <TableExplorer />
              </Suspense>
            </div>

            {/* Center Column */}
            <div className="space-y-6">
              <Suspense fallback={<LoadingFallback />}>
                <BiometricCorrelation />
              </Suspense>
              <Suspense fallback={<LoadingFallback />}>
                <DataStreams />
              </Suspense>
            </div>

            {/* Right Column */}
            <div className="space-y-6" id="legal-analysis">
              <Suspense fallback={<LoadingFallback />}>
                <LegalAnalysisAI />
              </Suspense>
              <Suspense fallback={<LoadingFallback />}>
                <NullHypothesisPanel />
              </Suspense>
            </div>
          </div>

          {/* Legal Recommendations Section */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Suspense fallback={<LoadingFallback />}>
              <BradfordHillDashboard />
            </Suspense>
            <Suspense fallback={<LoadingFallback />}>
              <ConsentDocumentation />
            </Suspense>
            <Suspense fallback={<LoadingFallback />}>
              <EnterpriseProfiles />
            </Suspense>
          </section>

          {/* Medical Evidence & Enterprise Network */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Suspense fallback={<LoadingFallback />}>
              <PhysicianVerifiedECGs />
            </Suspense>
            <Suspense fallback={<LoadingFallback />}>
              <CriminalEnterpriseNetwork />
            </Suspense>
          </section>

          {/* Chain of Custody - Full Width */}
          <section id="chain-of-custody">
            <Suspense fallback={<LoadingFallback />}>
              <ChainOfCustodyPanel />
            </Suspense>
          </section>

          {/* Outreach Hub - Full Width */}
          <section id="outreach-hub">
            <Suspense fallback={<LoadingFallback />}>
              <OutreachHub />
            </Suspense>
          </section>

          {/* SQL Console - Full Width */}
          <section id="sql-console">
            <Suspense fallback={<LoadingFallback />}>
              <SqlConsole />
            </Suspense>
          </section>

          {/* Evidence Timeline - Full Width */}
          <section>
            <Suspense fallback={<LoadingFallback />}>
              <EvidenceTimeline />
            </Suspense>
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
