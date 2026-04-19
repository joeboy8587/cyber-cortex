import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Moon, RefreshCw, Building2, Eye, AlertTriangle, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Suspect {
  registration: string;
  total_detections: number;
  night_count: number;
  night_pct: number;
  active_days: number;
  unique_callsigns: number;
  callsigns_sample?: string;
  avg_altitude: number | null;
  min_altitude: number | null;
  max_altitude?: number | null;
  first_seen: string;
  last_seen: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  category: string;
  operator_hint: string | null;
  legitimacy: string;
  is_spoofing_flagged: boolean;
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

const LEGITIMACY_COLORS: Record<string, string> = {
  LIKELY_LEGITIMATE: 'bg-muted text-muted-foreground',
  INVESTIGATE: 'bg-chart-2/20 text-chart-2 border-chart-2/40',
  HIGH_PRIORITY: 'bg-destructive/20 text-destructive border-destructive/40',
  SPOOFING_FLAGGED: 'bg-destructive text-destructive-foreground',
};

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
  const [includeAirlines, setIncludeAirlines] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const scan = async () => {
    setLoading(true);
    setShells([]);
    setShellSummary(null);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'nightOpsAnomalyScan', days, nightThresholdPct: threshold, minDetections: 20, limit: 200, includeAirlines },
      });
      if (error) throw error;
      setSuspects(data?.suspects || []);
      setSummary(data?.summary || null);
      const filtered = data?.summary?.filtered_out_airlines || 0;
      toast.success(`${data?.suspects?.length || 0} suspects flagged${filtered > 0 ? ` (${filtered} airline ops hidden)` : ''}`);
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
      // Only unmask US N-numbers (skip foreign + airline fleet codes for higher signal)
      const top = suspects
        .filter(s => s.category !== 'COMMERCIAL_SCHEDULED' && s.category !== 'FOREIGN_CARRIER')
        .slice(0, 100)
        .map(s => s.registration);
      if (top.length === 0) { toast.error("No US registrations to unmask after filtering"); setUnmasking(false); return; }
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'shellOperatorUnmask', registrations: top },
      });
      if (error) throw error;
      setShells(data?.matches || []);
      setShellSummary(data?.summary || null);
      const breakdown = data?.summary?.unmatched_breakdown || {};
      const breakdownStr = Object.entries(breakdown).map(([k, v]) => `${k}:${v}`).join(' • ');
      toast.success(`${data?.summary?.matched || 0} matched / ${data?.summary?.likely_shells || 0} shells${breakdownStr ? ` • ${breakdownStr}` : ''}`);
    } catch (e: any) {
      toast.error(`Unmask failed: ${e.message}`);
    } finally {
      setUnmasking(false);
    }
  };

  const filtered = suspects.filter(s => categoryFilter === 'ALL' || s.category === categoryFilter);
  const sorted = [...filtered].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));

  const sevColor = (s: string) =>
    s === 'CRITICAL' ? 'destructive' : s === 'HIGH' ? 'default' : 'secondary';

  const categories = summary?.category_breakdown ? Object.keys(summary.category_breakdown) : [];

  return (
    <CyberPanel title="Night Operations Anomaly Dashboard">
      <p className="-mt-2 mb-3 font-mono text-[10px] uppercase text-muted-foreground">
        Flags aircraft with &gt;{threshold}% night ops (UTC 22:00-05:59) — classified by legitimacy + cross-checked vs spoofing registry
      </p>
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
          <div className="flex items-center gap-2 rounded border border-border/40 bg-background/60 px-3 py-2">
            <Switch checked={includeAirlines} onCheckedChange={setIncludeAirlines} id="airlines" />
            <label htmlFor="airlines" className="cursor-pointer font-mono text-[10px] uppercase text-muted-foreground">
              Show airline traffic
            </label>
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
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="rounded border border-border/40 bg-background/40 p-3">
                <div className="font-mono text-[10px] uppercase text-muted-foreground">Total Suspects</div>
                <div className="font-display text-2xl text-primary">{summary.total_suspects}</div>
                {summary.filtered_out_airlines > 0 && (
                  <div className="font-mono text-[9px] text-muted-foreground">+{summary.filtered_out_airlines} airlines hidden</div>
                )}
              </div>
              <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
                <div className="font-mono text-[10px] uppercase text-destructive">High Priority</div>
                <div className="font-display text-2xl text-destructive">{summary.high_priority_count || 0}</div>
                <div className="font-mono text-[9px] text-muted-foreground">low-alt domestic</div>
              </div>
              <div className="rounded border border-destructive/40 bg-destructive/10 p-3">
                <div className="flex items-center gap-1 font-mono text-[10px] uppercase text-destructive"><ShieldAlert className="h-3 w-3" />Spoofing Flagged</div>
                <div className="font-display text-2xl text-destructive">{summary.spoofing_flagged_count || 0}</div>
              </div>
              <div className="rounded border border-chart-2/40 bg-chart-2/5 p-3">
                <div className="font-mono text-[10px] uppercase text-chart-2">Critical (≥60%)</div>
                <div className="font-display text-2xl text-chart-2">{summary.critical_count}</div>
              </div>
              <div className="rounded border border-border/40 bg-background/40 p-3">
                <div className="font-mono text-[10px] uppercase text-muted-foreground">High / Medium</div>
                <div className="font-display text-2xl text-foreground">{summary.high_count} / {summary.medium_count}</div>
              </div>
            </div>

            {categories.length > 0 && (
              <div className="rounded border border-border/40 bg-background/40 p-3">
                <div className="mb-2 font-mono text-[10px] uppercase text-muted-foreground">Category Breakdown — click to filter</div>
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant={categoryFilter === 'ALL' ? 'default' : 'outline'}
                    className="cursor-pointer text-[10px]"
                    onClick={() => setCategoryFilter('ALL')}
                  >
                    ALL ({suspects.length})
                  </Badge>
                  {categories.map(cat => (
                    <Badge
                      key={cat}
                      variant={categoryFilter === cat ? 'default' : 'outline'}
                      className="cursor-pointer text-[10px]"
                      onClick={() => setCategoryFilter(cat)}
                    >
                      {cat} ({summary.category_breakdown[cat]})
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <Tabs value={shells.length > 0 ? "shells" : "suspects"}>
          <TabsList>
            <TabsTrigger value="suspects">Suspects ({sorted.length})</TabsTrigger>
            <TabsTrigger value="shells" disabled={shells.length === 0 && !shellSummary}>Unmask Results ({shells.length})</TabsTrigger>
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
                      <th className="p-2">Category / Operator</th>
                      <th className="p-2">Legitimacy</th>
                      <th className="cursor-pointer p-2" onClick={() => setSortKey('night_pct')}>Night %</th>
                      <th className="cursor-pointer p-2" onClick={() => setSortKey('night_count')}>Hits</th>
                      <th className="cursor-pointer p-2" onClick={() => setSortKey('total_detections')}>Total</th>
                      <th className="p-2">Callsigns</th>
                      <th className="p-2">Avg / Min Alt</th>
                      <th className="p-2">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr key={s.registration} className={`border-t border-border/30 hover:bg-muted/20 ${s.is_spoofing_flagged ? 'bg-destructive/10' : ''}`}>
                        <td className="p-2 font-bold text-primary">
                          {s.registration}
                          {s.is_spoofing_flagged && <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />}
                        </td>
                        <td className="p-2">
                          <div className="text-[10px] text-muted-foreground">{s.category}</div>
                          {s.operator_hint && <div className="text-[10px] font-bold">{s.operator_hint}</div>}
                        </td>
                        <td className="p-2">
                          <Badge className={`${LEGITIMACY_COLORS[s.legitimacy] || ''} text-[9px]`} variant="outline">
                            {s.legitimacy}
                          </Badge>
                        </td>
                        <td className="p-2 font-bold">{s.night_pct}%</td>
                        <td className="p-2">{s.night_count}</td>
                        <td className="p-2 text-muted-foreground">{s.total_detections}</td>
                        <td className="p-2 text-[10px] text-muted-foreground">{s.callsigns_sample || '—'}</td>
                        <td className="p-2 text-muted-foreground">
                          {s.avg_altitude ? `${s.avg_altitude}` : '—'}
                          {s.min_altitude ? ` / ${s.min_altitude}ft` : ''}
                        </td>
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
              <div className="space-y-2 rounded border border-chart-1/40 bg-chart-1/5 p-3 font-mono text-xs">
                <div className="flex items-center gap-2">
                  <Eye className="h-3 w-3 text-chart-1" />
                  <span className="text-chart-1">UNMASK RESULT:</span>
                  <span>{shellSummary.matched}/{shellSummary.requested} matched in FAA registry,</span>
                  <span className="font-bold text-destructive">{shellSummary.likely_shells} likely shells</span>
                </div>
                {shellSummary.hint && (
                  <div className="text-[10px] text-muted-foreground">{shellSummary.hint}</div>
                )}
                {shellSummary.unmatched_breakdown && Object.keys(shellSummary.unmatched_breakdown).length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {Object.entries(shellSummary.unmatched_breakdown).map(([k, v]: any) => (
                      <Badge key={k} variant="outline" className="text-[9px]">{k}: {v}</Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
            {shells.length > 0 && (
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
            )}
          </TabsContent>
        </Tabs>
      </div>
    </CyberPanel>
  );
}

export default NightOpsDashboard;
