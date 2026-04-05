import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, GitBranch, Circle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  days: number;
  loading: boolean;
  setLoading: (v: boolean) => void;
}

export default function GapBreakSegmentation({ days, loading, setLoading }: Props) {
  const [data, setData] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'ghostAircraftForensics', step: 'gapBreakSegmentation', days, maxGapMinutes: 30 }
      });
      if (error) throw error;
      if (res?.error) throw new Error(res.error);
      setData(res);
      toast.success(`${res.summary?.totalSegments || 0} track segments identified`);
    } catch (e: any) {
      toast.error(e.message || 'Segmentation failed');
    } finally {
      setRunning(false);
      setLoading(false);
    }
  };

  const patternColors: Record<string, string> = {
    ORBIT: 'text-destructive',
    PATROL: 'text-chart-5',
    TRANSIT: 'text-primary',
    BLIP: 'text-muted-foreground',
  };

  const patternBadge: Record<string, 'destructive' | 'secondary' | 'default' | 'outline'> = {
    ORBIT: 'destructive',
    PATROL: 'default',
    TRANSIT: 'secondary',
    BLIP: 'outline',
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground">
          Splits tracks on {'>'}30 min gaps — reveals real orbiting/holding patterns vs. pseudo-loiters
        </p>
        <Button onClick={run} disabled={loading} size="sm" className="gap-1.5">
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
          Run Segmentation
        </Button>
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded border border-border bg-muted/20">
            <span className="text-[10px] text-muted-foreground uppercase">Total Segments</span>
            <p className="font-mono text-lg font-bold">{data.summary.totalSegments}</p>
          </div>
          <div className="p-3 rounded border border-destructive/30 bg-destructive/5">
            <span className="text-[10px] text-muted-foreground uppercase">Orbits Detected</span>
            <p className="font-mono text-lg font-bold text-destructive">{data.summary.orbits}</p>
          </div>
          <div className="p-3 rounded border border-border bg-muted/20">
            <span className="text-[10px] text-muted-foreground uppercase">Avg Duration</span>
            <p className="font-mono text-lg font-bold">{data.summary.avgDuration} min</p>
          </div>
          <div className="p-3 rounded border border-border bg-muted/20">
            <span className="text-[10px] text-muted-foreground uppercase">Operators</span>
            <p className="font-mono text-lg font-bold">{Object.keys(data.summary.byOperator || {}).length}</p>
          </div>
        </div>
      )}

      {data?.summary?.byPattern && (
        <div className="border border-border rounded p-3">
          <h4 className="text-xs font-mono text-muted-foreground mb-2">PATTERN DISTRIBUTION</h4>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={Object.entries(data.summary.byPattern).map(([name, count]) => ({ name, count }))}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {data?.segments?.length > 0 && (
        <ScrollArea className="h-[350px]">
          <div className="space-y-1.5">
            {data.segments.map((s: any, i: number) => (
              <div key={i} className="p-2 rounded border border-border bg-muted/10 text-xs flex items-center gap-3">
                <span className="font-mono font-bold w-16">{s.registration}</span>
                <Badge variant={patternBadge[s.pattern_type] || 'secondary'} className="text-[9px] w-16 justify-center">
                  {s.pattern_type}
                </Badge>
                <span className="text-muted-foreground w-28">{s.start_time?.slice(0, 16)?.replace('T', ' ')}</span>
                <span className="font-mono w-16 text-right">{s.duration_min}min</span>
                <span className="w-12 text-right">{s.points}pts</span>
                <span className={`w-16 text-right font-mono ${s.avg_alt < 500 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {s.avg_alt}ft
                </span>
                <span className="text-muted-foreground w-14 text-right">{s.avg_speed}kt</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {!data && !loading && (
        <div className="text-center py-12 text-muted-foreground space-y-2">
          <GitBranch className="w-12 h-12 mx-auto opacity-30" />
          <p className="text-sm">Break continuous tracks into real segments using 30-min gap detection</p>
          <p className="text-xs">Eliminates pseudo-loiters and reveals true ORBIT / PATROL / TRANSIT patterns</p>
        </div>
      )}
    </div>
  );
}
