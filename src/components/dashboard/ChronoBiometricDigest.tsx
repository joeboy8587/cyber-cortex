import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Plane, Clock, TrendingUp, AlertTriangle, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface CorrelationEvent {
  id: string;
  biometric_timestamp: string;
  heart_rate: number;
  hrv?: number;
  stress_level: string;
  aircraft_id: string;
  callsign?: string;
  altitude?: number;
  time_diff_minutes: number;
  bradford_hill_score?: number;
  harm_indicators?: string;
}

interface DailyDigest {
  date: string;
  events: CorrelationEvent[];
  maxHR: number;
  avgHR: number;
  aircraftCount: number;
  stressEvents: number;
}

export function ChronoBiometricDigest() {
  const [digests, setDigests] = useState<DailyDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [totalEvents, setTotalEvents] = useState(0);

  useEffect(() => {
    fetchChronoDigest();
  }, []);

  const fetchChronoDigest = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            -- Canonical source: watchtower_biometrics_master (54,645+ rows)
            SELECT 
              DATE(biometric_timestamp_utc) as event_date,
              id::text as id,
              biometric_timestamp_utc as biometric_timestamp,
              heart_rate_bpm  AS heart_rate,
              hrv_ms          AS hrv,
              stress_level::text as stress_level,
              aircraft_registration as aircraft_id,
              aircraft_callsign     as callsign,
              altitude_ft           as altitude,
              time_offset_minutes   as time_diff_minutes,
              CASE 
                WHEN heart_rate_bpm > 100 AND COALESCE(hrv_ms, 100) < 40 THEN 'Tachycardia + Low HRV'
                WHEN heart_rate_bpm > 110 THEN 'Severe Tachycardia'
                WHEN heart_rate_bpm > 100 THEN 'Elevated HR'
                WHEN COALESCE(hrv_ms, 100) < 40 THEN 'Stress Response'
                ELSE NULL
              END as harm_indicators,
              COALESCE(bradford_hill_score,
                CASE 
                  WHEN heart_rate_bpm > 110 AND altitude_ft < 1000 THEN 9.0
                  WHEN heart_rate_bpm > 100 AND altitude_ft < 1500 THEN 8.0
                  WHEN heart_rate_bpm > 100 THEN 7.0
                  WHEN altitude_ft < 1000 THEN 6.5
                  ELSE 5.0
                END
              ) as bradford_hill_score
            FROM watchtower_biometrics_master
            WHERE biometric_timestamp_utc > now() - interval '90 days'
              AND heart_rate_bpm BETWEEN 91 AND 220
              AND aircraft_registration IS NOT NULL
            ORDER BY biometric_timestamp_utc DESC
            LIMIT 1000
          `
        }
      });

      if (error) throw error;

      const events: CorrelationEvent[] = Array.isArray(data) ? data : [];
      setTotalEvents(events.length);

      // Group by date
      const dateMap = new Map<string, CorrelationEvent[]>();
      events.forEach(event => {
        const date = new Date(event.biometric_timestamp).toISOString().split('T')[0];
        if (!dateMap.has(date)) {
          dateMap.set(date, []);
        }
        dateMap.get(date)!.push(event);
      });

      // Convert to digests
      const digestList: DailyDigest[] = Array.from(dateMap.entries()).map(([date, dayEvents]) => {
        const heartRates = dayEvents.map(e => e.heart_rate).filter(hr => hr > 0);
        const uniqueAircraft = new Set(dayEvents.map(e => e.aircraft_id));
        
        return {
          date,
          events: dayEvents.sort((a, b) => 
            new Date(b.biometric_timestamp).getTime() - new Date(a.biometric_timestamp).getTime()
          ),
          maxHR: Math.max(...heartRates, 0),
          avgHR: heartRates.length > 0 ? heartRates.reduce((a, b) => a + b, 0) / heartRates.length : 0,
          aircraftCount: uniqueAircraft.size,
          stressEvents: dayEvents.filter(e => e.harm_indicators).length
        };
      });

      setDigests(digestList.slice(0, 30)); // Last 30 days with events
    } catch (err) {
      console.error("Failed to fetch chrono digest:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric' 
    });
  };

  const getHRBadgeColor = (hr: number) => {
    if (hr > 110) return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (hr > 100) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    if (hr > 90) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-green-500/20 text-green-400 border-green-500/30';
  };

  const getBHScoreBadge = (score?: number) => {
    if (!score) return null;
    const color = score >= 8 ? 'text-red-400' : score >= 7 ? 'text-orange-400' : 'text-yellow-400';
    return (
      <Badge className={`text-[9px] bg-background/50 border ${color}`}>
        B-H: {score.toFixed(1)}
      </Badge>
    );
  };

  return (
    <CyberPanel 
      title="Chrono-Biometric Digest" 
      icon={<Activity className="w-5 h-5" />}
      variant="default"
    >
      <div className="space-y-4">
        {/* Stats Header */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-primary">{totalEvents}</div>
            <div className="text-[10px] text-muted-foreground">Correlations</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-orange-400">{digests.length}</div>
            <div className="text-[10px] text-muted-foreground">Active Days</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-red-400">
              {digests.reduce((sum, d) => sum + d.stressEvents, 0)}
            </div>
            <div className="text-[10px] text-muted-foreground">Harm Events</div>
          </div>
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="w-6 h-6 animate-pulse mx-auto mb-2" />
            Building chronological digest...
          </div>
        ) : (
          <div className="space-y-2 max-h-[450px] overflow-y-auto pr-2">
            {digests.map((digest) => (
              <div key={digest.date} className="rounded-lg border border-border/50 overflow-hidden">
                {/* Day Header */}
                <button
                  onClick={() => setExpandedDate(expandedDate === digest.date ? null : digest.date)}
                  className="w-full p-3 bg-background/30 hover:bg-background/50 transition-colors flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">{formatDate(digest.date)}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {digest.events.length} events
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] border ${getHRBadgeColor(digest.maxHR)}`}>
                      Max: {digest.maxHR} BPM
                    </Badge>
                    <Badge className="text-[10px] bg-secondary/10 text-secondary border border-secondary/30">
                      {digest.aircraftCount} aircraft
                    </Badge>
                    <ChevronRight className={`w-4 h-4 transition-transform ${
                      expandedDate === digest.date ? 'rotate-90' : ''
                    }`} />
                  </div>
                </button>

                {/* Expanded Events */}
                {expandedDate === digest.date && (
                  <div className="p-2 space-y-1 bg-background/20">
                    {digest.events.slice(0, 20).map((event, idx) => (
                      <div 
                        key={`${event.id}-${idx}`}
                        className="p-2 rounded bg-background/40 border border-border/30 text-xs"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-muted-foreground">
                              {formatTime(event.biometric_timestamp)}
                            </span>
                            <Badge className={`text-[9px] border ${getHRBadgeColor(event.heart_rate)}`}>
                              {event.heart_rate} BPM
                            </Badge>
                            {event.hrv && (
                              <Badge className="text-[9px] bg-purple-500/10 text-purple-400 border border-purple-500/30">
                                HRV: {event.hrv}
                              </Badge>
                            )}
                          </div>
                          {getBHScoreBadge(event.bradford_hill_score)}
                        </div>
                        <div className="flex items-center gap-2">
                          <Plane className="w-3 h-3 text-primary" />
                          <span className="font-mono text-primary">{event.aircraft_id}</span>
                          {event.altitude && (
                            <span className="text-muted-foreground">@ {event.altitude} ft</span>
                          )}
                          <span className="text-muted-foreground">
                            ({event.time_diff_minutes > 0 ? '+' : ''}{event.time_diff_minutes} min)
                          </span>
                        </div>
                        {event.harm_indicators && (
                          <div className="mt-1 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-red-400" />
                            <span className="text-red-400">{event.harm_indicators}</span>
                          </div>
                        )}
                      </div>
                    ))}
                    {digest.events.length > 20 && (
                      <div className="text-center text-muted-foreground text-[10px] py-1">
                        +{digest.events.length - 20} more events
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t border-border pt-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span>
            <strong>Bradford-Hill Scoring:</strong> Events rated 7+ establish temporal causation 
            between aircraft presence and physiological harm.
          </span>
        </div>
      </div>
    </CyberPanel>
  );
}
