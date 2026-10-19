import { DashboardLayout } from "@/components/DashboardLayout";
import { SchemaDiscoveryDashboard } from "@/components/dashboard/SchemaDiscoveryDashboard";
import { UnstructuredIngestPanel } from "@/components/knowledge/UnstructuredIngestPanel";
import { RagPipelineHealth } from "@/components/knowledge/RagPipelineHealth";
import { TrainingReadinessPanel } from "@/components/knowledge/TrainingReadinessPanel";

export default function KnowledgeEngine() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        <TrainingReadinessPanel />
        <RagPipelineHealth />
        <UnstructuredIngestPanel />
        <SchemaDiscoveryDashboard />
      </div>
    </DashboardLayout>
  );
}
