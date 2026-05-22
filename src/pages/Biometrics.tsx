import { DashboardLayout } from "@/components/DashboardLayout";
import { BiometricCausationValidator } from "@/components/dashboard/BiometricCausationValidator";
import { PhysicianVerifiedECGs } from "@/components/dashboard/PhysicianVerifiedECGs";
import { ManualBiometricLogger } from "@/components/dashboard/ManualBiometricLogger";
import { DeepCorrelationEngine } from "@/components/dashboard/DeepCorrelationEngine";
import { BradfordHillDashboard } from "@/components/dashboard/BradfordHillDashboard";
import { FourFactorCorrelationEngine } from "@/components/dashboard/FourFactorCorrelationEngine";
import { BiometricCorrelation } from "@/components/dashboard/BiometricCorrelation";
import { BiometricEarlyWarningSystem } from "@/components/dashboard/BiometricEarlyWarningSystem";
import { BiometricFlightCorrelationHub } from "@/components/dashboard/BiometricFlightCorrelationHub";
import { ChronoBiometricDigest } from "@/components/dashboard/ChronoBiometricDigest";
import { MedicalBehavioralAlignment } from "@/components/dashboard/MedicalBehavioralAlignment";
import { SafetyMonitoringPanel } from "@/components/dashboard/SafetyMonitoringPanel";
import { NullHypothesisPanel } from "@/components/dashboard/NullHypothesisPanel";
import { BiometricArchivePanel } from "@/components/dashboard/BiometricArchivePanel";
import { BiometricSourceBanner } from "@/components/dashboard/BiometricSourceBanner";

export default function Biometrics() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* Page Header */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-destructive/10 border border-destructive/30 flex items-center justify-center">
            <span className="text-destructive text-lg">❤️</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-destructive">
              Biometric Hub
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              HEALTH MONITORING // CAUSATION ANALYSIS // ECG VALIDATION
            </p>
          </div>
        </div>

        {/* Canonical source-of-truth banner */}
        <section>
          <BiometricSourceBanner />
        </section>

        {/* 🔥 Full Biometric Archive - 305K+ Records */}
        <section>
          <BiometricArchivePanel />
        </section>

        {/* Early Warning System */}
        <section>
          <BiometricEarlyWarningSystem />
        </section>

        {/* Causation Validator - Key Evidence */}
        <section>
          <BiometricCausationValidator />
        </section>

        {/* Correlation Hub */}
        <section>
          <BiometricFlightCorrelationHub />
        </section>

        {/* Deep Correlation Engine */}
        <section className="space-y-6">
          <DeepCorrelationEngine />
          <FourFactorCorrelationEngine />
        </section>

        {/* Bradford Hill Analysis */}
        <section>
          <BradfordHillDashboard />
        </section>

        {/* Physician Verified */}
        <section className="space-y-6">
          <PhysicianVerifiedECGs />
          <ChronoBiometricDigest />
        </section>

        {/* Manual Logging */}
        <section>
          <ManualBiometricLogger />
        </section>

        {/* Behavioral Alignment */}
        <section className="space-y-6">
          <MedicalBehavioralAlignment />
          <SafetyMonitoringPanel />
        </section>

        {/* Statistical Analysis */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <BiometricCorrelation />
          <NullHypothesisPanel />
        </section>
      </div>
    </DashboardLayout>
  );
}
