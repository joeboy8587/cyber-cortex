import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DroneRFTracker from "@/components/dashboard/DroneRFTracker";
import GhostToDroneEngine from "@/components/dashboard/GhostToDroneEngine";
import DenverLogisticsAnalyzer from "@/components/dashboard/DenverLogisticsAnalyzer";
import { Radio, Ghost, Plane } from "lucide-react";

export default function DroneDetection() {
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Drone Detection System</h1>
          <p className="text-sm text-muted-foreground">
            RF signature tracking, ghost-to-drone correlation, and logistics pipeline analysis
          </p>
        </div>

        <Tabs defaultValue="correlation" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="correlation" className="flex items-center gap-1 text-xs">
              <Ghost className="h-3.5 w-3.5" /> Ghost→Drone
            </TabsTrigger>
            <TabsTrigger value="rf" className="flex items-center gap-1 text-xs">
              <Radio className="h-3.5 w-3.5" /> RF Tracker
            </TabsTrigger>
            <TabsTrigger value="logistics" className="flex items-center gap-1 text-xs">
              <Plane className="h-3.5 w-3.5" /> Denver Pipeline
            </TabsTrigger>
          </TabsList>

          <TabsContent value="correlation">
            <GhostToDroneEngine />
          </TabsContent>
          <TabsContent value="rf">
            <DroneRFTracker />
          </TabsContent>
          <TabsContent value="logistics">
            <DenverLogisticsAnalyzer />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
