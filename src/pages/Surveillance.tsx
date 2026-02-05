import { DashboardLayout } from "@/components/DashboardLayout";
import AircraftMapVisualization from "@/components/dashboard/AircraftMapVisualization";
import { LiveFlightTracker } from "@/components/dashboard/LiveFlightTracker";
import { DirectAircraftCorrelation } from "@/components/dashboard/DirectAircraftCorrelation";
import { AlaskaAirlinesDashboard } from "@/components/dashboard/AlaskaAirlinesDashboard";
import { FleetTrackingLedger } from "@/components/dashboard/FleetTrackingLedger";
import { MilitaryAircraftPanel } from "@/components/dashboard/MilitaryAircraftPanel";
import { CanadianMilitaryTracker } from "@/components/dashboard/CanadianMilitaryTracker";
import { ADSBSpoofingAudit } from "@/components/dashboard/ADSBSpoofingAudit";
import { ADSBSpoofingDetector } from "@/components/dashboard/ADSBSpoofingDetector";
import { BiometricBattleMap } from "@/components/dashboard/BiometricBattleMap";
import { HammerAnvilPatternPanel } from "@/components/dashboard/HammerAnvilPatternPanel";
import { HighLowOperationsPanel } from "@/components/dashboard/HighLowOperationsPanel";
import { FlightDataScraper } from "@/components/dashboard/FlightDataScraper";
import { FlightSaturationAnalyzer } from "@/components/dashboard/FlightSaturationAnalyzer";
import { AircraftAlertSystem } from "@/components/dashboard/AircraftAlertSystem";
import { OperatorEnrichmentPanel } from "@/components/dashboard/OperatorEnrichmentPanel";
import { InfrastructureCorrelation } from "@/components/dashboard/InfrastructureCorrelation";
import { PatternCoordinationAnalysis } from "@/components/dashboard/PatternCoordinationAnalysis";
import DeepPatternAnalyzer from "@/components/dashboard/DeepPatternAnalyzer";
import F24RadarUploader from "@/components/dashboard/F24RadarUploader";

export default function Surveillance() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* Page Header */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
            <span className="text-primary text-lg">📡</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-primary">
              Surveillance Hub
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              AIRCRAFT TRACKING // FLIGHT PATTERNS // ADSB MONITORING
            </p>
          </div>
        </div>

        {/* 🔥 BIOMETRIC BATTLE MAP - Real-Time Overlay */}
        <section>
          <BiometricBattleMap />
        </section>

        {/* Map & Live Tracker */}
        <section className="space-y-6">
          <AircraftMapVisualization />
          <LiveFlightTracker />
        </section>

        {/* 🔥 ADS-B SPOOFING DETECTOR - Real-Time Masking Detection */}
        <section>
          <ADSBSpoofingDetector />
        </section>

        {/* Direct Correlation */}
        <section>
          <DirectAircraftCorrelation />
        </section>

        {/* Pattern Analysis */}
        <section className="space-y-6">
          <HammerAnvilPatternPanel />
          <HighLowOperationsPanel />
          <FlightSaturationAnalyzer />
        </section>

        {/* Fleet Tracking */}
        <section className="space-y-6">
          <FleetTrackingLedger />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <AircraftAlertSystem />
            <OperatorEnrichmentPanel />
          </div>
        </section>

        {/* Military Tracking */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <MilitaryAircraftPanel />
          <CanadianMilitaryTracker />
        </section>

        {/* ADSB & Spoofing */}
        <section className="space-y-6">
          <ADSBSpoofingAudit />
          <AlaskaAirlinesDashboard />
        </section>

        {/* Pattern Analysis Tools */}
        <section className="space-y-6">
          <DeepPatternAnalyzer />
          <PatternCoordinationAnalysis />
          <InfrastructureCorrelation />
        </section>

        {/* Data Upload */}
        <section className="space-y-6">
          <F24RadarUploader />
          <FlightDataScraper />
        </section>
      </div>
    </DashboardLayout>
  );
}
