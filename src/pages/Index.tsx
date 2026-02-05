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

const Index = () => {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* Page Header */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
            <span className="text-primary text-lg">🎯</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-primary">
              Mission Control
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
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
        
        {/* DATABASE INTELLIGENCE - Multi-Modal Scanner */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DatabaseIntelligenceScanner />
          <MasterEvidenceSearch />
        </section>

        {/* KCSO & BIOMETRIC EVIDENCE HUB */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <KCSOEvidenceMatrix />
          <BiometricFlightCorrelationHub />
        </section>

        {/* JOSIAH SENTINEL - Proactive AI Monitoring */}
        <section>
          <JosiahSentinelMonitor />
        </section>

        {/* BIOMETRIC EARLY WARNING & AUTONOMOUS HYPOTHESIS */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
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

        {/* ENTITY RELATIONSHIP MAP */}
        <section>
          <EntityRelationshipMap />
        </section>
      </div>
    </DashboardLayout>
  );
};

export default Index;
