import { useNavigate, useLocation } from "react-router-dom";
import { 
  Eye, 
  Radar, 
  Heart, 
  Scale, 
  Shield, 
  Brain, 
  Database, 
  BookOpen,
  LogOut,
  AlertTriangle,
  Radio,
  PlayCircle,
  GraduationCap,
  MapPin,
  Network,
  Ghost,
  FolderOpen,
  ScanEye,
  Fingerprint,
  HeartPulse,
  Fuel
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigationItems = [
  { 
    title: "Mission Control", 
    url: "/", 
    icon: Eye,
    description: "Overview & Alerts"
  },
  { 
    title: "Airspace Enterprise", 
    url: "/surveillance", 
    icon: Radar,
    description: "Population-Scale Flight Tracking"
  },
  { 
    title: "Biometrics", 
    url: "/biometrics", 
    icon: Heart,
    description: "Health Monitoring"
  },
  { 
    title: "Legal", 
    url: "/legal", 
    icon: Scale,
    description: "Evidence & Filings"
  },
  { 
    title: "KCSO", 
    url: "/kcso", 
    icon: Shield,
    description: "Government Actor Investigation"
  },
  { 
    title: "Josiah AI", 
    url: "/josiah", 
    icon: Brain,
    description: "AI Witness System"
  },
  { 
    title: "Data Tools", 
    url: "/data", 
    icon: Database,
    description: "Database & Quality"
  },
  { 
    title: "Oildale Ops", 
    url: "/oildale", 
    icon: MapPin,
    description: "Oildale/BFL Grid"
  },
  { 
    title: "Tulare County", 
    url: "/tulare", 
    icon: Radio,
    description: "Expanded Airspace"
  },
  { 
    title: "Knowledge Engine", 
    url: "/knowledge", 
    icon: Network,
    description: "Schema Discovery"
  },
  { 
    title: "Drone Detection", 
    url: "/drones", 
    icon: Ghost,
    description: "RF & Drone Intel"
  },
  { 
    title: "Case Files", 
    url: "/case-files", 
    icon: FolderOpen,
    description: "Universe → Exhibits"
  },
  { 
    title: "Universal Analyst", 
    url: "/analyst", 
    icon: ScanEye,
    description: "Equal Analysis Engine"
  },
  { 
    title: "Entity Resolution", 
    url: "/entities", 
    icon: Fingerprint,
    description: "Canonical Index → Exhibits"
  },
  {
    title: "Data Health",
    url: "/data-health",
    icon: HeartPulse,
    description: "Neon Inventory & Pipeline Coverage"
  },
  {
    title: "Tanker Network",
    url: "/tanker-network",
    icon: Fuel,
    description: "KC-135/46/10 → Receivers Graph"
  },
  {
    title: "Network Intel",
    url: "/network-intel",
    icon: Network,
    description: "Profiles · Graph · Repeat Offenders"
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarContent className="bg-card/50">
        {/* Header with Logo */}
        <div className={cn(
          "flex items-center gap-3 p-4 border-b border-border",
          collapsed && "justify-center"
        )}>
          <div className="relative">
            <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
              <Eye className="w-5 h-5 text-primary" />
            </div>
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="font-display text-sm uppercase tracking-[0.2em] text-primary">
                Watchtower
              </h1>
              <p className="font-mono text-[10px] text-muted-foreground">
                v3.0 // COMMAND
              </p>
            </div>
          )}
        </div>

        {/* Status Indicators */}
        {!collapsed && (
          <div className="px-4 py-3 border-b border-border space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Shield className="w-3 h-3 text-success" />
              <span className="text-muted-foreground">Integrity:</span>
              <span className="text-success font-mono">VERIFIED</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Radio className="w-3 h-3 text-success" />
              <span className="text-muted-foreground">ADS-B:</span>
              <span className="text-success font-mono">ACTIVE</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <AlertTriangle className="w-3 h-3 text-destructive animate-pulse" />
              <span className="text-muted-foreground">Threat:</span>
              <span className="text-destructive font-mono">CRITICAL</span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider">
              Navigation
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => {
                const isActive = location.pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink 
                        to={item.url} 
                        end={item.url === "/"} 
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                          "hover:bg-muted/50",
                          collapsed && "justify-center px-2"
                        )}
                        activeClassName="bg-primary/10 text-primary border border-primary/30"
                      >
                        <item.icon className={cn(
                          "w-4 h-4 shrink-0",
                          isActive && "text-primary"
                        )} />
                        {!collapsed && (
                          <div className="flex flex-col min-w-0">
                            <span className={cn(
                              "text-sm font-medium truncate",
                              isActive && "text-primary"
                            )}>
                              {item.title}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate">
                              {item.description}
                            </span>
                          </div>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Reports */}
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-xs text-muted-foreground uppercase tracking-wider">
              Reports
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink 
                    to="/stories" 
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                      "hover:bg-muted/50",
                      collapsed && "justify-center px-2"
                    )}
                    activeClassName="bg-primary/10 text-primary border border-primary/30"
                  >
                    <BookOpen className="w-4 h-4 shrink-0" />
                    {!collapsed && (
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium">Stories</span>
                        <span className="text-[10px] text-muted-foreground">Daily Reports</span>
                      </div>
                    )}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink 
                    to="/simulation" 
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                      "hover:bg-muted/50",
                      collapsed && "justify-center px-2"
                    )}
                    activeClassName="bg-primary/10 text-primary border border-primary/30"
                  >
                    <PlayCircle className="w-4 h-4 shrink-0" />
                    {!collapsed && (
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium">Simulation</span>
                        <span className="text-[10px] text-muted-foreground">Incident Playback</span>
                      </div>
                    )}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink 
                    to="/academy" 
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                      "hover:bg-muted/50",
                      collapsed && "justify-center px-2"
                    )}
                    activeClassName="bg-primary/10 text-primary border border-primary/30"
                  >
                    <GraduationCap className="w-4 h-4 shrink-0" />
                    {!collapsed && (
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium">Legal Academy</span>
                        <span className="text-[10px] text-muted-foreground">Pro Se Training</span>
                      </div>
                    )}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer with Sign Out */}
      <SidebarFooter className="border-t border-border bg-card/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className={cn(
            "w-full gap-2 font-mono text-xs text-muted-foreground hover:text-destructive",
            collapsed && "px-2"
          )}
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && "Sign Out"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
