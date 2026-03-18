import { DashboardLayout } from "@/components/DashboardLayout";
import { TableExplorer } from "@/components/dashboard/TableExplorer";
import { SqlConsole } from "@/components/dashboard/SqlConsole";
import { DatabaseStats } from "@/components/dashboard/DatabaseStats";
import { NeonTableCensus } from "@/components/dashboard/NeonTableCensus";
import DataQualityAudit from "@/components/dashboard/DataQualityAudit";
import { DatabaseQualityControl } from "@/components/dashboard/DatabaseQualityControl";

import { DataEnrichmentDashboard } from "@/components/dashboard/DataEnrichmentDashboard";
import { DataIntegrityPanel } from "@/components/dashboard/DataIntegrityPanel";
import { DataHardeningHub } from "@/components/dashboard/DataHardeningHub";
import { ForensicLinkageHub } from "@/components/dashboard/ForensicLinkageHub";
import { DatabaseCoverageDashboard } from "@/components/dashboard/DatabaseCoverageDashboard";
import { MaterializedViewsPanel } from "@/components/dashboard/MaterializedViewsPanel";
import { MultimodalEnrichmentPanel } from "@/components/dashboard/MultimodalEnrichmentPanel";
import { DataCoverageGuardrails } from "@/components/dashboard/DataCoverageGuardrails";
import { DataGapFiller } from "@/components/dashboard/DataGapFiller";
import { HistoricalEnrichmentPanel } from "@/components/dashboard/HistoricalEnrichmentPanel";
import { ComprehensiveDataAudit } from "@/components/dashboard/ComprehensiveDataAudit";
import { ChainOfCustodyPanel } from "@/components/dashboard/ChainOfCustodyPanel";
import { MerkleChainPanel } from "@/components/dashboard/MerkleChainPanel";
import { DBHealthMonitor } from "@/components/dashboard/DBHealthMonitor";
import FlaggedAircraftImporter from "@/components/dashboard/FlaggedAircraftImporter";

export default function DataTools() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* Page Header */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
            <span className="text-primary text-lg">🗄️</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-primary">
              Data Tools Hub
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              DATABASE MANAGEMENT // QUALITY CONTROL // FORENSIC LINKAGE
            </p>
          </div>
        </div>

        {/* Live DB Health Monitor - top priority */}
        <section>
          <DBHealthMonitor />
        </section>

        {/* Comprehensive Data Audit */}
        <section>
          <ComprehensiveDataAudit />
        </section>

        {/* Forensic Linkage Hub */}
        <section>
          <ForensicLinkageHub />
        </section>

        {/* Database Coverage */}
        <section>
          <DatabaseCoverageDashboard />
        </section>

        {/* Table Census & Stats */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <NeonTableCensus />
          <DatabaseStats />
        </section>

        {/* SQL Console */}
        <section>
          <SqlConsole />
        </section>

        {/* Table Explorer */}
        <section>
          <TableExplorer />
        </section>

        {/* Data Quality */}
        <section className="space-y-6">
          <DataQualityAudit />
          <DatabaseQualityControl />
        </section>

        {/* Data Hardening & Chain of Custody */}
        <section className="space-y-6">
          <DataHardeningHub />
          <DataIntegrityPanel />
          <ChainOfCustodyPanel />
          <MerkleChainPanel />
        </section>


        {/* Enrichment */}
        <section className="space-y-6">
          <DataEnrichmentDashboard />
          <MultimodalEnrichmentPanel />
          <HistoricalEnrichmentPanel />
        </section>

        {/* Coverage Guardrails */}
        <section className="space-y-6">
          <DataCoverageGuardrails />
          <DataGapFiller />
        </section>

        {/* Materialized Views */}
        <section>
          <MaterializedViewsPanel />
        </section>
      </div>
    </DashboardLayout>
  );
}
