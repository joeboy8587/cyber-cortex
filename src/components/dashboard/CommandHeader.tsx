import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Radio, AlertTriangle, Eye, Mail, Scale, Database, Menu, X, LogOut, BookOpen, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: <Eye className="w-4 h-4" /> },
  { id: "outreach", label: "Outreach Hub", icon: <Mail className="w-4 h-4" /> },
  { id: "legal", label: "Legal Analysis", icon: <Scale className="w-4 h-4" /> },
  { id: "upload", label: "MD Upload", icon: <Upload className="w-4 h-4" /> },
  { id: "database", label: "Database", icon: <Database className="w-4 h-4" /> },
];

export function CommandHeader() {
  const [activeNav, setActiveNav] = useState("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { signOut, user } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const scrollToSection = (id: string) => {
    setActiveNav(id);
    setMobileMenuOpen(false);
    
    const sectionMap: Record<string, string> = {
      dashboard: "database-stats",
      outreach: "outreach-hub",
      legal: "legal-analysis",
      upload: "evidence-upload",
      database: "sql-console",
    };
    
    const elementId = sectionMap[id];
    const element = document.getElementById(elementId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container py-4">
        <div className="flex items-center justify-between">
          {/* Logo and Title */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
                <Eye className="w-6 h-6 text-primary" />
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-destructive animate-pulse" />
            </div>
            <div>
            <h1 className="font-display text-xl lg:text-2xl uppercase tracking-[0.3em] text-gradient-cyber">
                Watchtower
              </h1>
              <p className="font-mono text-xs text-muted-foreground">
                EVIDENCE CORRELATION SYSTEM v3.0 // ENTERPRISE ACTIVITY EXPOSURE
              </p>
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                size="sm"
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  "gap-2 font-mono text-xs uppercase tracking-wider",
                  activeNav === item.id 
                    ? "bg-primary/10 text-primary border border-primary/30" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </Button>
            ))}
          </nav>

          {/* Status indicators and actions */}
          <div className="hidden md:flex items-center gap-6">
            <StatusIndicator
              icon={<Shield className="w-4 h-4" />}
              label="Evidence Integrity"
              value="VERIFIED"
              status="success"
            />
            <StatusIndicator
              icon={<Radio className="w-4 h-4" />}
              label="ADS-B Feed"
              value="ACTIVE"
              status="success"
            />
            <StatusIndicator
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Threat Level"
              value="CRITICAL"
              status="critical"
            />
            
            {/* Stories link */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/stories")}
              className="gap-2 font-mono text-xs"
            >
              <BookOpen className="w-4 h-4" />
              Stories
            </Button>
            
            {/* Sign out button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="gap-2 font-mono text-xs text-muted-foreground hover:text-destructive"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </Button>
          </div>

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>

          {/* Date/Time */}
          <div className="hidden sm:block text-right">
            <p className="font-mono text-xs text-muted-foreground">
              {new Date().toLocaleDateString('en-US', { 
                weekday: 'short', 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric' 
              })}
            </p>
            <p className="font-display text-lg text-primary glow-cyan">
              {new Date().toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                hour12: false 
              })}
            </p>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <nav className="lg:hidden mt-4 pt-4 border-t border-border flex flex-wrap gap-2">
            {navItems.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                size="sm"
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  "gap-2 font-mono text-xs uppercase tracking-wider",
                  activeNav === item.id 
                    ? "bg-primary/10 text-primary border border-primary/30" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </Button>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}

function StatusIndicator({
  icon,
  label,
  value,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: "success" | "warning" | "critical";
}) {
  const statusStyles = {
    success: "text-success",
    warning: "text-warning",
    critical: "text-destructive animate-pulse",
  };

  return (
    <div className="flex items-center gap-2">
      <span className={statusStyles[status]}>{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("font-mono text-sm font-bold", statusStyles[status])}>
          {value}
        </p>
      </div>
    </div>
  );
}
