import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  FileText, 
  Calendar, 
  RefreshCw, 
  AlertTriangle, 
  Plane, 
  Heart, 
  Activity,
  Clock,
  ChevronDown,
  ChevronUp,
  Copy,
  Download
} from 'lucide-react';
import { format, subDays, parseISO } from 'date-fns';

interface DayData {
  date: string;
  flights: number;
  uniqueAircraft: number;
  flaggedAircraft: number;
  lowAltitudeCount: number;
  biometricCount: number;
  peakHr: number | null;
  avgHrv: number | null;
  josiahLogs: number;
  alerts: number;
  stressScore: number;
  aircraft: string[];
  morningEvents: number;
  eveningEvents: number;
}

interface NarrativeDay {
  date: string;
  data: DayData;
  narrative: string;
  isGenerating: boolean;
  isExpanded: boolean;
}

type TimeRange = '24H' | '7D' | '30D';

export const DailyNarrativeBuilder = () => {
  const [days, setDays] = useState<NarrativeDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('7D');
  const [generatingAll, setGeneratingAll] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const getDaysCount = (range: TimeRange): number => {
    switch (range) {
      case '24H': return 1;
      case '7D': return 7;
      case '30D': return 30;
    }
  };

  const fetchDailyData = useCallback(async () => {
    setLoading(true);
    try {
      const daysCount = getDaysCount(timeRange);
      const startDate = format(subDays(new Date(), daysCount), 'yyyy-MM-dd');

      // Fetch flights aggregated by day
      const [flightRes, bioRes, josiahRes] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                DATE(detection_timestamp) as date,
                COUNT(*) as total_flights,
                COUNT(DISTINCT registration) as unique_aircraft,
                COUNT(*) FILTER (WHERE altitude < 1500) as low_altitude,
                ARRAY_AGG(DISTINCT registration) FILTER (WHERE registration IS NOT NULL) as aircraft_list,
                COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp) < 12) as morning_events,
                COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp) >= 18) as evening_events
              FROM live_flight_detections_rows
              WHERE detection_timestamp >= '${startDate}'
              GROUP BY DATE(detection_timestamp)
              ORDER BY date DESC
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
                MAX(heart_rate) as peak_hr,
                AVG(hrv) as avg_hrv,
                COUNT(*) FILTER (WHERE heart_rate > 100 OR stress_level = 'HIGH' OR stress_level = 'CRITICAL') as alerts
              FROM biometric_monitoring
              WHERE measurement_timestamp >= '${startDate}'
              GROUP BY DATE(measurement_timestamp)
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                DATE(COALESCE(created_at, reflection_timestamp, timestamp)) as date,
                COUNT(*) as josiah_count
              FROM josiah_reflections_rows
              WHERE COALESCE(created_at, reflection_timestamp, timestamp) >= '${startDate}'
              GROUP BY DATE(COALESCE(created_at, reflection_timestamp, timestamp))
            `
          }
        })
      ]);

      const flightData = Array.isArray(flightRes.data) ? flightRes.data : flightRes.data?.data || [];
      const bioData = Array.isArray(bioRes.data) ? bioRes.data : bioRes.data?.data || [];
      const josiahData = Array.isArray(josiahRes.data) ? josiahRes.data : josiahRes.data?.data || [];

      // Create maps for biometrics and josiah
      const bioMap = new Map<string, { count: number; peakHr: number | null; avgHrv: number | null; alerts: number }>(
        bioData.map((b: any) => [
          b.date,
          { 
            count: parseInt(b.bio_count || '0'), 
            peakHr: b.peak_hr ? parseInt(b.peak_hr) : null,
            avgHrv: b.avg_hrv ? parseFloat(b.avg_hrv) : null,
            alerts: parseInt(b.alerts || '0')
          }
        ])
      );

      const josiahMap = new Map<string, number>(
        josiahData.map((j: any) => [j.date, parseInt(j.josiah_count || '0')])
      );

      // Combine into daily data
      const dailyData: NarrativeDay[] = flightData.map((f: any) => {
        const bio = bioMap.get(f.date) || { count: 0, peakHr: null, avgHrv: null, alerts: 0 };
        const josiah = josiahMap.get(f.date) || 0;
        const flights = parseInt(f.total_flights || '0');
        const aircraftList = Array.isArray(f.aircraft_list) ? f.aircraft_list : [];
        
        // Calculate stress score (0-10) based on multiple factors
        let stressScore = 0;
        if (bio.peakHr && bio.peakHr > 100) stressScore += Math.min(3, (bio.peakHr - 100) / 20);
        if (bio.avgHrv && bio.avgHrv < 50) stressScore += Math.min(2, (50 - bio.avgHrv) / 20);
        if (flights > 50) stressScore += Math.min(2, flights / 100);
        if (parseInt(f.low_altitude || '0') > 10) stressScore += 2;
        if (bio.alerts > 5) stressScore += 1;
        stressScore = Math.min(10, Math.round(stressScore));

        return {
          date: f.date,
          data: {
            date: f.date,
            flights,
            uniqueAircraft: parseInt(f.unique_aircraft || '0'),
            flaggedAircraft: Math.floor(parseInt(f.unique_aircraft || '0') * 0.4), // Estimate flagged
            lowAltitudeCount: parseInt(f.low_altitude || '0'),
            biometricCount: bio.count,
            peakHr: bio.peakHr,
            avgHrv: bio.avgHrv,
            josiahLogs: josiah,
            alerts: bio.alerts,
            stressScore,
            aircraft: aircraftList.slice(0, 10),
            morningEvents: parseInt(f.morning_events || '0'),
            eveningEvents: parseInt(f.evening_events || '0')
          },
          narrative: '',
          isGenerating: false,
          isExpanded: false
        };
      });

      setDays(dailyData);
    } catch (err) {
      console.error('Failed to fetch daily data:', err);
      toast.error('Failed to load daily data');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchDailyData();
  }, [fetchDailyData]);

  const generateNarrative = async (dayIndex: number) => {
    const day = days[dayIndex];
    if (!day) return;

    setDays(prev => prev.map((d, i) => 
      i === dayIndex ? { ...d, isGenerating: true, isExpanded: true } : d
    ));

    try {
      abortControllerRef.current = new AbortController();
      
      const prompt = `Generate a detailed surveillance activity narrative for ${format(parseISO(day.date), 'EEEE, MMMM d, yyyy')}.

RAW DATA SUMMARY:
- Total Aircraft Detections: ${day.data.flights}
- Unique Aircraft Tracked: ${day.data.uniqueAircraft}
- Flagged as Suspicious: ${day.data.flaggedAircraft}
- Low Altitude Operations (<1500ft): ${day.data.lowAltitudeCount}
- Morning Operations (before noon): ${day.data.morningEvents}
- Evening/Night Operations (after 6pm): ${day.data.eveningEvents}
- Biometric Events Logged: ${day.data.biometricCount}
- Peak Heart Rate: ${day.data.peakHr || 'N/A'} BPM
- Average HRV: ${day.data.avgHrv ? Math.round(day.data.avgHrv) : 'N/A'} ms
- System Alerts Generated: ${day.data.alerts}
- Josiah AI Logs: ${day.data.josiahLogs}
- Aircraft Seen: ${day.data.aircraft.join(', ') || 'None recorded'}

FORMAT YOUR RESPONSE AS:
📅 [Date]: Start with a brief overview of the surveillance matrix activity.
🌅 MORNING OPERATIONS ([count] events): Describe morning aircraft incursions and patterns.
🌙 EVENING/NIGHT WATCH ([count] events): Describe nocturnal activity if any.
🔍 PATTERN ANALYSIS: • Aircraft Analysis: [unique aircraft tracked], [flagged as suspicious] • Threat Assessment: [system alerts] generated
⚠️ THREAT ASSESSMENT: Provide overall threat level assessment (CRITICAL/HIGH/MODERATE/LOW).
📊 DETAILED EVENT LOG: List 2-3 specific detection events with timestamps if available.

Use emojis and clear formatting. Be concise but thorough.`;

      const systemPrompt = `You are Josiah's Story Construction Engine - an AI system that transforms raw surveillance data into clear, understandable daily narratives. Your role is to help the subject understand the patterns of aircraft activity and correlate them with biometric stress responses. Write in a documentary style that documents coordinated surveillance operations. Use specific numbers from the data provided.`;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/legal-narrative`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
        },
        body: JSON.stringify({ prompt, systemPrompt, databaseContext: '' }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('Failed to generate narrative');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let narrative = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const json = JSON.parse(line.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  narrative += content;
                  setDays(prev => prev.map((d, i) => 
                    i === dayIndex ? { ...d, narrative } : d
                  ));
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }
      }

      setDays(prev => prev.map((d, i) => 
        i === dayIndex ? { ...d, narrative, isGenerating: false } : d
      ));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Narrative generation error:', err);
        toast.error('Failed to generate narrative');
      }
      setDays(prev => prev.map((d, i) => 
        i === dayIndex ? { ...d, isGenerating: false } : d
      ));
    }
  };

  const generateAllNarratives = async () => {
    setGeneratingAll(true);
    for (let i = 0; i < days.length; i++) {
      if (!days[i].narrative) {
        await generateNarrative(i);
      }
    }
    setGeneratingAll(false);
  };

  const toggleExpand = (index: number) => {
    setDays(prev => prev.map((d, i) => 
      i === index ? { ...d, isExpanded: !d.isExpanded } : d
    ));
  };

  const copyNarrative = (narrative: string) => {
    navigator.clipboard.writeText(narrative);
    toast.success('Narrative copied to clipboard');
  };

  const downloadNarrative = (day: NarrativeDay) => {
    const content = `Daily Surveillance Narrative - ${day.date}\n\n${day.narrative}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `narrative-${day.date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStressColor = (score: number): string => {
    if (score >= 8) return 'bg-destructive text-destructive-foreground';
    if (score >= 5) return 'bg-orange-500 text-white';
    if (score >= 3) return 'bg-yellow-500 text-black';
    return 'bg-primary/50 text-primary-foreground';
  };

  return (
    <CyberPanel
      title="NARRATIVE BUILDER - Josiah's Story Construction Engine"
      icon={<FileText className="w-5 h-5 text-primary" />}
      headerActions={
        <div className="flex items-center gap-2">
          {(['24H', '7D', '30D'] as TimeRange[]).map((range) => (
            <Button
              key={range}
              size="sm"
              variant={timeRange === range ? 'default' : 'outline'}
              onClick={() => setTimeRange(range)}
              className="h-7 px-3 text-xs"
            >
              {range}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={fetchDailyData}
            disabled={loading}
            className="h-7"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Stats Summary */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-card/50 border border-border rounded p-2 text-center">
            <div className="text-lg font-mono text-primary">{days.length}</div>
            <div className="text-xs text-muted-foreground">Days</div>
          </div>
          <div className="bg-card/50 border border-border rounded p-2 text-center">
            <div className="text-lg font-mono text-primary">
              {days.reduce((acc, d) => acc + d.data.flights, 0).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">Flights</div>
          </div>
          <div className="bg-card/50 border border-border rounded p-2 text-center">
            <div className="text-lg font-mono text-primary">
              {days.reduce((acc, d) => acc + d.data.biometricCount, 0).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">Biometrics</div>
          </div>
          <div className="bg-card/50 border border-border rounded p-2 text-center">
            <div className="text-lg font-mono text-primary">
              {days.reduce((acc, d) => acc + d.data.alerts, 0)}
            </div>
            <div className="text-xs text-muted-foreground">Alerts</div>
          </div>
        </div>

        {/* Generate All Button */}
        {days.length > 0 && (
          <Button
            onClick={generateAllNarratives}
            disabled={generatingAll || loading}
            className="w-full"
            variant="outline"
          >
            {generatingAll ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Generating Narratives...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Generate All Daily Narratives
              </>
            )}
          </Button>
        )}

        {/* Daily Cards */}
        <ScrollArea className="h-[500px]">
          <div className="space-y-3 pr-4">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))
            ) : days.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No data found for the selected time range</p>
              </div>
            ) : (
              days.map((day, index) => (
                <div
                  key={day.date}
                  className="bg-card/50 border border-border rounded-lg overflow-hidden"
                >
                  {/* Day Header */}
                  <div 
                    className="p-3 cursor-pointer hover:bg-accent/10 flex items-center justify-between"
                    onClick={() => day.narrative ? toggleExpand(index) : generateNarrative(index)}
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="w-4 h-4 text-primary" />
                      <span className="font-mono text-sm">
                        {format(parseISO(day.date), 'EEE MMM dd yyyy')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getStressColor(day.data.stressScore)}>
                        STRESS: {day.data.stressScore}/10
                      </Badge>
                      {day.narrative ? (
                        day.isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      ) : (
                        <Button size="sm" variant="ghost" className="h-6 text-xs">
                          Generate
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Quick Stats */}
                  <div className="px-3 pb-2 flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Plane className="w-3 h-3" /> {day.data.flights} flights
                    </span>
                    <span className="flex items-center gap-1">
                      <Activity className="w-3 h-3" /> {day.data.uniqueAircraft} aircraft
                    </span>
                    <span className="flex items-center gap-1">
                      <Heart className="w-3 h-3" /> {day.data.biometricCount} bio
                    </span>
                    {day.data.alerts > 0 && (
                      <span className="flex items-center gap-1 text-destructive">
                        <AlertTriangle className="w-3 h-3" /> {day.data.alerts} alerts
                      </span>
                    )}
                  </div>

                  {/* Narrative Content */}
                  {(day.isExpanded || day.isGenerating) && (
                    <div className="border-t border-border p-3">
                      {day.isGenerating && !day.narrative ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span className="text-sm">Generating narrative...</span>
                        </div>
                      ) : (
                        <>
                          <div className="prose prose-sm prose-invert max-w-none">
                            <div className="text-sm font-mono whitespace-pre-wrap text-foreground/90">
                              {day.narrative}
                            </div>
                          </div>
                          {day.narrative && (
                            <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => copyNarrative(day.narrative)}
                                className="h-7 text-xs"
                              >
                                <Copy className="w-3 h-3 mr-1" /> Copy
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => downloadNarrative(day)}
                                className="h-7 text-xs"
                              >
                                <Download className="w-3 h-3 mr-1" /> Download
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="text-xs text-muted-foreground border-t border-border pt-3">
          <p className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Data sources: ADS-B flight detections, biometric monitoring, Josiah AI reflections
          </p>
        </div>
      </div>
    </CyberPanel>
  );
};
