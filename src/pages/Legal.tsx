import { DashboardLayout } from "@/components/DashboardLayout";
import { LegalEvidenceDashboard } from "@/components/dashboard/LegalEvidenceDashboard";
import { TROEvidenceCompiler } from "@/components/dashboard/TROEvidenceCompiler";
import { ADALegalExportPackage } from "@/components/dashboard/ADALegalExportPackage";
import { LegalNarrativeGenerator } from "@/components/dashboard/LegalNarrativeGenerator";
import { FalseClaimsActCompiler } from "@/components/dashboard/FalseClaimsActCompiler";
import GenevaConventionAnalysis from "@/components/dashboard/GenevaConventionAnalysis";
import { LegalBriefDashboard } from "@/components/dashboard/LegalBriefDashboard";
import TROMotionGenerator from "@/components/dashboard/TROMotionGenerator";
import FAAComplaintBuilder from "@/components/dashboard/FAAComplaintBuilder";
import PreservationDemandSystem from "@/components/dashboard/PreservationDemandSystem";
import DamagesCalculator from "@/components/dashboard/DamagesCalculator";
import { FCACaseBuilder } from "@/components/dashboard/FCACaseBuilder";
import { LegalAnalysisAI } from "@/components/dashboard/LegalAnalysisAI";
import { LegalIntakeStrategy } from "@/components/dashboard/LegalIntakeStrategy";
import { LegalEvidenceMap } from "@/components/dashboard/LegalEvidenceMap";
import { LegalExhibitGenerator } from "@/components/dashboard/LegalExhibitGenerator";
import { LegalIntelUploader } from "@/components/dashboard/LegalIntelUploader";
import { RICOEnterpriseVisualization } from "@/components/dashboard/RICOEnterpriseVisualization";
import { EntityNetworkDiagram } from "@/components/dashboard/EntityNetworkDiagram";
import { EnterpriseNetworkGraph } from "@/components/dashboard/EnterpriseNetworkGraph";
import { PlainLanguageSummary } from "@/components/dashboard/PlainLanguageSummary";
import { ConsentDocumentation } from "@/components/dashboard/ConsentDocumentation";

export default function Legal() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* Page Header */}
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-warning/10 border border-warning/30 flex items-center justify-center">
            <span className="text-warning text-lg">⚖️</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-warning">
              Legal Evidence Hub
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              LEGAL FILINGS // EVIDENCE PACKAGES // PROSECUTION MATERIALS
            </p>
          </div>
        </div>

        {/* Main Evidence Dashboard */}
        <section>
          <LegalEvidenceDashboard />
        </section>

        {/* Export Packages */}
        <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <ADALegalExportPackage />
          <LegalExhibitGenerator />
          <EntityNetworkDiagram />
        </section>

        {/* TRO & Injunction */}
        <section className="space-y-6">
          <TROEvidenceCompiler />
          <TROMotionGenerator />
        </section>

        {/* Legal Narrative */}
        <section className="space-y-6">
          <LegalNarrativeGenerator />
          <LegalIntakeStrategy />
          <PlainLanguageSummary />
        </section>

        {/* Federal Filings */}
        <section className="space-y-6">
          <FalseClaimsActCompiler />
          <FCACaseBuilder />
          <GenevaConventionAnalysis />
        </section>

        {/* Damages & Complaints */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <DamagesCalculator />
          <FAAComplaintBuilder />
        </section>

        {/* Preservation & Briefs */}
        <section className="space-y-6">
          <PreservationDemandSystem />
          <LegalBriefDashboard />
        </section>

        {/* Enterprise Network */}
        <section className="space-y-6">
          <RICOEnterpriseVisualization />
          <EnterpriseNetworkGraph />
        </section>

        {/* Evidence Map */}
        <section>
          <LegalEvidenceMap />
        </section>

        {/* AI Analysis */}
        <section>
          <LegalAnalysisAI />
        </section>

        {/* Upload & Documentation */}
        <section className="space-y-6">
          <LegalIntelUploader />
          <ConsentDocumentation />
        </section>
      </div>
    </DashboardLayout>
  );
}
