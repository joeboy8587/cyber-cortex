import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertOctagon } from "lucide-react";

interface Props {
  altitudeFt: number;
  citation?: string;
  description?: string;
  className?: string;
}

/**
 * FARBadge — visual indicator that a detection is below 1000 ft AGL and cites
 * the specific Federal Aviation Regulation broken. Any altitude < 1000 ft is
 * treated as CRITICAL per project doctrine.
 */
export function FARBadge({ altitudeFt, citation, description, className }: Props) {
  if (altitudeFt == null || !isFinite(altitudeFt) || altitudeFt >= 1000) return null;

  const severity = altitudeFt < 500 ? "critical" : "high";
  const label = citation || (altitudeFt < 500 ? "14 CFR 91.119(c)" : "14 CFR 91.119(b)");
  const tip = description
    || (altitudeFt < 500
      ? `Below 500 ft AGL — 14 CFR 91.119(c) minimum altitude violation. Recorded altitude: ${altitudeFt} ft`
      : `Below 1000 ft AGL over congested area — 14 CFR 91.119(b). Recorded altitude: ${altitudeFt} ft`);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={severity === "critical" ? "destructive" : "default"}
            className={`gap-1 font-mono text-[10px] uppercase ${severity === "critical" ? "animate-pulse" : ""} ${className || ""}`}
          >
            <AlertOctagon className="h-3 w-3" />
            {label} · {altitudeFt}ft
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          <div className="font-semibold mb-1">FAR Violation — {severity.toUpperCase()}</div>
          <div>{tip}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
