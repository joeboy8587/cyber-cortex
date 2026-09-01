import { DashboardLayout } from "@/components/DashboardLayout";
import { SchemaDiscoveryDashboard } from "@/components/dashboard/SchemaDiscoveryDashboard";
import { UnstructuredIngestPanel } from "@/components/knowledge/UnstructuredIngestPanel";
import { RagPipelineHealth } from "@/components/knowledge/RagPipelineHealth";

export default function KnowledgeEngine() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        <RagPipelineHealth />
        <UnstructuredIngestPanel />
        <SchemaDiscoveryDashboard />
      </div>
    </DashboardLayout>
  );
}
