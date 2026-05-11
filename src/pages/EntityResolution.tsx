import { DashboardLayout } from "@/components/DashboardLayout";
import { EntityIndexTable } from "@/components/entity-resolution/EntityIndexTable";
import { OperatorRescorePanel } from "@/components/entity-resolution/OperatorRescorePanel";
import { NetworkExtractsPanel } from "@/components/entity-resolution/NetworkExtractsPanel";

export default function EntityResolution() {
  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <header>
          <h1 className="text-2xl font-display uppercase tracking-[0.2em] text-primary">Entity Resolution</h1>
          <p className="text-sm text-muted-foreground">
            Canonical entity index across the forensic database. One-click promotion to Exhibits + Autonomous Flags.
          </p>
        </header>
        <OperatorRescorePanel />
        <EntityIndexTable />
      </div>
    </DashboardLayout>
  );
}
