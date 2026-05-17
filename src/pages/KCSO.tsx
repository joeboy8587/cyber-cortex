import { DashboardLayout } from "@/components/DashboardLayout";
import { KCSODeepDiveReport } from "@/components/dashboard/KCSODeepDiveReport";
import { KCSOEnterpriseReport } from "@/components/dashboard/KCSOEnterpriseReport";
import { KCSOFleetRegistry } from "@/components/dashboard/KCSOFleetRegistry";
import { KCSOBudgetTimeline } from "@/components/dashboard/KCSOBudgetTimeline";
import { KCSOFleetCrossRef } from "@/components/dashboard/KCSOFleetCrossRef";
import { KCSOEvidenceMatrix } from "@/components/dashboard/KCSOEvidenceMatrix";
import { ShellCompanyMatrix } from "@/components/dashboard/ShellCompanyMatrix";
import { ShellBehavioralAlignment } from "@/components/dashboard/ShellBehavioralAlignment";
import { ShellCompanyInvestigator } from "@/components/dashboard/ShellCompanyInvestigator";
import { CriminalEnterpriseNetwork } from "@/components/dashboard/CriminalEnterpriseNetwork";
import { EnterpriseProfiles } from "@/components/dashboard/EnterpriseProfiles";
import { MilitaryGovBehavioralAlignment } from "@/components/dashboard/MilitaryGovBehavioralAlignment";
import { XXBInvestigator } from "@/components/dashboard/XXBInvestigator";
import { XXBEvidenceDashboard } from "@/components/dashboard/XXBEvidenceDashboard";
import { XXBTaxonomyPanel } from "@/components/dashboard/XXBTaxonomyPanel";
import { SchemaIntegrityPanel } from "@/components/dashboard/SchemaIntegrityPanel";

export default function KCSO() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* Page Header */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
            <span className="text-orange-500 text-lg">🛡️</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-orange-500">
              KCSO Investigation Hub
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              KERN COUNTY SHERIFF // ENTERPRISE ANALYSIS // SHELL COMPANIES
            </p>
          </div>
        </div>

        {/* Schema Integrity — Josiah 2026-05-16 audit */}
        <section>
          <SchemaIntegrityPanel />
        </section>

        {/* Evidence Matrix */}
        <section>
          <KCSOEvidenceMatrix />
        </section>

        {/* Deep Dive Reports */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <KCSODeepDiveReport />
          <KCSOEnterpriseReport />
        </section>

        {/* Fleet Analysis */}
        <section className="space-y-6">
          <KCSOFleetRegistry />
          <KCSOFleetCrossRef />
        </section>

        {/* Budget Timeline */}
        <section>
          <KCSOBudgetTimeline />
        </section>

        {/* Shell Company Investigation */}
        <section className="space-y-6">
          <ShellCompanyMatrix />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ShellCompanyInvestigator />
            <ShellBehavioralAlignment />
          </div>
        </section>

        {/* Criminal Enterprise Network */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <CriminalEnterpriseNetwork />
          <EnterpriseProfiles />
        </section>

        {/* Military/Gov Alignment */}
        <section>
          <MilitaryGovBehavioralAlignment />
        </section>

        {/* XXB Investigation */}
        <section className="space-y-6">
          <XXBInvestigator />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <XXBEvidenceDashboard />
            <XXBTaxonomyPanel />
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
