import { DashboardLayout } from "@/components/DashboardLayout";
import { IncidentSimulator } from "@/components/dashboard/IncidentSimulator";
import { CoordinationForecastPanel } from "@/components/dashboard/CoordinationForecastPanel";
import { BehaviorFingerprintPanel } from "@/components/dashboard/BehaviorFingerprintPanel";

const Simulation = () => {
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <CoordinationForecastPanel />
        <BehaviorFingerprintPanel />
        <div className="h-[calc(100vh-4rem)]">
          <IncidentSimulator />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Simulation;
