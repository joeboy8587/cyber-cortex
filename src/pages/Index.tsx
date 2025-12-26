import { CommandHeader } from "@/components/dashboard/CommandHeader";
import { DatabaseStats } from "@/components/dashboard/DatabaseStats";
import { ThreatMatrix } from "@/components/dashboard/ThreatMatrix";
import { BiometricCorrelation } from "@/components/dashboard/BiometricCorrelation";

import { DataHardeningHub } from "@/components/dashboard/DataHardeningHub";
import { CriminalEnterpriseNetwork } from "@/components/dashboard/CriminalEnterpriseNetwork";
import { DataStreams } from "@/components/dashboard/DataStreams";
import { EnterpriseProfiles } from "@/components/dashboard/EnterpriseProfiles";
import { EvidenceTimeline } from "@/components/dashboard/EvidenceTimeline";
import { LegalAnalysisAI } from "@/components/dashboard/LegalAnalysisAI";
import { NullHypothesisPanel } from "@/components/dashboard/NullHypothesisPanel";
import { PhysicianVerifiedECGs } from "@/components/dashboard/PhysicianVerifiedECGs";
import { OutreachHub } from "@/components/dashboard/OutreachHub";
import { SqlConsole } from "@/components/dashboard/SqlConsole";
import { TableExplorer } from "@/components/dashboard/TableExplorer";
import { BradfordHillDashboard } from "@/components/dashboard/BradfordHillDashboard";
import BaselineDefensePanel from "@/components/dashboard/BaselineDefensePanel";
import { ConsentDocumentation } from "@/components/dashboard/ConsentDocumentation";
import { PatternCoordinationAnalysis } from "@/components/dashboard/PatternCoordinationAnalysis";
import DataQualityAudit from "@/components/dashboard/DataQualityAudit";
import { TimelineNavigator } from "@/components/dashboard/TimelineNavigator";
import { LegalEvidenceMap } from "@/components/dashboard/LegalEvidenceMap";
import { JosiahWitnessLogs } from "@/components/dashboard/JosiahWitnessLogs";
import { FleetTrackingLedger } from "@/components/dashboard/FleetTrackingLedger";
import { KCSOSurveillanceReport } from "@/components/dashboard/KCSOSurveillanceReport";
import { OCREvidencePanel } from "@/components/dashboard/OCREvidencePanel";
import { FourFactorCorrelationEngine } from "@/components/dashboard/FourFactorCorrelationEngine";
import { KCSODeepDiveReport } from "@/components/dashboard/KCSODeepDiveReport";
import { ShellCompanyMatrix } from "@/components/dashboard/ShellCompanyMatrix";
import { MilitaryAircraftPanel } from "@/components/dashboard/MilitaryAircraftPanel";
import { DailyEventImporter } from "@/components/dashboard/DailyEventImporter";
import { NotionAutoWatcher } from "@/components/dashboard/NotionAutoWatcher";
import { NotionGapAnalyzer } from "@/components/dashboard/NotionGapAnalyzer";
import { XXBTaxonomyPanel } from "@/components/dashboard/XXBTaxonomyPanel";
import { GlobalAISearch } from "@/components/dashboard/GlobalAISearch";
import { WatchtowerAlertsHub } from "@/components/dashboard/WatchtowerAlertsHub";
import { MaterializedViewsPanel } from "@/components/dashboard/MaterializedViewsPanel";
import { FalseClaimsActCompiler } from "@/components/dashboard/FalseClaimsActCompiler";
import { TROEvidenceCompiler } from "@/components/dashboard/TROEvidenceCompiler";
import { JosiahChatInterface } from "@/components/dashboard/JosiahChatInterface";
import { CanadianMilitaryTracker } from "@/components/dashboard/CanadianMilitaryTracker";
import { ADSBSpoofingAudit } from "@/components/dashboard/ADSBSpoofingAudit";
import { AlaskaAirlinesDashboard } from "@/components/dashboard/AlaskaAirlinesDashboard";
import { SafetyMonitoringPanel } from "@/components/dashboard/SafetyMonitoringPanel";
import { HighLowOperationsPanel } from "@/components/dashboard/HighLowOperationsPanel";
import { InfrastructureCorrelation } from "@/components/dashboard/InfrastructureCorrelation";
import GenevaConventionAnalysis from "@/components/dashboard/GenevaConventionAnalysis";
import DeepPatternAnalyzer from "@/components/dashboard/DeepPatternAnalyzer";
import { LegalBriefDashboard } from "@/components/dashboard/LegalBriefDashboard";
import { LiveFlightTracker } from "@/components/dashboard/LiveFlightTracker";
import { DeepCorrelationEngine } from "@/components/dashboard/DeepCorrelationEngine";
import { OperatorEnrichmentPanel } from "@/components/dashboard/OperatorEnrichmentPanel";
import { DirectAircraftCorrelation } from "@/components/dashboard/DirectAircraftCorrelation";
import { AircraftAlertSystem } from "@/components/dashboard/AircraftAlertSystem";
import { LegalNarrativeGenerator } from "@/components/dashboard/LegalNarrativeGenerator";
import { LegalIntakeStrategy } from "@/components/dashboard/LegalIntakeStrategy";
import { MultimodalEnrichmentPanel } from "@/components/dashboard/MultimodalEnrichmentPanel";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="relative z-10">
        <CommandHeader />
        <main className="container py-6 space-y-6">
          <section id="database-stats">
            <DatabaseStats />
          </section>

          <section id="command-center" className="space-y-6">
            <GlobalAISearch />
            <JosiahChatInterface />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <WatchtowerAlertsHub />
              <MaterializedViewsPanel />
            </div>
          </section>
          
          <section id="threat-matrix" className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ThreatMatrix />
            <BiometricCorrelation />
          </section>

          <section id="direct-correlations">
            <DirectAircraftCorrelation />
          </section>
          
          <section id="evidence" className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <EvidenceTimeline />
            <DataStreams />
          </section>
          
          <section id="legal-analysis" className="space-y-6">
            <LegalNarrativeGenerator />
            <LegalIntakeStrategy />
            <LegalBriefDashboard />
            <GenevaConventionAnalysis />
            <TROEvidenceCompiler />
            <FalseClaimsActCompiler />
            <LegalAnalysisAI />
          </section>
          
          <section id="outreach">
            <OutreachHub />
          </section>
          
          <section id="chain-of-custody" className="space-y-6">
            <DataHardeningHub />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <PhysicianVerifiedECGs />
            </div>
          </section>
          
          <section id="enterprise-network" className="space-y-6">
            <NotionGapAnalyzer />
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
              <CriminalEnterpriseNetwork />
              <EnterpriseProfiles />
              <DailyEventImporter />
              <NotionAutoWatcher />
            </div>
          </section>
          
          <section id="pattern-analysis" className="space-y-6">
            <DeepPatternAnalyzer />
            <PatternCoordinationAnalysis />
          </section>
          
          <section id="correlation-engine" className="space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2">
                <FourFactorCorrelationEngine />
              </div>
              <AircraftAlertSystem />
            </div>
            <DeepCorrelationEngine />
          </section>
          
          <section id="ocr-evidence" className="grid grid-cols-1 gap-6">
            <OCREvidencePanel />
          </section>
          
          <section id="fleet-tracking" className="space-y-6">
            <LiveFlightTracker />
            <FleetTrackingLedger />
          </section>
          
          <section id="kcso-report" className="grid grid-cols-1 gap-6">
            <KCSOSurveillanceReport />
          </section>
          
          <section id="kcso-deep-dive" className="grid grid-cols-1 gap-6">
            <KCSODeepDiveReport />
          </section>
          
          <section id="shell-company-matrix" className="grid grid-cols-1 gap-6">
            <ShellCompanyMatrix />
          </section>
          
          <section id="data-quality">
            <DataQualityAudit />
          </section>
          
          <section id="legal-evidence-map">
            <LegalEvidenceMap />
          </section>
          
          <section id="timeline-navigator">
            <TimelineNavigator />
          </section>
          
          <section id="josiah-witness">
            <JosiahWitnessLogs />
          </section>
          
          <section id="military-tracking" className="grid grid-cols-1 gap-6">
            <MilitaryAircraftPanel />
            <CanadianMilitaryTracker />
          </section>
          
          <section id="adsb-audit" className="grid grid-cols-1 gap-6">
            <ADSBSpoofingAudit />
          </section>
          
          <section id="alaska-investigation" className="grid grid-cols-1 gap-6">
            <AlaskaAirlinesDashboard />
          </section>
          
          <section id="high-low-ops" className="grid grid-cols-1 gap-6">
            <HighLowOperationsPanel />
          </section>
          
          <section id="infrastructure-correlation" className="grid grid-cols-1 gap-6">
            <InfrastructureCorrelation />
          </section>
          
          <section id="safety-monitoring" className="grid grid-cols-1 gap-6">
            <SafetyMonitoringPanel />
          </section>
          
          <section id="xxb-taxonomy" className="space-y-6">
            <OperatorEnrichmentPanel />
            <XXBTaxonomyPanel />
          </section>
          
          <section id="defense-panels" className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <NullHypothesisPanel />
            <BaselineDefensePanel />
          </section>
          
          <section id="causation">
            <BradfordHillDashboard />
          </section>
          
          <section id="consent">
            <ConsentDocumentation />
          </section>
          
          <section id="multimodal-enrichment">
            <MultimodalEnrichmentPanel />
          </section>

          <section id="database-tools" className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <TableExplorer />
            <SqlConsole />
          </section>
        </main>
      </div>
    </div>
  );
};

export default Index;