import { DashboardLayout } from "@/components/DashboardLayout";
import { LiveAlertBanner } from "@/components/dashboard/LiveAlertBanner";
import { JosiahSentinelMonitor } from "@/components/dashboard/JosiahSentinelMonitor";
import { BiometricEarlyWarningSystem } from "@/components/dashboard/BiometricEarlyWarningSystem";
import { DatabaseIntelligenceScanner } from "@/components/dashboard/DatabaseIntelligenceScanner";
import { MasterEvidenceSearch } from "@/components/dashboard/MasterEvidenceSearch";
import { KCSOEvidenceMatrix } from "@/components/dashboard/KCSOEvidenceMatrix";
import { BiometricFlightCorrelationHub } from "@/components/dashboard/BiometricFlightCorrelationHub";
import { ForensicLinkageHub } from "@/components/dashboard/ForensicLinkageHub";
import { ThreatMatrix } from "@/components/dashboard/ThreatMatrix";
import { ComprehensiveEvidenceScan } from "@/components/dashboard/ComprehensiveEvidenceScan";
import { MasterEvidenceHub } from "@/components/dashboard/MasterEvidenceHub";
import { JosiahAutonomousHypothesis } from "@/components/dashboard/JosiahAutonomousHypothesis";
import { EntityRelationshipMap } from "@/components/dashboard/EntityRelationshipMap";
import { PredictiveFlightModeling } from "@/components/dashboard/PredictiveFlightModeling";
import { ShellNetworkGraph } from "@/components/dashboard/ShellNetworkGraph";
import { EvidencePowerhouse } from "@/components/dashboard/EvidencePowerhouse";
import { SentinelViolationsBoard } from "@/components/dashboard/SentinelViolationsBoard";
import { EvidenceStitcher } from "@/components/dashboard/EvidenceStitcher";
import { ArchiveDataMap } from "@/components/dashboard/ArchiveDataMap";
import { PopulationScaleAnalysis } from "@/components/dashboard/PopulationScaleAnalysis";
import { DailyTriagePanel } from "@/components/dashboard/DailyTriagePanel";
import { ForceMultiplierPanel } from "@/components/dashboard/ForceMultiplierPanel";
import { TableIntelligencePanel } from "@/components/dashboard/TableIntelligencePanel";
import { PipelineFreshnessStrip } from "@/components/dashboard/PipelineFreshnessStrip";
import { FlagTriagePanel } from "@/components/dashboard/FlagTriagePanel";

const Index = () => {
  return (
    <DashboardLayout>
      <div className="px-3 sm:px-4 lg:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 max-w-full overflow-x-hidden">
        {/* Page Header */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
            <span className="text-primary text-base sm:text-lg">🎯</span>
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-lg sm:text-2xl uppercase tracking-wider text-primary truncate">
              Mission Control
            </h1>
            <p className="font-mono text-[10px] sm:text-xs text-muted-foreground truncate">
              PRIORITY ALERTS // EVIDENCE HUB // REAL-TIME MONITORING
            </p>
          </div>
        </div>

        {/* LIVE ALERT BANNER - Always visible at top */}
        <section>
          <LiveAlertBanner 
            lowAltitudeThreshold={1500} 
            autoRefreshInterval={30000}
            soundEnabled={true}
          />
        </section>

        {/* DAILY TRIAGE — 1-page brief from 20M rows */}
        <section>
          <DailyTriagePanel />
        </section>

        {/* DISCOVERY LAYER — table catalog + entity resolution across 800 tables */}
        <section>
          <TableIntelligencePanel />
        </section>

        {/* FORCE MULTIPLIERS — unified views, anomaly sweep, PageRank */}
        <section>
          <ForceMultiplierPanel />
        </section>

        {/* POPULATION-SCALE RECLASSIFICATION — Top priority */}
        <section>
          <PopulationScaleAnalysis />
        </section>
        
        {/* ARCHIVE DATA MAP - Visual domain overview */}
        <section>
          <ArchiveDataMap />
        </section>

        {/* DATABASE INTELLIGENCE - Multi-Modal Scanner */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
          <DatabaseIntelligenceScanner />
          <MasterEvidenceSearch />
        </section>

        {/* KCSO & BIOMETRIC EVIDENCE HUB */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
          <KCSOEvidenceMatrix />
          <BiometricFlightCorrelationHub />
        </section>

        {/* JOSIAH SENTINEL - Proactive AI Monitoring */}
        <section>
          <JosiahSentinelMonitor />
        </section>

        {/* 🔥 PREDICTIVE HUNTING MACHINE - AI-Powered Threat Prediction */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
          <PredictiveFlightModeling />
          <ShellNetworkGraph />
        </section>

        {/* BIOMETRIC EARLY WARNING & AUTONOMOUS HYPOTHESIS */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
          <BiometricEarlyWarningSystem />
          <JosiahAutonomousHypothesis />
        </section>

        {/* COMPREHENSIVE EVIDENCE SCAN */}
        <section>
          <ComprehensiveEvidenceScan />
        </section>

        {/* THREAT MATRIX */}
        <section>
          <ThreatMatrix />
        </section>

        {/* FORENSIC LINKAGE HUB */}
        <section>
          <ForensicLinkageHub />
        </section>

        {/* MASTER EVIDENCE HUB */}
        <section>
          <MasterEvidenceHub />
        </section>

        {/* 🔥 EVIDENCE POWERHOUSE - 9.6M Records Unlocked */}
        <section>
          <EvidencePowerhouse />
        </section>

        {/* SENTINEL VIOLATIONS BOARD - 670K Records */}
        <section>
          <SentinelViolationsBoard />
        </section>

        {/* CROSS-MODAL EVIDENCE STITCHER - 487K Records */}
        <section>
          <EvidenceStitcher />
        </section>

        {/* ENTITY RELATIONSHIP MAP */}
        <section>
          <EntityRelationshipMap />
        </section>
      </div>
    </DashboardLayout>
  );
};

export default Index;
