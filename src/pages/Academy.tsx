import { DashboardLayout } from "@/components/DashboardLayout";
import { LegalAcademy } from "@/components/dashboard/LegalAcademy";

export default function Academy() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
            <span className="text-primary text-lg">🎓</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-primary">
              Watchtower Legal Academy
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              INTERACTIVE PRO SE INVESTIGATION PLATFORM
            </p>
          </div>
        </div>
        <LegalAcademy />
      </div>
    </DashboardLayout>
  );
}
