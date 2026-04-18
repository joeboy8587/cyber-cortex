import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Moon, AlertTriangle, RefreshCw, Building2, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Suspect {
  registration: string;
  total_detections: number;
  night_count: number;
  night_pct: number;
  active_days: number;
  unique_callsigns: number;
  avg_altitude: number | null;
  min_altitude: number | null;
  first_seen: string;
  last_seen: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
}

interface ShellMatch {
  registration: string;
  owner: string | null;
  city: string | null;
  state: string | null;
  manufacturer: string | null;
  model: string | null;
  owner_type: string | null;
  shell_flags: string[];
  is_likely_shell: boolean;
}

type SortKey = 'night_pct' | 'night_count' | 'total_detections' | 'active_days';

export function NightOpsDashboard() {
  const [loading, setLoading] = useState(false);
  const [unmasking, setUnmasking] = useState(false);
  const [suspects, setSuspects] = useState<Suspect[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [shells, setShells] = useState<ShellMatch[]>([]);
  const [shellSummary, setShellSummary] = useState<any>(null);
  const [sortKey, setSortKey] = useState<SortKey>('night_pct');
  const [days, setDays] = useState(30);
  const [threshold, setThreshold] = useState(25);

  const scan = async () => {
    setLoading(true);
    setShells([]);
    setShellSummary(null);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'nightOpsAnomalyScan', days, nightThresholdPct: threshold, minDetections: 20, limit: 100 },
      });
      if (error) throw error;
      setSuspects(data?.suspects || []);
      setSummary(data?.summary || null);
      toast.success(`${data?.suspects?.length || 0} suspects flagged`);
    } catch (e: any) {
      toast.error(`Scan failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const unmask = async () => {
    if (suspects.length === 0) { toast.error("Run scan first"); return; }
    setUnmasking(true);
    try {
      const top = suspects.slice(0, 50).map(s => s.registration);
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'shellOperatorUnmask', registrations: top },
      });
      if (error) throw error;
      setShells(data?.matches || []);
      setShellSummary(data?.summary || null);
      toast.success(`${data?.summary?.likely_shells || 0} likely shells unmasked`);
    } catch (e: any) {
      toast.error(`Unmask failed: ${e.message}`);
    } finally {
      setUnmasking(false);
    }
  };

  const sorted = [...suspects].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));

  const sevColor = (s: string) =>
    s === 'CRITICAL' ? 'destructive' : s === 'HIGH' ? 'default' : 'secondary';

  return (
    <CyberPanel title="Night Operations Anomaly Dashboard">
      <p className="-mt-2 mb-3 font-mono text-[10px] uppercase text-muted-foreground">Flags aircraft with &gt;25% night ops (UTC 22:00-05:59) — training cover indicator</p>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded border border-border/40 bg-background/40 p-3">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-muted-foreground">Window (days)</label>
            <select value={days} onChange={e => setDays(Number(e.target.value))} className="h-9 rounded border border-border bg-background px-2 font-mono text-xs">
              <option value={7}>7</option>
              <option value={30}>30</option>
              <option value={90}>90</option>
              <option value={365}>365</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-muted-foreground">Night Threshold %</label>
            <select value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="h-9 rounded border border-border bg-background px-2 font-mono text-xs">
              <option value={15}>15%</option>
              <option value={25}>25%</option>
              <option value={40}>40%</option>
              <option value={60}>60%</option>
            </select>
          </div>
          <Button onClick={scan} disabled={loading} size="sm" className="gap-2">
            {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Moon className="h-3 w-3" />}
            {loading ? "Scanning..." : "Run Night Ops Scan"}
          </Button>
          <Button onClick={unmask} disabled={unmasking || suspects.length === 0} size="sm" variant="secondary" className="gap-2">
            {unmasking ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Building2 className="h-3 w-3" />}
            Unmask Shell Operators
          </Button>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded border border-border/40 bg-background/40 p-3">
              <div className="font-mono text-[10px] uppercase text-muted-foreground">Total Suspects</div>
              <div className="font-display text-2xl text-primary">{summary.total_suspects}</div>
            </div>
            <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
              <div className="font-mono text-[10px] uppercase text-destructive">Critical (≥60%)</div>
              <div className="font-display text-2xl text-destructive">{summary.critical_count}</div>
            </div>
            <div className="rounded border border-chart-2/40 bg-chart-2/5 p-3">
              <div className="font-mono text-[10px] uppercase text-chart-2">High (≥40%)</div>
              <div className="font-display text-2xl text-chart-2">{summary.high_count}</div>
            </div>
            <div className="rounded border border-border/40 bg-background/40 p-3">
              <div className="font-mono text-[10px] uppercase text-muted-foreground">Medium</div>
              <div className="font-display text-2xl text-foreground">{summary.medium_count}</div>
            </div>
          </div>
        )}

        <Tabs value={shells.length > 0 ? "shells" : "suspects"}>
          <TabsList>
            <TabsTrigger value="suspects">Night Ops Suspects ({suspects.length})</TabsTrigger>
            <TabsTrigger value="shells" disabled={shells.length === 0}>Shell Owners ({shells.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="suspects" className="mt-4">
            {sorted.length === 0 ? (
              <div className="rounded border border-dashed border-border/50 p-6 text-center font-mono text-xs text-muted-foreground">
                No data yet — run a scan to flag night-active aircraft.
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-border/40">
                <table className="w-full font-mono text-xs">
                  <thead className="bg-muted/30 text-left uppercase text-[10px] text-muted-foreground">
                    <tr>
                      <th className="p-2">Reg</th>
                      <th className="cursor-pointer p-2" onClick={() => setSortKey('night_pct')}>Night %</th>
                      <th className="cursor-pointer p-2" onClick={() => setSortKey('night_count')}>Night Hits</th>
                      <th className="cursor-pointer p-2" onClick={() => setSortKey('total_detections')}>Total</th>
                      <th className="cursor-pointer p-2" onClick={() => setSortKey('active_days')}>Days Active</th>
                      <th className="p-2">Callsigns</th>
                      <th className="p-2">Avg Alt</th>
                      <th className="p-2">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr key={s.registration} className="border-t border-border/30 hover:bg-muted/20">
                        <td className="p-2 font-bold text-primary">{s.registration}</td>
                        <td className="p-2 font-bold">{s.night_pct}%</td>
                        <td className="p-2">{s.night_count}</td>
                        <td className="p-2 text-muted-foreground">{s.total_detections}</td>
                        <td className="p-2 text-muted-foreground">{s.active_days}</td>
                        <td className="p-2 text-muted-foreground">{s.unique_callsigns}</td>
                        <td className="p-2 text-muted-foreground">{s.avg_altitude ? `${s.avg_altitude}ft` : '—'}</td>
                        <td className="p-2"><Badge variant={sevColor(s.severity) as any}>{s.severity}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="shells" className="mt-4 space-y-3">
            {shellSummary && (
              <div className="rounded border border-chart-1/40 bg-chart-1/5 p-3 font-mono text-xs">
                <div className="flex items-center gap-2">
                  <Eye className="h-3 w-3 text-chart-1" />
                  <span className="text-chart-1">UNMASKED:</span>
                  <span>{shellSummary.matched}/{shellSummary.requested} matched in FAA registry,</span>
                  <span className="font-bold text-destructive">{shellSummary.likely_shells} flagged as likely shells</span>
                </div>
              </div>
            )}
            <div className="overflow-x-auto rounded border border-border/40">
              <table className="w-full font-mono text-xs">
                <thead className="bg-muted/30 text-left uppercase text-[10px] text-muted-foreground">
                  <tr>
                    <th className="p-2">Reg</th>
                    <th className="p-2">Owner</th>
                    <th className="p-2">City/State</th>
                    <th className="p-2">Aircraft</th>
                    <th className="p-2">Owner Type</th>
                    <th className="p-2">Shell Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {shells.map((m) => (
                    <tr key={m.registration} className={`border-t border-border/30 ${m.is_likely_shell ? 'bg-destructive/5' : ''}`}>
                      <td className="p-2 font-bold text-primary">{m.registration}</td>
                      <td className="p-2">{m.owner || <span className="text-muted-foreground">unknown</span>}</td>
                      <td className="p-2 text-muted-foreground">{[m.city, m.state].filter(Boolean).join(', ') || '—'}</td>
                      <td className="p-2 text-muted-foreground">{[m.manufacturer, m.model].filter(Boolean).join(' ') || '—'}</td>
                      <td className="p-2 text-muted-foreground">{m.owner_type || '—'}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {m.shell_flags.map((f, i) => (
                            <Badge key={i} variant={m.is_likely_shell ? "destructive" : "secondary"} className="text-[9px]">{f}</Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </CyberPanel>
  );
}

export default NightOpsDashboard;
