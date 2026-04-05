import { DashboardLayout } from "@/components/DashboardLayout";
import { SchemaDiscoveryDashboard } from "@/components/dashboard/SchemaDiscoveryDashboard";

export default function KnowledgeEngine() {
  return (
    <DashboardLayout>
      <div className="container py-6">
        <SchemaDiscoveryDashboard />
      </div>
    </DashboardLayout>
  );
}
