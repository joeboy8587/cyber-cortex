import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Ghost, Link2, Radio, AlertTriangle, CheckCircle2, Eye } from 'lucide-react';

const safeNum = (v: unknown) => Number(v || 0);

export default function TaxonomyBridgePanel() {
  const [stats, setStats] = useState<any>(null);
  const [ghosts, setGhosts] = useState<any[]>([]);
  const [bridgeResult, setBridgeResult] = useState<any>(null);
  const [loading, setLoading] = useState('');

  const callNeon = async (action: string, extra = {}) => {
    const { data, error } = await supabase.functions.invoke('neon-query', {
      body: { action, ...extra },
    });
    if (error) throw error;
    return data;
  };

  const loadStats = async () => {
    setLoading('stats');
    try {
      const result = await callNeon('getUnfilteredStats');
      if (result.error) throw new Error(result.error);
      setStats(result);
      toast.success('Unfiltered stats loaded');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading('');
    }
  };

  const loadGhosts = async () => {
    setLoading('ghosts');
    try {
      const result = await callNeon('getGhostAircraftReport');
      setGhosts(result.data || []);
      toast.success(`${(result.data || []).length} aircraft analyzed`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading('');
    }
  };

  const runBridge = async () => {
    setLoading('bridge');
    try {
      const result = await callNeon('bridgeTaxonomy');
      if (result.error) throw new Error(result.error);
      setBridgeResult(result);
      toast.success(`Bridge complete: ${safeNum(result.batch?.registrationMatched) + safeNum(result.batch?.icaoMatched) + safeNum(result.batch?.spatialMatched)} records tagged`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading('');
    }
  };

  const ghostStatusColor = (s: string) => {
    if (s === 'GHOST') return 'destructive';
    if (s === 'SEMI-GHOST') return 'secondary';
    if (s === 'MLAT-DEPENDENT') return 'outline';
    return 'default';
  };

  return (
    <Card className="border-amber-500/30 bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Link2 className="h-5 w-5 text-amber-400" />
          Taxonomy Bridge: Raw ↔ Enriched
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Cross-reference 7,610 raw ADS-B detections with 2.96M enriched records to unmask ghost aircraft
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList className="grid grid-cols-3 mb-4">
            <TabsTrigger value="overview">Pipeline Stats</TabsTrigger>
            <TabsTrigger value="ghosts">Ghost Report</TabsTrigger>
            <TabsTrigger value="bridge">Run Bridge</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Button onClick={loadStats} disabled={loading === 'stats'} variant="outline" size="sm">
              {loading === 'stats' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Radio className="h-4 w-4 mr-2" />}
              Load Raw Feed Stats
            </Button>

            {stats?.totals && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatBox label="Total Raw Records" value={safeNum(stats.totals.total).toLocaleString()} />
                <StatBox label="With Registration" value={safeNum(stats.totals.with_reg).toLocaleString()} />
                <StatBox label="With ICAO" value={safeNum(stats.totals.with_icao).toLocaleString()} />
                <StatBox label="With Coordinates" value={safeNum(stats.totals.with_coords).toLocaleString()} />
                <StatBox label="Earliest" value={stats.totals.earliest ? new Date(stats.totals.earliest).toLocaleDateString() : 'N/A'} />
                <StatBox label="Latest" value={stats.totals.latest ? new Date(stats.totals.latest).toLocaleDateString() : 'N/A'} />
              </div>
            )}

            {stats?.taxonomyDistribution && stats.taxonomyDistribution.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Taxonomy Coverage (Raw)</h4>
                <div className="space-y-1">
                  {stats.taxonomyDistribution.map((t: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{t.tag}</span>
                      <Badge variant="outline">{safeNum(t.count).toLocaleString()}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stats?.crossReference && stats.crossReference.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Cross-Reference: Raw vs Enriched</h4>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {stats.crossReference.map((r: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs border-b border-border/30 py-1">
                      <span className="font-mono text-foreground">{r.registration}</span>
                      <span className="text-muted-foreground">
                        Raw: {safeNum(r.raw_count)} | Enriched: {safeNum(r.enriched_count)}
                        {safeNum(r.enriched_count) > 0 && safeNum(r.raw_count) === 0 && (
                          <Ghost className="inline h-3 w-3 ml-1 text-destructive" />
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="ghosts" className="space-y-4">
            <div className="flex items-center gap-2">
              <Button onClick={loadGhosts} disabled={loading === 'ghosts'} variant="outline" size="sm">
                {loading === 'ghosts' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Ghost className="h-4 w-4 mr-2" />}
                Scan Ghost Aircraft
              </Button>
              <p className="text-xs text-muted-foreground">
                Finds flagged aircraft with no/minimal raw ADS-B presence — evidence of transponder manipulation
              </p>
            </div>

            {ghosts.length > 0 && (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                <div className="grid grid-cols-7 text-xs font-medium text-muted-foreground border-b border-border pb-1 sticky top-0 bg-card">
                  <span>Tail #</span><span>Status</span><span>Live</span><span>Raw</span><span>Synth ICAO</span><span>Avg Alt</span><span>Tag</span>
                </div>
                {ghosts.map((g, i) => (
                  <div key={i} className="grid grid-cols-7 text-xs py-1 border-b border-border/20 items-center">
                    <span className="font-mono font-medium text-foreground">{g.registration}</span>
                    <Badge variant={ghostStatusColor(g.ghost_status)} className="text-[10px] w-fit">{g.ghost_status}</Badge>
                    <span>{safeNum(g.live_count).toLocaleString()}</span>
                    <span className={safeNum(g.raw_count) === 0 ? 'text-destructive font-bold' : ''}>{safeNum(g.raw_count)}</span>
                    <span>{safeNum(g.synthetic_icao_count)}</span>
                    <span>{safeNum(g.avg_alt).toLocaleString()} ft</span>
                    <span className="truncate text-muted-foreground">{g.primary_tag}</span>
                  </div>
                ))}
              </div>
            )}

            {ghosts.length > 0 && (
              <div className="grid grid-cols-4 gap-2 text-center">
                <StatBox label="GHOST" value={ghosts.filter(g => g.ghost_status === 'GHOST').length.toString()} color="text-destructive" />
                <StatBox label="SEMI-GHOST" value={ghosts.filter(g => g.ghost_status === 'SEMI-GHOST').length.toString()} color="text-amber-400" />
                <StatBox label="MLAT-DEP" value={ghosts.filter(g => g.ghost_status === 'MLAT-DEPENDENT').length.toString()} color="text-blue-400" />
                <StatBox label="VERIFIED" value={ghosts.filter(g => g.ghost_status === 'VERIFIED').length.toString()} color="text-green-400" />
              </div>
            )}
          </TabsContent>

          <TabsContent value="bridge" className="space-y-4">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-medium">Taxonomy Injector — 4-Phase Match</p>
                  <p className="text-muted-foreground">
                    <strong>Phase 0:</strong> Direct registration lookup (no temporal join)<br />
                    <strong>Phase 1:</strong> Registration + ±10min temporal window<br />
                    <strong>Phase 2:</strong> ICAO code + ±10min temporal window<br />
                    <strong>Phase 3:</strong> Spatial (±0.01°) + ±30sec temporal window
                  </p>
                  <p className="text-muted-foreground">Processes up to 5,000 records per batch. Run multiple times to cover all records.</p>
                </div>
              </div>
            </div>

            <Button onClick={runBridge} disabled={loading === 'bridge'} className="bg-amber-600 hover:bg-amber-700">
              {loading === 'bridge' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
              Execute Taxonomy Bridge
            </Button>

            {bridgeResult?.success && (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <StatBox label="Direct Match" value={safeNum(bridgeResult.batch.directMatched).toString()} color="text-amber-400" />
                  <StatBox label="Reg. Matched" value={safeNum(bridgeResult.batch.registrationMatched).toString()} color="text-green-400" />
                  <StatBox label="ICAO Matched" value={safeNum(bridgeResult.batch.icaoMatched).toString()} color="text-blue-400" />
                  <StatBox label="Spatial Matched" value={safeNum(bridgeResult.batch.spatialMatched).toString()} color="text-purple-400" />
                </div>
                {bridgeResult.overall && (
                  <div className="rounded bg-muted/30 p-2 text-xs space-y-1">
                    <div className="flex justify-between"><span>Total Records</span><span>{safeNum(bridgeResult.overall.total).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Tagged</span><span className="text-green-400">{safeNum(bridgeResult.overall.tagged).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Coverage</span>
                      <span>{safeNum(bridgeResult.overall.total) > 0
                        ? ((safeNum(bridgeResult.overall.tagged) / safeNum(bridgeResult.overall.total)) * 100).toFixed(1)
                        : 0}%</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground"><span>Elapsed</span><span>{safeNum(bridgeResult.elapsedMs)}ms</span></div>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <CheckCircle2 className="h-3 w-3" /> Bridge complete — run again to process remaining untagged records
                </div>
              </div>
            )}

            {bridgeResult?.error && (
              <div className="text-xs text-destructive">{bridgeResult.error}</div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded bg-muted/20 p-2">
      <div className={`text-lg font-bold ${color || 'text-foreground'}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
