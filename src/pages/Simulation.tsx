import { DashboardLayout } from "@/components/DashboardLayout";
import { IncidentSimulator } from "@/components/dashboard/IncidentSimulator";
import { CoordinationForecastPanel } from "@/components/dashboard/CoordinationForecastPanel";

const Simulation = () => {
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <CoordinationForecastPanel />
        <div className="h-[calc(100vh-4rem)]">
          <IncidentSimulator />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Simulation;
