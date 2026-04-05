import { DashboardLayout } from "@/components/DashboardLayout";
import TulareCountyDashboard from "@/components/dashboard/TulareCountyDashboard";

export default function Tulare() {
  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
            <span className="text-primary text-lg">🌾</span>
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-primary">
              Tulare County Operations
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              EXPANDED AIRSPACE ANALYSIS // TULARE COUNTY GRID // CROSS-COUNTY CORRELATION
            </p>
          </div>
        </div>
        <TulareCountyDashboard />
      </div>
    </DashboardLayout>
  );
}
