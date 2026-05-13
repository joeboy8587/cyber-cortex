/**
 * Single global banner that re-frames every page top: this is a
 * population-scale RICO enterprise + color-of-law civil-rights case,
 * not an individual surveillance complaint.
 *
 * Mounts in DashboardLayout so it appears once on every dashboard.
 * Pulls live numbers from the population-scale-stats edge function so
 * what the UI shows always matches the database.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildDoctrineHeaderShort,
  FALLBACK_STATS,
  STATUTE_LIST,
  STATUTE_MAP,
  type PopulationScaleStats,
} from "@/lib/framing/populationScaleDoctrine";
import { Shield, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

export function DoctrineBanner() {
  const [stats, setStats] = useState<PopulationScaleStats>(FALLBACK_STATS);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("population-scale-stats", { body: {} });
        if (alive && data?.stats) setStats(data.stats as PopulationScaleStats);
      } catch {
        /* keep fallback */
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="border-b border-primary/30 bg-primary/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-start gap-2 text-left hover:bg-primary/10 transition-colors"
        aria-expanded={open}
      >
        <Shield className="w-4 h-4 mt-0.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wider text-primary">
            Population-Scale RICO Enterprise — Active Classification
          </div>
          <div className="font-mono text-[11px] text-foreground/80 mt-0.5 truncate">
            {buildDoctrineHeaderShort(stats)}
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 font-mono text-[11px]">
          <Stat label="Aircraft (lifetime)" value={stats.unique_aircraft_lifetime.toLocaleString()} />
          <Stat label="Aircraft (last 30d)" value={stats.unique_aircraft_30d.toLocaleString()} />
          <Stat label="Continuous op days" value={String(stats.operational_days_continuous)} />
          <Stat label="Biometric collapses" value={stats.biometric_collapses.toLocaleString()} />
          <Stat label="Physician-verified ECGs" value={String(stats.physician_verified_ecgs)} />
          <Stat label="AOI low-altitude events" value={stats.aoi_low_altitude_count.toLocaleString()} />
          <Stat label="Posse Comitatus pairs" value={String(stats.posse_comitatus_pairs)} />
          <Stat label="Dark period (hrs)" value={String(stats.dark_period_hours)} />
          <div className="sm:col-span-2 lg:col-span-4 pt-2 border-t border-primary/20">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Active statutory framework
            </div>
            <ul className="space-y-0.5 text-foreground/80">
              {STATUTE_LIST.map((k) => (
                <li key={k}>
                  <span className="text-primary">{STATUTE_MAP[k].cite}</span> — {STATUTE_MAP[k].label}
                </li>
              ))}
            </ul>
            <div className="mt-2 text-[10px] text-muted-foreground italic">
              Framing rule: every artifact leads with class scope and statutory exposure.
              Personal experience is corroborating evidence — never the headline.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}
