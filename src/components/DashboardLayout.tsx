import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { RealtimeAlertBanner } from "@/components/dashboard/RealtimeAlertBanner";
import { DoctrineBanner } from "@/components/DoctrineBanner";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <SidebarProvider defaultOpen={false}>
      <div className="min-h-screen flex w-full bg-background overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-12 flex items-center border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40 px-3 gap-3">
            <SidebarTrigger className="shrink-0" />
            <div className="flex items-center justify-between w-full min-w-0">
              <span className="font-mono text-xs text-muted-foreground truncate">
                {new Date().toLocaleDateString('en-US', { 
                  weekday: 'short', 
                  year: 'numeric', 
                  month: 'short', 
                  day: 'numeric' 
                })}
              </span>
              <span className="font-mono text-xs text-primary shrink-0 ml-2">
                WATCHTOWER v3.0
              </span>
            </div>
          </header>
          <DoctrineBanner />
          <RealtimeAlertBanner />
          <main className="flex-1 overflow-auto">
            <div className="w-full max-w-full">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
