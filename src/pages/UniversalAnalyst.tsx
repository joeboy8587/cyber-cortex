import { DashboardLayout } from "@/components/DashboardLayout";
import { UniversalAnalystDashboard } from "@/components/dashboard/UniversalAnalystDashboard";

export default function UniversalAnalyst() {
  return (
    <DashboardLayout>
      <div className="container py-6">
        <UniversalAnalystDashboard />
      </div>
    </DashboardLayout>
  );
}
