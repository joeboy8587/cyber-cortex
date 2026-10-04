import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RelationshipExplorer } from "@/components/dashboard/RelationshipExplorer";
import { SchemaFragmentationPanel } from "@/components/dashboard/SchemaFragmentationPanel";
import { ArchiveManifestDashboard } from "@/components/dashboard/ArchiveManifestDashboard";
import { TableExplorer } from "@/components/dashboard/TableExplorer";
import { SqlConsole } from "@/components/dashboard/SqlConsole";
import { DatabaseQualityControl } from "@/components/dashboard/DatabaseQualityControl";
import { ForensicLinkageHub } from "@/components/dashboard/ForensicLinkageHub";
import { MaterializedViewsPanel } from "@/components/dashboard/MaterializedViewsPanel";
import { DataGapFiller } from "@/components/dashboard/DataGapFiller";
import { ComprehensiveDataAudit } from "@/components/dashboard/ComprehensiveDataAudit";
import { DBHealthMonitor } from "@/components/dashboard/DBHealthMonitor";
import FlaggedAircraftImporter from "@/components/dashboard/FlaggedAircraftImporter";
import { NotionFullSyncPanel } from "@/components/dashboard/NotionFullSyncPanel";
import { ArchiveConsolidationPanel } from "@/components/dashboard/ArchiveConsolidationPanel";
import { ChronologicalTimelineRebuilder } from "@/components/dashboard/ChronologicalTimelineRebuilder";
import { ForensicDBInventory } from "@/components/dashboard/ForensicDBInventory";
import { XxbUnmaskPanel } from "@/components/dashboard/XxbUnmaskPanel";

// Tabs mount only their active content, so panels on hidden tabs run no queries.
export default function DataTools() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
            <span className="text-primary text-lg">🗄️</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-primary">Data Tools Hub</h1>
            <p className="font-mono text-xs text-muted-foreground">
              Health checks live on Data Health · Seals &amp; chain of custody live on Archive Integrity
            </p>
          </div>
        </div>

        <Tabs defaultValue="unmask">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="unmask">Unmasking &amp; Attribution</TabsTrigger>
            <TabsTrigger value="schema">Table Connections</TabsTrigger>
            <TabsTrigger value="quality">Data Quality</TabsTrigger>
            <TabsTrigger value="maint">Maintenance &amp; Imports</TabsTrigger>
          </TabsList>

          <TabsContent value="unmask" className="space-y-6">
            <XxbUnmaskPanel />
            <ForensicLinkageHub />
            <FlaggedAircraftImporter />
          </TabsContent>

          <TabsContent value="schema" className="space-y-6">
            <RelationshipExplorer />
            <ForensicDBInventory />
            <ArchiveManifestDashboard />
            <SchemaFragmentationPanel />
            <TableExplorer />
            <SqlConsole />
          </TabsContent>

          <TabsContent value="quality" className="space-y-6">
            <DBHealthMonitor />
            <ComprehensiveDataAudit />
            <DatabaseQualityControl />
          </TabsContent>

          <TabsContent value="maint" className="space-y-6">
            <ChronologicalTimelineRebuilder />
            <DataGapFiller />
            <ArchiveConsolidationPanel />
            <MaterializedViewsPanel />
            <NotionFullSyncPanel />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
