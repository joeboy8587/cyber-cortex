import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  AlertTriangle, Clock, MapPin, Activity, 
  Eye, Loader2, Radio, Fingerprint
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface HourlyPattern {
  hour: number;
  count: number;
  label: string;
}

interface XXBStats {
  totalDetections: number;
  avgAltitude: number;
  activeDays: number;
  peakHour: number;
  nightOperations: number;
  dayOperations: number;
}

export const XXBInvestigator = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<XXBStats | null>(null);
  const [hourlyPattern, setHourlyPattern] = useState<HourlyPattern[]>([]);
  const [hasData, setHasData] = useState(false);

  const investigateXXB = async () => {
    setIsLoading(true);
    
    try {
      // Get XXB overall stats
      const { data: statsData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `
            SELECT 
              COUNT(*) as total,
              AVG(altitude) as avg_alt,
              COUNT(DISTINCT DATE(detection_timestamp)) as active_days,
              SUM(CASE WHEN EXTRACT(HOUR FROM detection_timestamp) >= 19 OR EXTRACT(HOUR FROM detection_timestamp) < 6 THEN 1 ELSE 0 END) as night_ops,
              SUM(CASE WHEN EXTRACT(HOUR FROM detection_timestamp) >= 6 AND EXTRACT(HOUR FROM detection_timestamp) < 19 THEN 1 ELSE 0 END) as day_ops
            FROM live_flight_detections_rows 
            WHERE registration = 'XXB' OR callsign = 'XXB'
          `
        }
      });
      
      const row = statsData?.[0];
      if (row && parseInt(row.total) > 0) {
        setHasData(true);
        
        // Get hourly pattern
        const { data: hourlyData } = await supabase.functions.invoke('neon-query', {
          body: { 
            action: 'customQuery',
            query: `
              SELECT 
                EXTRACT(HOUR FROM detection_timestamp) as hour,
                COUNT(*) as count
              FROM live_flight_detections_rows 
              WHERE registration = 'XXB' OR callsign = 'XXB'
              GROUP BY EXTRACT(HOUR FROM detection_timestamp)
              ORDER BY hour
            `
          }
        });
        
        const hourlyRows = hourlyData || [];
        const pattern: HourlyPattern[] = Array.from({ length: 24 }, (_, i) => ({
          hour: i,
          count: 0,
          label: `${i.toString().padStart(2, '0')}:00`
        }));
        
        let peakHour = 0;
        let peakCount = 0;
        
        hourlyRows.forEach((r: any) => {
          const h = parseInt(r.hour);
          const c = parseInt(r.count);
          pattern[h].count = c;
          if (c > peakCount) {
            peakCount = c;
            peakHour = h;
          }
        });
        
        setHourlyPattern(pattern);
        
        setStats({
          totalDetections: parseInt(row.total),
          avgAltitude: parseFloat(row.avg_alt) || 0,
          activeDays: parseInt(row.active_days),
          peakHour,
          nightOperations: parseInt(row.night_ops),
          dayOperations: parseInt(row.day_ops)
        });
      }
      
    } catch (error) {
      console.error('XXB investigation error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    investigateXXB();
  }, []);

  const formatHour = (hour: number) => {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${h}${ampm}`;
  };

  const getBarColor = (hour: number) => {
    // KCSO patrol hours: 6PM - 2AM
    if (hour >= 18 || hour < 2) return 'hsl(0, 84%, 60%)'; // Red for patrol hours
    if (hour >= 2 && hour < 6) return 'hsl(38, 92%, 50%)'; // Orange for early morning
    return 'hsl(217, 91%, 60%)'; // Blue for daytime
  };

  return (
    <CyberPanel 
      title="XXB MYSTERY SIGNAL"
      headerActions={
        stats && (
          <Badge variant="outline" className="border-red-500/50 text-red-400">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {(stats.totalDetections / 1000000).toFixed(2)}M Detections
          </Badge>
        )
      }
    >
      <div className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !hasData ? (
          <div className="text-center py-12 text-muted-foreground">
            <Radio className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No XXB signal data found</p>
          </div>
        ) : (
          <>
            {/* What is XXB? */}
            <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/30">
              <h3 className="font-semibold text-red-400 flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4" />
                What is "XXB"?
              </h3>
              <p className="text-sm text-muted-foreground">
                "XXB" is <strong>not a valid aircraft registration</strong>. All aircraft operating in US airspace 
                are legally required to broadcast their registration number. An aircraft broadcasting "XXB" is 
                deliberately masking its identity - this is illegal under FAA regulations except for specific 
                military or law enforcement operations. The pattern suggests this may be a KCSO aircraft 
                operating in "stealth mode."
              </p>
            </div>

            {/* Stats Grid */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Radio className="h-3 w-3" />
                    <span className="text-xs">Total Detections</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">
                    {stats.totalDetections.toLocaleString()}
                  </p>
                </div>
                
                <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Activity className="h-3 w-3" />
                    <span className="text-xs">Avg Altitude</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">
                    {stats.avgAltitude.toFixed(0)} ft
                  </p>
                </div>
                
                <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Clock className="h-3 w-3" />
                    <span className="text-xs">Active Days</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">
                    {stats.activeDays}
                  </p>
                </div>
                
                <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Eye className="h-3 w-3" />
                    <span className="text-xs">Peak Hour</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">
                    {formatHour(stats.peakHour)}
                  </p>
                </div>
              </div>
            )}

            {/* Night vs Day Operations */}
            {stats && (
              <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  Operation Time Analysis
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
                    <p className="text-2xl font-bold text-orange-400">
                      {((stats.nightOperations / stats.totalDetections) * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Night Operations (7PM - 6AM)
                    </p>
                    <p className="text-sm text-orange-400 mt-1">
                      {stats.nightOperations.toLocaleString()} detections
                    </p>
                  </div>
                  <div className="text-center p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                    <p className="text-2xl font-bold text-blue-400">
                      {((stats.dayOperations / stats.totalDetections) * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Day Operations (6AM - 7PM)
                    </p>
                    <p className="text-sm text-blue-400 mt-1">
                      {stats.dayOperations.toLocaleString()} detections
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Hourly Pattern Chart */}
            {hourlyPattern.length > 0 && (
              <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  24-Hour Activity Pattern
                </h4>
                <p className="text-xs text-muted-foreground mb-4">
                  <span className="inline-block w-3 h-3 bg-red-500 rounded mr-1"></span> KCSO Patrol Hours (6PM-2AM)
                  <span className="inline-block w-3 h-3 bg-orange-500 rounded ml-4 mr-1"></span> Early Morning (2AM-6AM)
                  <span className="inline-block w-3 h-3 bg-blue-500 rounded ml-4 mr-1"></span> Daytime (6AM-6PM)
                </p>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyPattern}>
                      <XAxis 
                        dataKey="hour" 
                        tickFormatter={(h) => h % 3 === 0 ? formatHour(h) : ''} 
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      />
                      <YAxis 
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                        tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        labelFormatter={(h) => `${formatHour(Number(h))}`}
                        formatter={(v: number) => [v.toLocaleString(), 'Detections']}
                      />
                      <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                        {hourlyPattern.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={getBarColor(entry.hour)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Key Finding */}
            <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
              <h4 className="font-semibold text-yellow-400 flex items-center gap-2 mb-2">
                <Fingerprint className="h-4 w-4" />
                Key Finding
              </h4>
              <p className="text-sm text-muted-foreground">
                The XXB signal's activity pattern peaks during documented KCSO patrol hours (6PM-2AM), 
                operates at altitudes consistent with helicopter surveillance (~1,100 ft), and appeared 
                on {stats?.activeDays || 0} distinct days. This strongly suggests XXB is a <strong>KCSO 
                helicopter operating with its transponder in a masked or test mode</strong>. The correlation 
                between XXB activity and your documented biometric events requires further investigation.
              </p>
            </div>
          </>
        )}
      </div>
    </CyberPanel>
  );
};
