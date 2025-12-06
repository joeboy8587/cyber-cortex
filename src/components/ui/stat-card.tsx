import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  variant?: "default" | "primary" | "destructive" | "warning" | "success";
  className?: string;
}

export function StatCard({
  label,
  value,
  icon,
  trend,
  trendValue,
  variant = "default",
  className,
}: StatCardProps) {
  const variantStyles = {
    default: {
      border: "border-border",
      glow: "",
      text: "text-foreground",
    },
    primary: {
      border: "border-primary/30",
      glow: "glow-cyan",
      text: "text-primary",
    },
    destructive: {
      border: "border-destructive/30",
      glow: "glow-red",
      text: "text-destructive",
    },
    warning: {
      border: "border-warning/30",
      glow: "",
      text: "text-warning",
    },
    success: {
      border: "border-success/30",
      glow: "glow-green",
      text: "text-success",
    },
  };

  const style = variantStyles[variant];

  return (
    <div
      className={cn(
        "cyber-panel p-4 hud-brackets",
        style.border,
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-ui text-xs uppercase tracking-wider text-muted-foreground mb-1">
            {label}
          </p>
          <p
            className={cn(
              "font-display text-2xl lg:text-3xl font-bold",
              style.text,
              style.glow
            )}
          >
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {trend && trendValue && (
            <div className="flex items-center gap-1 mt-2">
              <span
                className={cn(
                  "text-xs font-mono",
                  trend === "up" && "text-success",
                  trend === "down" && "text-destructive",
                  trend === "neutral" && "text-muted-foreground"
                )}
              >
                {trend === "up" && "▲"}
                {trend === "down" && "▼"}
                {trend === "neutral" && "●"}
                {" "}{trendValue}
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div className={cn("text-2xl", style.text, "opacity-50")}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
