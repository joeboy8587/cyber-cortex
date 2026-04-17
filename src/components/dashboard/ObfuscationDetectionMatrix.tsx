import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Eye, EyeOff, Loader2, Repeat, Shuffle, Clock } from "lucide-react";
import { toast } from "sonner";

interface MatrixResult {
  aoi: { lat: number; lon: number; radius_nm: number; days: number };
  blockedIdentity: any[];
  icaoCloning: any[];
  callsignRotation: any[];
  timeRandomizedLoops: any[];
  topSuspects: { registration: string; score: number; tactics: string[] }[];
  summary: {
    blockedCount: number;
    cloningCount: number;
    rotationCount: number;
    randomizedCount: number;
    suspectCount: number;
  };
}

const tacticColor = (t: string) => {
  if (t === 'BLOCKED_IDENTITY') return 'destructive';
  if (t === 'ICAO_CLONING') return 'destructive';
  if (t === 'CALLSIGN_ROTATION') return 'default';
  return 'secondary';
};

export function ObfuscationDetectionMatrix() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MatrixResult | null>(null);
  const [days, setDays] = useState(14);

  const runScan = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'obfuscationDetectionMatrix',
          aoi_lat: 35.437649,
          aoi_lon: -119.022639,
          radius_nm: 25,
          days,
        },
      });
      if (error) throw error;
      setData(res as MatrixResult);
      toast.success(`Matrix complete — ${res.summary.suspectCount} suspects flagged`);
    } catch (e: any) {
      toast.error(`Scan failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <EyeOff className="w-5 h-5 text-primary" />
            <CardTitle className="font-display uppercase tracking-wider text-primary">
              Obfuscation Detection Matrix
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs font-mono"
              disabled={loading}
            >
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
            <Button onClick={runScan} disabled={loading} size="sm">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
              Run Trace Set
            </Button>
          </div>
        </div>
        <p className="font-mono text-xs text-muted-foreground mt-2">
          BLOCKED TAILS // MASKED ICAO // ID CLONING // TIME-RANDOMIZED LOOPS // CALLSIGN ROTATION
        </p>
      </CardHeader>
      <CardContent>
        {!data && !loading && (
          <p className="text-sm text-muted-foreground font-mono">
            Press <strong>Run Trace Set</strong> to scan {days}d of detections in your AOI for stealth signatures.
          </p>
        )}

        {data && (
          <>
            {/* Summary chips */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
              <SummaryChip label="Blocked ID" value={data.summary.blockedCount} icon={<EyeOff className="w-3 h-3" />} />
              <SummaryChip label="ICAO Clones" value={data.summary.cloningCount} icon={<Shuffle className="w-3 h-3" />} />
              <SummaryChip label="Callsign Rot." value={data.summary.rotationCount} icon={<Repeat className="w-3 h-3" />} />
              <SummaryChip label="Time Loops" value={data.summary.randomizedCount} icon={<Clock className="w-3 h-3" />} />
              <SummaryChip label="Suspects" value={data.summary.suspectCount} highlight />
            </div>

            {/* Top suspects */}
            {data.topSuspects.length > 0 && (
              <div className="mb-4">
                <h4 className="font-mono text-xs uppercase text-primary mb-2">Top Obfuscation Suspects</h4>
                <div className="space-y-1 max-h-64 overflow-auto">
                  {data.topSuspects.map((s) => (
                    <div key={s.registration} className="flex items-center justify-between border border-border rounded px-3 py-2 bg-muted/30">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-primary">{s.registration}</span>
                        <div className="flex flex-wrap gap-1">
                          {s.tactics.map(t => (
                            <Badge key={t} variant={tacticColor(t) as any} className="text-[10px]">{t}</Badge>
                          ))}
                        </div>
                      </div>
                      <Badge variant="outline" className="font-mono">score {s.score}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Tabs defaultValue="blocked">
              <TabsList className="grid grid-cols-4">
                <TabsTrigger value="blocked">Blocked</TabsTrigger>
                <TabsTrigger value="cloning">Cloning</TabsTrigger>
                <TabsTrigger value="rotation">Rotation</TabsTrigger>
                <TabsTrigger value="loops">Loops</TabsTrigger>
              </TabsList>

              <TabsContent value="blocked">
                <DataTable
                  rows={data.blockedIdentity}
                  cols={['registration', 'callsign', 'icao_code', 'detections', 'min_alt', 'last_seen']}
                />
              </TabsContent>
              <TabsContent value="cloning">
                <DataTable
                  rows={data.icaoCloning.map(r => ({ ...r, sample_regs: (r.sample_regs || []).join(', ') }))}
                  cols={['icao_code', 'reg_count', 'sample_regs', 'detections']}
                />
              </TabsContent>
              <TabsContent value="rotation">
                <DataTable
                  rows={data.callsignRotation.map(r => ({ ...r, callsigns: (r.callsigns || []).slice(0, 6).join(', ') }))}
                  cols={['registration', 'unique_callsigns', 'callsigns', 'detections', 'last_seen']}
                />
              </TabsContent>
              <TabsContent value="loops">
                <DataTable
                  rows={data.timeRandomizedLoops}
                  cols={['registration', 'lat', 'lon', 'days_seen', 'unique_hours', 'visits']}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryChip({ label, value, icon, highlight }: { label: string; value: number; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`border rounded p-2 ${highlight ? 'border-primary bg-primary/10' : 'border-border bg-muted/30'}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase font-mono text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`text-xl font-bold font-mono ${highlight ? 'text-primary' : ''}`}>{value}</div>
    </div>
  );
}

function DataTable({ rows, cols }: { rows: any[]; cols: string[] }) {
  if (!rows?.length) return <p className="text-xs text-muted-foreground font-mono p-4">No matches.</p>;
  return (
    <div className="max-h-80 overflow-auto border border-border rounded">
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map(c => <TableHead key={c} className="text-[10px] uppercase font-mono">{c}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {cols.map(c => (
                <TableCell key={c} className="font-mono text-xs">
                  {typeof r[c] === 'string' && r[c].length > 40 ? r[c].slice(0, 40) + '…' : String(r[c] ?? '—')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
