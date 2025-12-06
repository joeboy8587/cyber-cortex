import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface CyberPanelProps {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  variant?: "default" | "threat" | "success" | "warning";
  headerActions?: ReactNode;
}

export function CyberPanel({
  title,
  icon,
  children,
  className,
  variant = "default",
  headerActions,
}: CyberPanelProps) {
  const variantStyles = {
    default: "border-border",
    threat: "border-destructive/50 neon-border-red",
    success: "border-success/50",
    warning: "border-warning/50",
  };

  const headerGradients = {
    default: "from-primary/10 to-transparent",
    threat: "from-destructive/20 to-transparent",
    success: "from-success/20 to-transparent",
    warning: "from-warning/20 to-transparent",
  };

  return (
    <div
      className={cn(
        "cyber-panel",
        variantStyles[variant],
        className
      )}
    >
      {title && (
        <div
          className={cn(
            "cyber-panel-header bg-gradient-to-r",
            headerGradients[variant]
          )}
        >
          {icon && <span className="text-primary">{icon}</span>}
          <span className="font-display text-sm uppercase tracking-widest text-primary">
            {title}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {headerActions}
          </div>
        </div>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
