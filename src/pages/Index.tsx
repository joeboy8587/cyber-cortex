import { CommandHeader } from "@/components/dashboard/CommandHeader";
import { DatabaseStats } from "@/components/dashboard/DatabaseStats";
import { ThreatMatrix } from "@/components/dashboard/ThreatMatrix";
import { BiometricCorrelation } from "@/components/dashboard/BiometricCorrelation";
import { ChainOfCustodyPanel } from "@/components/dashboard/ChainOfCustodyPanel";
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

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="relative z-10">
        <CommandHeader />
        <main className="container py-6 space-y-6">
          <section id="database-stats">
            <DatabaseStats />
          </section>
          
          <section id="threat-matrix" className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ThreatMatrix />
            <BiometricCorrelation />
          </section>
          
          <section id="evidence" className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <EvidenceTimeline />
            <DataStreams />
          </section>
          
          <section id="legal-analysis">
            <LegalAnalysisAI />
          </section>
          
          <section id="outreach">
            <OutreachHub />
          </section>
          
          <section id="chain-of-custody" className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ChainOfCustodyPanel />
            <PhysicianVerifiedECGs />
          </section>
          
          <section id="enterprise-network" className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <CriminalEnterpriseNetwork />
            <EnterpriseProfiles />
          </section>
          
          <section id="pattern-analysis">
            <PatternCoordinationAnalysis />
          </section>
          
          <section id="correlation-engine" className="grid grid-cols-1 gap-6">
            <FourFactorCorrelationEngine />
          </section>
          
          <section id="ocr-evidence" className="grid grid-cols-1 gap-6">
            <OCREvidencePanel />
          </section>
          
          <section id="fleet-tracking" className="grid grid-cols-1 gap-6">
            <FleetTrackingLedger />
          </section>
          
          <section id="kcso-report" className="grid grid-cols-1 gap-6">
            <KCSOSurveillanceReport />
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