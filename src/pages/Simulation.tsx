import { DashboardLayout } from "@/components/DashboardLayout";
import { IncidentSimulator } from "@/components/dashboard/IncidentSimulator";

const Simulation = () => {
  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-4rem)]">
        <IncidentSimulator />
      </div>
    </DashboardLayout>
  );
};

export default Simulation;
