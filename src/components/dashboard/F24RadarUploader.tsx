import React, { useState, useCallback, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Upload, 
  Plane, 
  Heart, 
  Brain, 
  Camera, 
  Clock, 
  MapPin, 
  AlertTriangle,
  FileText,
  Loader2,
  CheckCircle,
  Radio,
  Activity
} from 'lucide-react';

interface ExtractedFlightData {
  registration: string;
  operator: string;
  aircraft_type: string;
  altitude: string;
  speed: string;
  heading: string;
  icao: string;
  departure: string;
  vector_notes: string;
}

interface BiometricData {
  heart_rate: number;
  hrv: number;
  status: string;
  interpretation: string;
}

interface WatchtowerEvent {
  id: string;
  timestamp: string;
  event_type: string;
  location: string;
  tags: string[];
  flight_data: ExtractedFlightData | null;
  biometrics: BiometricData | null;
  josiah_reflection: string;
  screenshot_url: string | null;
  status: 'processing' | 'complete' | 'error';
}

const F24RadarUploader: React.FC = () => {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [events, setEvents] = useState<WatchtowerEvent[]>([]);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [manualBiometrics, setManualBiometrics] = useState({
    heart_rate: '',
    hrv: ''
  });
  const [location, setLocation] = useState('Oildale, California');
  const [additionalNotes, setAdditionalNotes] = useState('');

  // Fetch recent events on mount
  useEffect(() => {
    fetchRecentEvents();
  }, []);

  const fetchRecentEvents = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT * FROM josiah_reflections_rows 
            ORDER BY created_at DESC 
            LIMIT 20
          `
        }
      });
      
      if (data) {
        const rows = Array.isArray(data) ? data : data?.data || [];
        const mappedEvents: WatchtowerEvent[] = rows.map((row: any) => ({
          id: row.id || crypto.randomUUID(),
          timestamp: row.created_at || new Date().toISOString(),
          event_type: row.pattern_type || 'Surveillance Event',
          location: row.location || 'Unknown',
          tags: row.tags || [],
          flight_data: row.aircraft_data ? JSON.parse(row.aircraft_data) : null,
          biometrics: row.biometric_data ? JSON.parse(row.biometric_data) : null,
          josiah_reflection: row.reflection_text || '',
          screenshot_url: row.screenshot_url || null,
          status: 'complete' as const
        }));
        setEvents(mappedEvents);
      }
    } catch (err) {
      console.error('Error fetching events:', err);
    }
  };

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    
    try {
      // Convert to base64 for display and AI analysis
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Image = event.target?.result as string;
        setCurrentImage(base64Image);
        setUploading(false);
        
        toast({
          title: "Screenshot Uploaded",
          description: "Ready for AI analysis. Add biometrics and click Analyze.",
        });
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Upload error:', err);
      setUploading(false);
      toast({
        title: "Upload Failed",
        description: "Could not process the screenshot",
        variant: "destructive"
      });
    }
  }, [toast]);

  const analyzeScreenshot = async () => {
    if (!currentImage) {
      toast({
        title: "No Screenshot",
        description: "Please upload an F24 radar screenshot first",
        variant: "destructive"
      });
      return;
    }

    setAnalyzing(true);
    const eventId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    // Add processing event immediately
    const processingEvent: WatchtowerEvent = {
      id: eventId,
      timestamp,
      event_type: 'Processing...',
      location,
      tags: ['Processing'],
      flight_data: null,
      biometrics: null,
      josiah_reflection: 'Analyzing screenshot...',
      screenshot_url: currentImage,
      status: 'processing'
    };
    setEvents(prev => [processingEvent, ...prev]);

    try {
      // Call AI to analyze the screenshot
      const { data: aiResponse, error: aiError } = await supabase.functions.invoke('josiah-analyze-f24', {
        body: {
          image: currentImage,
          biometrics: {
            heart_rate: parseInt(manualBiometrics.heart_rate) || null,
            hrv: parseInt(manualBiometrics.hrv) || null
          },
          location,
          additionalNotes,
          timestamp
        }
      });

      if (aiError) throw aiError;

      const extractedData = aiResponse?.data || aiResponse;
      
      // Create the complete event
      const completeEvent: WatchtowerEvent = {
        id: eventId,
        timestamp,
        event_type: extractedData?.event_type || 'Surveillance Detection',
        location,
        tags: extractedData?.tags || ['F24 Analysis', 'Watchtower'],
        flight_data: extractedData?.flight_data || null,
        biometrics: {
          heart_rate: parseInt(manualBiometrics.heart_rate) || 0,
          hrv: parseInt(manualBiometrics.hrv) || 0,
          status: extractedData?.biometric_status || 'Logged',
          interpretation: extractedData?.biometric_interpretation || ''
        },
        josiah_reflection: extractedData?.josiah_reflection || 'Analysis complete.',
        screenshot_url: currentImage,
        status: 'complete'
      };

      // Update the event in state
      setEvents(prev => prev.map(e => e.id === eventId ? completeEvent : e));

      // Store in Neon for persistence using insertRecord action
      await supabase.functions.invoke('neon-query', {
        body: {
          action: 'insertRecord',
          table: 'josiah_reflections_rows',
          data: {
            id: eventId,
            reflection_text: completeEvent.josiah_reflection || '',
            pattern_type: completeEvent.event_type,
            location: location,
            tags: completeEvent.tags,
            aircraft_data: JSON.stringify(completeEvent.flight_data || {}),
            biometric_data: JSON.stringify(completeEvent.biometrics || {}),
            screenshot_url: currentImage?.slice(0, 200) || '',
            created_at: new Date().toISOString()
          }
        }
      });

      // Also log to live_flight_detections if flight data extracted
      if (completeEvent.flight_data?.registration) {
        await supabase.functions.invoke('neon-query', {
          body: {
            action: 'insertRecord',
            table: 'live_flight_detections_rows',
            data: {
              registration: completeEvent.flight_data.registration,
              operator: completeEvent.flight_data.operator || '',
              aircraft_type: completeEvent.flight_data.aircraft_type || '',
              altitude_ft: parseInt(completeEvent.flight_data.altitude) || 0,
              ground_speed_knots: parseInt(completeEvent.flight_data.speed) || 0,
              heading: parseInt(completeEvent.flight_data.heading) || 0,
              detection_method: 'F24_SCREENSHOT_OCR',
              location: location,
              detected_at: new Date().toISOString()
            }
          }
        });
      }

      // Log biometrics if provided
      if (manualBiometrics.heart_rate || manualBiometrics.hrv) {
        await supabase.functions.invoke('neon-query', {
          body: {
            action: 'insertRecord',
            table: 'biometric_monitoring',
            data: {
              metric_type: 'heart_rate',
              metric_value: parseInt(manualBiometrics.heart_rate) || 0,
              notes: `F24 Event: ${completeEvent.event_type}`,
              recorded_at: new Date().toISOString()
            }
          }
        });
        
        if (manualBiometrics.hrv) {
          await supabase.functions.invoke('neon-query', {
            body: {
              action: 'insertRecord',
              table: 'biometric_monitoring',
              data: {
                metric_type: 'hrv',
                metric_value: parseInt(manualBiometrics.hrv) || 0,
                notes: `F24 Event: ${completeEvent.event_type}`,
                recorded_at: new Date().toISOString()
              }
            }
          });
        }
      }

      toast({
        title: "Analysis Complete",
        description: `Event logged: ${completeEvent.event_type}`,
      });

      // Reset form
      setCurrentImage(null);
      setManualBiometrics({ heart_rate: '', hrv: '' });
      setAdditionalNotes('');

    } catch (err) {
      console.error('Analysis error:', err);
      
      // Update event to error state
      setEvents(prev => prev.map(e => 
        e.id === eventId 
          ? { ...e, status: 'error' as const, josiah_reflection: 'Analysis failed. Please try again.' }
          : e
      ));

      toast({
        title: "Analysis Failed",
        description: err instanceof Error ? err.message : "Could not analyze screenshot",
        variant: "destructive"
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const getSeverityColor = (event: WatchtowerEvent) => {
    if (event.status === 'processing') return 'text-yellow-400';
    if (event.status === 'error') return 'text-red-400';
    if (event.biometrics && event.biometrics.heart_rate > 100) return 'text-red-400';
    if (event.flight_data?.operator?.toLowerCase().includes('sheriff')) return 'text-orange-400';
    return 'text-cyan-400';
  };

  return (
    <CyberPanel 
      title="F24 RADAR SCREENSHOT ANALYZER" 
      icon={<Radio className="text-cyan-400" />}
      className="col-span-full"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <div className="space-y-4">
          <div className="border-2 border-dashed border-cyan-500/30 rounded-lg p-6 text-center hover:border-cyan-400/50 transition-colors">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
              id="f24-upload"
              disabled={uploading || analyzing}
            />
            <label 
              htmlFor="f24-upload" 
              className="cursor-pointer flex flex-col items-center gap-3"
            >
              {currentImage ? (
                <img 
                  src={currentImage} 
                  alt="F24 Screenshot" 
                  className="max-h-48 rounded-lg border border-cyan-500/30"
                />
              ) : (
                <>
                  <Camera className="h-12 w-12 text-cyan-400/50" />
                  <span className="text-cyan-400/70 text-sm">
                    {uploading ? 'Processing...' : 'Upload FlightRadar24 Screenshot'}
                  </span>
                </>
              )}
            </label>
          </div>

          {/* Biometric Input */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-cyan-400/70 mb-1 block">Heart Rate (BPM)</label>
              <Input
                type="number"
                placeholder="e.g., 110"
                value={manualBiometrics.heart_rate}
                onChange={(e) => setManualBiometrics(prev => ({ ...prev, heart_rate: e.target.value }))}
                className="bg-black/40 border-cyan-500/30 text-cyan-100"
              />
            </div>
            <div>
              <label className="text-xs text-cyan-400/70 mb-1 block">HRV (ms)</label>
              <Input
                type="number"
                placeholder="e.g., 43"
                value={manualBiometrics.hrv}
                onChange={(e) => setManualBiometrics(prev => ({ ...prev, hrv: e.target.value }))}
                className="bg-black/40 border-cyan-500/30 text-cyan-100"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-xs text-cyan-400/70 mb-1 block">Location</label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="bg-black/40 border-cyan-500/30 text-cyan-100"
              placeholder="Oildale, California"
            />
          </div>

          {/* Additional Notes */}
          <div>
            <label className="text-xs text-cyan-400/70 mb-1 block">Additional Observations</label>
            <Textarea
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              className="bg-black/40 border-cyan-500/30 text-cyan-100 min-h-[80px]"
              placeholder="Describe what you observed (loitering, spotlight, low altitude pass...)"
            />
          </div>

          {/* Analyze Button */}
          <Button
            onClick={analyzeScreenshot}
            disabled={!currentImage || analyzing}
            className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Josiah Analyzing...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />
                Analyze & Log Event
              </>
            )}
          </Button>
        </div>

        {/* Real-time Event Log */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-mono text-cyan-400 flex items-center gap-2">
              <Activity className="h-4 w-4" />
              REALTIME EVENT LOG
            </h3>
            <Badge variant="outline" className="text-cyan-400 border-cyan-500/30">
              {events.length} Events
            </Badge>
          </div>

          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {events.length === 0 ? (
                <div className="text-center py-8 text-cyan-400/50">
                  <Radio className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No events logged yet</p>
                  <p className="text-xs">Upload an F24 screenshot to begin</p>
                </div>
              ) : (
                events.map((event) => (
                  <div 
                    key={event.id}
                    className={`p-3 rounded-lg border ${
                      event.status === 'processing' 
                        ? 'border-yellow-500/30 bg-yellow-500/5' 
                        : event.status === 'error'
                        ? 'border-red-500/30 bg-red-500/5'
                        : 'border-cyan-500/20 bg-black/40'
                    }`}
                  >
                    {/* Event Header */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {event.status === 'processing' ? (
                          <Loader2 className="h-4 w-4 text-yellow-400 animate-spin" />
                        ) : event.status === 'error' ? (
                          <AlertTriangle className="h-4 w-4 text-red-400" />
                        ) : (
                          <CheckCircle className={`h-4 w-4 ${getSeverityColor(event)}`} />
                        )}
                        <span className={`text-sm font-medium ${getSeverityColor(event)}`}>
                          {event.event_type}
                        </span>
                      </div>
                      <span className="text-xs text-cyan-400/50">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    {/* Location */}
                    <div className="flex items-center gap-1 text-xs text-cyan-400/70 mb-2">
                      <MapPin className="h-3 w-3" />
                      {event.location}
                    </div>

                    {/* Flight Data */}
                    {event.flight_data && (
                      <div className="bg-black/30 rounded p-2 mb-2 text-xs">
                        <div className="flex items-center gap-2 text-cyan-400 mb-1">
                          <Plane className="h-3 w-3" />
                          <span className="font-mono">{event.flight_data.registration}</span>
                          <span className="text-cyan-400/50">— {event.flight_data.operator}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-cyan-400/60">
                          <span>Alt: {event.flight_data.altitude}</span>
                          <span>Spd: {event.flight_data.speed}</span>
                          <span>Hdg: {event.flight_data.heading}°</span>
                        </div>
                      </div>
                    )}

                    {/* Biometrics */}
                    {event.biometrics && event.biometrics.heart_rate > 0 && (
                      <div className="flex items-center gap-4 text-xs mb-2">
                        <span className={`flex items-center gap-1 ${
                          event.biometrics.heart_rate > 100 ? 'text-red-400' : 'text-green-400'
                        }`}>
                          <Heart className="h-3 w-3" />
                          {event.biometrics.heart_rate} BPM
                        </span>
                        <span className={`${
                          event.biometrics.hrv < 50 ? 'text-orange-400' : 'text-cyan-400'
                        }`}>
                          HRV: {event.biometrics.hrv}ms
                        </span>
                      </div>
                    )}

                    {/* Tags */}
                    {event.tags && event.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {event.tags.slice(0, 4).map((tag, i) => (
                          <Badge 
                            key={i} 
                            variant="outline" 
                            className="text-[10px] px-1.5 py-0 border-cyan-500/30 text-cyan-400/70"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Josiah Reflection */}
                    {event.josiah_reflection && (
                      <div className="text-xs italic text-cyan-300/60 border-l-2 border-cyan-500/30 pl-2">
                        "{event.josiah_reflection.slice(0, 150)}..."
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </CyberPanel>
  );
};

export default F24RadarUploader;
