import { DashboardLayout } from "@/components/DashboardLayout";
import TaxonomyBridgePanel from "@/components/dashboard/TaxonomyBridgePanel";
import AnonymousAnomalyAuditor from "@/components/dashboard/AnonymousAnomalyAuditor";
import AircraftMapVisualization from "@/components/dashboard/AircraftMapVisualization";
import { LiveFlightTracker } from "@/components/dashboard/LiveFlightTracker";
import { DirectAircraftCorrelation } from "@/components/dashboard/DirectAircraftCorrelation";
import { AlaskaAirlinesDashboard } from "@/components/dashboard/AlaskaAirlinesDashboard";
import { FleetTrackingLedger } from "@/components/dashboard/FleetTrackingLedger";
import { MilitaryAircraftPanel } from "@/components/dashboard/MilitaryAircraftPanel";
import { CanadianMilitaryTracker } from "@/components/dashboard/CanadianMilitaryTracker";
import { ADSBSpoofingAudit } from "@/components/dashboard/ADSBSpoofingAudit";
import { ADSBSpoofingDetector } from "@/components/dashboard/ADSBSpoofingDetector";
import { SpoofDetectionPanel } from "@/components/dashboard/SpoofDetectionPanel";
import { DroneInvestigationPanel } from "@/components/dashboard/DroneInvestigationPanel";
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
import { NullIcaoForensicPanel } from "@/components/dashboard/NullIcaoForensicPanel";
import CrossCallsignTracker from "@/components/dashboard/CrossCallsignTracker";
import F24RadarUploader from "@/components/dashboard/F24RadarUploader";
import FAARegistryUploader from "@/components/dashboard/FAARegistryUploader";
import { AutonomousWatchtower } from "@/components/dashboard/AutonomousWatchtower";
import UnmaskHQSystem from "@/components/dashboard/UnmaskHQSystem";
import ForensicTrajectoryPanel from "@/components/dashboard/ForensicTrajectoryPanel";
import TransponderAnalysisDashboard from "@/components/dashboard/TransponderAnalysisDashboard";
import ICAORecyclingDashboard from "@/components/dashboard/ICAORecyclingDashboard";
import PosseComitausAnalyzer from "@/components/dashboard/PosseComitausAnalyzer";
import IFRSurveillanceDetector from "@/components/dashboard/IFRSurveillanceDetector";
import IcaoIdentityCleanup from "@/components/dashboard/IcaoIdentityCleanup";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

        <Tabs defaultValue="posse" className="space-y-6">
          <div className="rounded-lg border border-border/50 bg-background/40 p-3">
            <div className="mb-3 flex flex-col gap-1">
              <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-foreground">
                Load panels on demand
              </h2>
              <p className="text-xs text-muted-foreground">
                Tabs reduce first-load pressure on the backend and prevent startup request stampedes.
              </p>
            </div>

            <TabsList className="grid h-auto grid-cols-2 gap-2 bg-transparent p-0 lg:grid-cols-12">
              <TabsTrigger value="identity" className="text-chart-1">🧬 Identity</TabsTrigger>
              <TabsTrigger value="ifr" className="text-chart-2">🎯 IFR Detect</TabsTrigger>
              <TabsTrigger value="posse" className="text-destructive">⚖️ Posse</TabsTrigger>
              <TabsTrigger value="icao">ICAO/Shell</TabsTrigger>
              <TabsTrigger value="transponder">Transponder</TabsTrigger>
              <TabsTrigger value="auditor">Blind Audit</TabsTrigger>
              <TabsTrigger value="investigation">Investigation</TabsTrigger>
              <TabsTrigger value="live">Live Ops</TabsTrigger>
              <TabsTrigger value="watchtower">Watchtower</TabsTrigger>
              <TabsTrigger value="patterns">Patterns</TabsTrigger>
              <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
              <TabsTrigger value="intake">Intake</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="identity" className="space-y-6">
            <section>
              <IcaoIdentityCleanup />
            </section>
          </TabsContent>

          <TabsContent value="ifr" className="space-y-6">
            <section>
              <IFRSurveillanceDetector />
            </section>
          </TabsContent>

          <TabsContent value="posse" className="space-y-6">
            <section>
              <PosseComitausAnalyzer />
            </section>
          </TabsContent>

          <TabsContent value="icao" className="space-y-6">
            <section>
              <ICAORecyclingDashboard />
            </section>
          </TabsContent>

          <TabsContent value="transponder" className="space-y-6">
            <section>
              <TransponderAnalysisDashboard />
            </section>
          </TabsContent>

          <TabsContent value="auditor" className="space-y-6">
            <section>
              <AnonymousAnomalyAuditor />
            </section>
          </TabsContent>

          <TabsContent value="investigation" className="space-y-6">
            <section>
              <CrossCallsignTracker />
            </section>
            <section>
              <TaxonomyBridgePanel />
            </section>
            <section>
              <ForensicTrajectoryPanel />
            </section>
            <section>
              <DirectAircraftCorrelation />
            </section>
            <section>
              <NullIcaoForensicPanel />
            </section>
          </TabsContent>

          <TabsContent value="live" className="space-y-6">
            <section className="space-y-6">
              <AircraftMapVisualization />
              <LiveFlightTracker />
            </section>
            <section>
              <AircraftAlertSystem />
            </section>
          </TabsContent>

          <TabsContent value="watchtower" className="space-y-6">
            <section>
              <AutonomousWatchtower />
            </section>
            <section>
              <UnmaskHQSystem />
            </section>
            <section>
              <BiometricBattleMap />
            </section>
          </TabsContent>

          <TabsContent value="patterns" className="space-y-6">
            <section className="space-y-6">
              <HammerAnvilPatternPanel />
              <HighLowOperationsPanel />
              <FlightSaturationAnalyzer />
            </section>
            <section className="space-y-6">
              <DeepPatternAnalyzer />
              <PatternCoordinationAnalysis />
              <InfrastructureCorrelation />
            </section>
          </TabsContent>

          <TabsContent value="monitoring" className="space-y-6">
            <section>
              <SpoofDetectionPanel />
            </section>
            <section>
              <DroneInvestigationPanel />
            </section>
            <section>
              <ADSBSpoofingDetector />
            </section>
            <section className="space-y-6">
              <ADSBSpoofingAudit />
              <AlaskaAirlinesDashboard />
            </section>
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <MilitaryAircraftPanel />
              <CanadianMilitaryTracker />
            </section>
          </TabsContent>

          <TabsContent value="intake" className="space-y-6">
            <section>
              <FAARegistryUploader />
            </section>
            <section className="space-y-6">
              <FleetTrackingLedger />
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <OperatorEnrichmentPanel />
                <F24RadarUploader />
              </div>
              <FlightDataScraper />
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
