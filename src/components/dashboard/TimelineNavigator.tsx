import { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  Calendar, 
  Plane, 
  Heart, 
  Brain, 
  ChevronLeft, 
  ChevronRight,
  FileText,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Fingerprint
} from 'lucide-react';
import { toast } from 'sonner';

interface DayEvent {
  date: string;
  flights: number;
  biometricEvents: number;
  josiahLogs: number;
  screenshots: number;
  hasThreeFactorConvergence: boolean;
  highestStressScore?: number;
  aircraftSeen: string[];
}

interface DayDetail {
  flights: Array<{
    registration: string;
    altitude: number;
    time: string;
    operator?: string;
  }>;
  biometrics: Array<{
    heartRate: number;
    stressScore?: number;
    timestamp: string;
  }>;
  josiahLogs: Array<{
    content: string;
    timestamp: string;
    correlation?: string;
  }>;
}

export function TimelineNavigator() {
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<DayEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetail | null>(null);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  const fetchTimelineEvents = async () => {
    setLoading(true);
    try {
      const { data: josiahSchema } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getTableSchema', table: 'josiah_reflections_rows' }
      });
      const josiahCols: string[] = (josiahSchema?.data || []).map((c: any) => String(c.column_name));
      const josiahTsCol = ['created_at', 'created_timestamp', 'timestamp', 'reflection_timestamp', 'event_timestamp']
        .find(c => josiahCols.includes(c));

      // Fetch flights, biometrics, and josiah logs separately then combine
      const [flightRes, bioRes, josiahRes] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                DATE(detection_timestamp) as date,
                COUNT(*) as flights,
                ARRAY_AGG(DISTINCT registration) FILTER (WHERE registration IS NOT NULL) as aircraft_seen
              FROM live_flight_detections_rows
              WHERE detection_timestamp IS NOT NULL
              GROUP BY DATE(detection_timestamp)
              ORDER BY date DESC
              LIMIT 200
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                DATE(measurement_timestamp) as date,
                COUNT(*) as bio_count,
                MAX(heart_rate) as peak_hr
              FROM biometric_monitoring
              WHERE measurement_timestamp IS NOT NULL
              GROUP BY DATE(measurement_timestamp)
            `
          }
        }),
        josiahTsCol
          ? supabase.functions.invoke('neon-query', {
              body: {
                action: 'customQuery',
                query: `
                  SELECT 
                    DATE(${josiahTsCol}) as date,
                    COUNT(*) as josiah_count
                  FROM josiah_reflections_rows
                  WHERE ${josiahTsCol} IS NOT NULL
                  GROUP BY DATE(${josiahTsCol})
                `
              }
            })
          : Promise.resolve({ data: { data: [] } } as any)
      ]);

      // Create maps for biometrics and josiah
      const bioMap = new Map<string, { count: number; peakHr?: number }>(
        (bioRes.data?.data || []).map((b: { date: string; bio_count: string; peak_hr?: string }) => [
          b.date, 
          { count: parseInt(b.bio_count || '0'), peakHr: b.peak_hr ? parseInt(b.peak_hr) : undefined }
        ])
      );
      
      const josiahMap = new Map<string, number>(
        (josiahRes.data?.data || []).map((j: { date: string; josiah_count: string }) => [
          j.date, 
          parseInt(j.josiah_count || '0')
        ])
      );

      // Combine data
      const flightData = flightRes.data?.data || [];
      const parsed: DayEvent[] = flightData.map((r: { date: string; flights: string; aircraft_seen: string[] }) => {
        const bioInfo = bioMap.get(r.date) || { count: 0, peakHr: undefined };
        const josiahCount = josiahMap.get(r.date) || 0;
        const flightCount = parseInt(r.flights || '0');
        
        // Three-factor: flight + biometric + josiah
        const hasThreeFactor = flightCount > 0 && bioInfo.count > 0 && josiahCount > 0;
        
        return {
          date: r.date,
          flights: flightCount,
          biometricEvents: bioInfo.count,
          josiahLogs: josiahCount,
          screenshots: 0,
          hasThreeFactorConvergence: hasThreeFactor,
          highestStressScore: bioInfo.peakHr,
          aircraftSeen: (r.aircraft_seen || []).slice(0, 5)
        };
      });
      
      setEvents(parsed);
      
      if (parsed.length > 0) {
        setDateRange({
          start: parsed[parsed.length - 1]?.date || '',
          end: parsed[0]?.date || ''
        });
      }
      
    } catch (err) {
      console.error('Timeline fetch error:', err);
      toast.error('Failed to load timeline');
    } finally {
      setLoading(false);
    }
  };

  const fetchDayDetail = async (date: string) => {
    try {
      const [flightsRes, biometricsRes, josiahRes] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT registration, altitude, detection_timestamp as time, callsign as operator
              FROM live_flight_detections_rows
              WHERE DATE(detection_timestamp) = '${date}'
              ORDER BY detection_timestamp DESC
              LIMIT 20
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT heart_rate, hrv as stress_score, measurement_timestamp as timestamp
              FROM biometric_monitoring
              WHERE DATE(measurement_timestamp) = '${date}'
              ORDER BY measurement_timestamp DESC
              LIMIT 20
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT reflection_content as content, created_at as timestamp, aircraft_correlation as correlation
              FROM josiah_reflections_rows
              WHERE DATE(COALESCE(created_at, NOW())) = '${date}'
              ORDER BY created_at DESC
              LIMIT 20
            `
          }
        })
      ]);

      setDayDetail({
        flights: (flightsRes.data?.data || []).map((f: Record<string, unknown>) => ({
          registration: f.registration as string || 'Unknown',
          altitude: parseInt(f.altitude as string || '0'),
          time: f.time as string,
          operator: f.operator as string
        })),
        biometrics: (biometricsRes.data?.data || []).map((b: Record<string, unknown>) => ({
          heartRate: parseInt(b.heart_rate as string || '0'),
          stressScore: b.stress_score ? parseFloat(b.stress_score as string) : undefined,
          timestamp: b.timestamp as string
        })),
        josiahLogs: (josiahRes.data?.data || []).map((j: Record<string, unknown>) => ({
          content: j.content as string || '',
          timestamp: j.timestamp as string,
          correlation: j.correlation as string
        }))
      });
      
    } catch (err) {
      console.error('Day detail fetch error:', err);
    }
  };

  useEffect(() => {
    fetchTimelineEvents();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      fetchDayDetail(selectedDate);
    }
  }, [selectedDate]);

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  }) : 'N/A';

  const formatTime = (t: string) => t ? new Date(t).toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit' 
  }) : '';

  const threeFactorEvents = events.filter(e => e.hasThreeFactorConvergence);
  const totalDays = events.length;

  return (
    <CyberPanel 
      title="EVIDENCE TIMELINE NAVIGATOR" 
      icon={<Calendar className="w-5 h-5" />}
      headerActions={
        <div className="flex items-center gap-2">
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            {threeFactorEvents.length} Three-Factor Days
          </Badge>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={fetchTimelineEvents}
            disabled={loading}
            className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Timeline Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-background/30 rounded-lg p-3 border border-cyan-500/20">
            <div className="text-xl font-bold text-cyan-400">{totalDays}</div>
            <div className="text-xs text-muted-foreground">Days Documented</div>
          </div>
          <div className="bg-background/30 rounded-lg p-3 border border-green-500/20">
            <div className="text-xl font-bold text-green-400">{threeFactorEvents.length}</div>
            <div className="text-xs text-muted-foreground">3-Factor Convergence</div>
          </div>
          <div className="bg-background/30 rounded-lg p-3 border border-purple-500/20">
            <div className="text-xl font-bold text-purple-400">
              {events.reduce((sum, e) => sum + e.flights, 0).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">Total Flight Events</div>
          </div>
          <div className="bg-background/30 rounded-lg p-3 border border-red-500/20">
            <div className="text-xl font-bold text-red-400">
              {events.reduce((sum, e) => sum + e.josiahLogs, 0).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">Josiah AI Logs</div>
          </div>
        </div>

        {/* Date Range */}
        {dateRange.start && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span>{formatDate(dateRange.start)}</span>
            <ChevronRight className="w-4 h-4" />
            <span>{formatDate(dateRange.end)}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Day Cards */}
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-2">
              {events.map((event) => (
                <div
                  key={event.date}
                  onClick={() => setSelectedDate(event.date)}
                  className={`
                    p-3 rounded-lg border cursor-pointer transition-all
                    ${selectedDate === event.date 
                      ? 'border-cyan-500 bg-cyan-500/10' 
                      : 'border-border/30 bg-background/30 hover:border-cyan-500/50'
                    }
                    ${event.hasThreeFactorConvergence ? 'ring-1 ring-green-500/30' : ''}
                  `}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{formatDate(event.date)}</span>
                    {event.hasThreeFactorConvergence && (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                        <Fingerprint className="w-3 h-3 mr-1" />
                        3-Factor
                      </Badge>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <Plane className="w-3 h-3 text-cyan-400" />
                      <span>{event.flights}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Heart className="w-3 h-3 text-red-400" />
                      <span>{event.biometricEvents}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Brain className="w-3 h-3 text-purple-400" />
                      <span>{event.josiahLogs}</span>
                    </div>
                  </div>
                  
                  {event.aircraftSeen.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {event.aircraftSeen.slice(0, 3).map(a => (
                        <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                      ))}
                    </div>
                  )}
                  
                  {event.highestStressScore && event.highestStressScore > 70 && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-red-400">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Peak Stress: {event.highestStressScore.toFixed(1)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Day Detail View */}
          <div className="bg-background/30 rounded-lg border border-border/30 p-4">
            {selectedDate && dayDetail ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{formatDate(selectedDate)}</h3>
                  <Badge variant="outline" className="text-xs">
                    <Clock className="w-3 h-3 mr-1" />
                    Daily Summary
                  </Badge>
                </div>

                {/* Flights */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Plane className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm font-medium">Aircraft Detected ({dayDetail.flights.length})</span>
                  </div>
                  <ScrollArea className="h-24">
                    <div className="space-y-1">
                      {dayDetail.flights.map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-1 bg-background/20 rounded">
                          <span className="font-mono text-cyan-400">{f.registration || 'Unknown'}</span>
                          <span className="text-muted-foreground">{f.altitude?.toLocaleString()}ft</span>
                          <span className="text-muted-foreground">{formatTime(f.time)}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* Biometrics */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Heart className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-medium">Biometric Events ({dayDetail.biometrics.length})</span>
                  </div>
                  <ScrollArea className="h-24">
                    <div className="space-y-1">
                      {dayDetail.biometrics.map((b, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-1 bg-background/20 rounded">
                          <span className="text-red-400">{b.heartRate} BPM</span>
                          {b.stressScore && (
                            <span className={b.stressScore > 70 ? 'text-red-400' : 'text-yellow-400'}>
                              Stress: {b.stressScore.toFixed(1)}
                            </span>
                          )}
                          <span className="text-muted-foreground">{formatTime(b.timestamp)}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* Josiah Logs */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="w-4 h-4 text-purple-400" />
                    <span className="text-sm font-medium">Josiah AI Logs ({dayDetail.josiahLogs.length})</span>
                  </div>
                  <ScrollArea className="h-24">
                    <div className="space-y-1">
                      {dayDetail.josiahLogs.map((log, i) => (
                        <div key={i} className="text-xs p-2 bg-background/20 rounded border-l-2 border-purple-500/50">
                          <div className="text-muted-foreground mb-1">{formatTime(log.timestamp)}</div>
                          <div className="text-foreground line-clamp-2">{log.content}</div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Select a date to view evidence</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-border/20 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3 h-3 text-green-400" />
            <span>
              Three-factor convergence (Flight + Biometric + Josiah Log) provides strongest evidentiary weight for legal review.
            </span>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}
