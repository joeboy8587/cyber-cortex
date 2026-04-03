import { useState, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, RefreshCw, Plane, Heart, AlertTriangle, Database, ChevronLeft, ChevronRight, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useArchiveDatabase } from "@/hooks/useArchiveDatabase";
import { extractNeonData } from "@/lib/formatters";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

const modalityConfig: Record<string, { icon: typeof Plane; label: string; color: string }> = {
  flight: { icon: Plane, label: "Flight", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  biometric: { icon: Heart, label: "Biometric", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  biometric_collapse: { icon: AlertTriangle, label: "Bio Collapse", color: "bg-destructive/20 text-destructive border-destructive/30" },
  timeline: { icon: Database, label: "Timeline", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
};

const severityColors: Record<string, string> = {
  critical: "bg-destructive/20 text-destructive border-destructive/30",
  high: "bg-warning/20 text-warning border-warning/30",
  normal: "bg-muted text-muted-foreground border-border",
};

export function ChronologicalTimelineRebuilder() {
  const { getChronoTimelineRebuild, getChronoTimelineSummary, isLoading } = useArchiveDatabase();
  const [events, setEvents] = useState<any[]>([]);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [totalEstimate, setTotalEstimate] = useState(0);
  const [page, setPage] = useState(0);
  const [modality, setModality] = useState("all");
  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const pageSize = 100;

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getChronoTimelineRebuild({ page, pageSize, modality });
      const rows = extractNeonData(result?.data || result);
      setEvents(rows);
      setTotalEstimate(parseInt(String(result?.totalEstimate || '0')));
    } catch (e) {
      console.error("Timeline rebuild error:", e);
    } finally {
      setLoading(false);
    }
  }, [page, modality, getChronoTimelineRebuild]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const result = await getChronoTimelineSummary();
      const rows = extractNeonData(result?.data || result);
      // Pivot monthly data for chart
      const monthMap: Record<string, any> = {};
      rows.forEach((r: any) => {
        const key = r.month;
        if (!monthMap[key]) monthMap[key] = { month: key };
        monthMap[key][r.modality] = parseInt(r.event_count || '0');
      });
      setMonthlyData(Object.values(monthMap).sort((a: any, b: any) => a.month.localeCompare(b.month)));
    } catch (e) {
      console.error("Timeline summary error:", e);
    } finally {
      setSummaryLoading(false);
    }
  }, [getChronoTimelineSummary]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const formatTime = (ts: string) => {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return ts; }
  };

  return (
    <CyberPanel
      title="Chronological Timeline Rebuilder"
      icon={<Clock className="w-4 h-4" />}
      headerActions={
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { fetchEvents(); fetchSummary(); }} disabled={loading}>
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
        </Button>
      }
    >
      <Tabs defaultValue="timeline" className="p-4">
        <TabsList className="mb-4">
          <TabsTrigger value="timeline">
            <Clock className="w-3 h-3 mr-1" /> Timeline
          </TabsTrigger>
          <TabsTrigger value="monthly">
            <BarChart3 className="w-3 h-3 mr-1" /> Monthly Breakdown
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          {/* Filters */}
          <div className="flex items-center gap-3 mb-4">
            <Select value={modality} onValueChange={(v) => { setModality(v); setPage(0); }}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="All Modalities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modalities</SelectItem>
                <SelectItem value="flight">✈️ Flights Only</SelectItem>
                <SelectItem value="biometric">❤️ Biometrics Only</SelectItem>
                <SelectItem value="alert">⚠️ Alerts Only</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-xs">
              ~{totalEstimate.toLocaleString()} total events
            </Badge>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { label: "Flights", value: "3M+", color: "text-blue-400" },
              { label: "Biometrics", value: "122K+", color: "text-emerald-400" },
              { label: "Collapses", value: "112K+", color: "text-destructive" },
              { label: "Timeline", value: "109K+", color: "text-amber-400" },
            ].map(s => (
              <div key={s.label} className="bg-muted/30 rounded p-2 text-center">
                <div className={cn("text-sm font-bold font-mono", s.color)}>{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Event table */}
          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="w-6 h-6 mx-auto animate-spin text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">Rebuilding chronological timeline across all tables...</p>
            </div>
          ) : (
            <>
              <div className="max-h-[500px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Time (PST)</TableHead>
                      <TableHead className="text-xs">Modality</TableHead>
                      <TableHead className="text-xs">Entity</TableHead>
                      <TableHead className="text-xs">Summary</TableHead>
                      <TableHead className="text-xs">Severity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((ev, i) => {
                      const config = modalityConfig[ev.modality] || modalityConfig.timeline;
                      const Icon = config.icon;
                      const sevClass = severityColors[ev.severity] || severityColors.normal;
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs whitespace-nowrap">
                            {formatTime(ev.event_time)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-xs", config.color)}>
                              <Icon className="w-3 h-3 mr-1" />
                              {config.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[120px] truncate">
                            {ev.entity}
                          </TableCell>
                          <TableCell className="text-xs max-w-[250px] truncate">
                            {ev.summary}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-xs", sevClass)}>
                              {ev.severity}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {events.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">
                          No events found for this filter
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* Pagination */}
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-muted-foreground">
                  Page {page + 1} · Showing {events.length} events
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
                    <ChevronLeft className="w-3 h-3" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={events.length < pageSize}>
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="monthly">
          {summaryLoading ? (
            <div className="text-center py-8">
              <RefreshCw className="w-6 h-6 mx-auto animate-spin text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">Computing monthly breakdown...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Monthly event counts across all detection and biometric tables — covering {monthlyData.length} months of data
              </p>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(v) => {
                      try { return new Date(v).toLocaleDateString("en-US", { month: "short", year: "2-digit" }); }
                      catch { return v; }
                    }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(v) => {
                        try { return new Date(v).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
                        catch { return v; }
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="flight" name="Flights" fill="hsl(210, 80%, 55%)" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="biometric" name="Biometrics" fill="hsl(150, 60%, 50%)" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="biometric_collapse" name="Collapses" fill="hsl(0, 70%, 55%)" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="timeline" name="Timeline" fill="hsl(40, 80%, 55%)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly table */}
              <div className="max-h-[300px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Month</TableHead>
                      <TableHead className="text-xs text-right">Flights</TableHead>
                      <TableHead className="text-xs text-right">Biometrics</TableHead>
                      <TableHead className="text-xs text-right">Collapses</TableHead>
                      <TableHead className="text-xs text-right">Timeline</TableHead>
                      <TableHead className="text-xs text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyData.map((m: any, i: number) => {
                      const total = (m.flight || 0) + (m.biometric || 0) + (m.biometric_collapse || 0) + (m.timeline || 0);
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">
                            {(() => { try { return new Date(m.month).toLocaleDateString("en-US", { month: "long", year: "numeric" }); } catch { return m.month; } })()}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono text-blue-400">{(m.flight || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-emerald-400">{(m.biometric || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-destructive">{(m.biometric_collapse || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-amber-400">{(m.timeline || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-xs text-right font-mono font-bold">{total.toLocaleString()}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}
