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
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            WITH flight_days AS (
              SELECT 
                DATE(detection_timestamp) as event_date,
                COUNT(*) as flight_count,
                ARRAY_AGG(DISTINCT registration) FILTER (WHERE registration IS NOT NULL) as aircraft
              FROM live_flight_detections_rows
              WHERE detection_timestamp IS NOT NULL
              GROUP BY DATE(detection_timestamp)
            ),
            biometric_days AS (
              SELECT 
                DATE(timestamp) as event_date,
                COUNT(*) as bio_count,
                MAX(stress_score) as max_stress
              FROM biometric_monitoring
              WHERE timestamp IS NOT NULL
              GROUP BY DATE(timestamp)
            ),
            josiah_days AS (
              SELECT 
                DATE(timestamp) as event_date,
                COUNT(*) as log_count
              FROM josiah_timeline
              WHERE timestamp IS NOT NULL
              GROUP BY DATE(timestamp)
            )
            SELECT 
              COALESCE(f.event_date, b.event_date, j.event_date) as date,
              COALESCE(f.flight_count, 0) as flights,
              COALESCE(b.bio_count, 0) as biometric_events,
              COALESCE(j.log_count, 0) as josiah_logs,
              b.max_stress as highest_stress,
              f.aircraft as aircraft_seen,
              CASE WHEN f.flight_count > 0 AND b.bio_count > 0 AND j.log_count > 0 THEN true ELSE false END as three_factor
            FROM flight_days f
            FULL OUTER JOIN biometric_days b ON f.event_date = b.event_date
            FULL OUTER JOIN josiah_days j ON COALESCE(f.event_date, b.event_date) = j.event_date
            ORDER BY date DESC
            LIMIT 100
          `
        }
      });

      if (error) throw error;
      
      const parsed = data?.results?.map((r: Record<string, unknown>) => ({
        date: r.date as string,
        flights: parseInt(r.flights as string || '0'),
        biometricEvents: parseInt(r.biometric_events as string || '0'),
        josiahLogs: parseInt(r.josiah_logs as string || '0'),
        screenshots: 0,
        hasThreeFactorConvergence: r.three_factor === true,
        highestStressScore: r.highest_stress ? parseFloat(r.highest_stress as string) : undefined,
        aircraftSeen: (r.aircraft_seen as string[] || []).slice(0, 5)
      })) || [];
      
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
              SELECT heart_rate, stress_score, timestamp
              FROM biometric_monitoring
              WHERE DATE(timestamp) = '${date}'
              ORDER BY timestamp DESC
              LIMIT 20
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT content, timestamp, correlation_id as correlation
              FROM josiah_timeline
              WHERE DATE(timestamp) = '${date}'
              ORDER BY timestamp DESC
              LIMIT 20
            `
          }
        })
      ]);

      setDayDetail({
        flights: flightsRes.data?.results || [],
        biometrics: biometricsRes.data?.results?.map((b: Record<string, unknown>) => ({
          heartRate: parseInt(b.heart_rate as string || '0'),
          stressScore: b.stress_score ? parseFloat(b.stress_score as string) : undefined,
          timestamp: b.timestamp as string
        })) || [],
        josiahLogs: josiahRes.data?.results || []
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
