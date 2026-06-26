import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface Props { icao?: string; callsign?: string }

/** Inline badge shown beside any Sentinel flag whose ICAO/callsign has an open KCSO policy violation. */
export function PolicyBadge({ icao, callsign }: Props) {
  const [violation, setViolation] = useState<{ rule_code: string; rule_title: string; manual_section: string | null; severity: string } | null>(null);

  useEffect(() => {
    let active = true;
    const fetch = async () => {
      if (!icao && !callsign) return;
      let q = supabase
        .from("policy_violations")
        .select("rule_code, rule_title, manual_section, severity")
        .order("detected_at", { ascending: false })
        .limit(1);
      if (icao) q = q.eq("icao", icao);
      else if (callsign) q = q.eq("callsign", callsign);
      const { data } = await q;
      if (active && data && data[0]) setViolation(data[0] as any);
    };
    fetch();
    return () => { active = false; };
  }, [icao, callsign]);

  if (!violation) return null;
  const color =
    violation.severity === "critical" ? "bg-destructive text-destructive-foreground"
    : violation.severity === "high" ? "bg-orange-500/80 text-white"
    : "bg-yellow-500/70 text-black";

  return (
    <Badge
      className={`${color} text-[10px] font-mono ml-1`}
      title={`${violation.rule_title}${violation.manual_section ? " · " + violation.manual_section : ""}`}
    >
      POLICY VIOLATION: {violation.rule_code}
    </Badge>
  );
}
