import { DashboardLayout } from "@/components/DashboardLayout";
import { CaseOverview } from "@/components/case-files/CaseOverview";
import { ExhibitRegistry } from "@/components/case-files/ExhibitRegistry";
import { PromotionRulesPanel } from "@/components/case-files/PromotionRulesPanel";
import { AuditTrailViewer } from "@/components/case-files/AuditTrailViewer";
import { AutonomousCaseFileBuilder } from "@/components/case-files/AutonomousCaseFileBuilder";

export default function CaseFiles() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
            <span className="text-primary text-lg">⚖️</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-primary">
              Case Files
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              UNIVERSE → EXHIBITS // FORENSICALLY DEFENSIBLE // ANTI-CHERRY-PICK
            </p>
          </div>
        </div>

        <AutonomousCaseFileBuilder />
        <CaseOverview />
        <ExhibitRegistry />
        <PromotionRulesPanel />
        <AuditTrailViewer />
      </div>
    </DashboardLayout>
  );
}