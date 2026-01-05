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

interface UploadedScreenshot {
  id: string;
  dataUrl: string;
  filename: string;
}

const F24RadarUploader: React.FC = () => {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [events, setEvents] = useState<WatchtowerEvent[]>([]);
  const [uploadedScreenshots, setUploadedScreenshots] = useState<UploadedScreenshot[]>([]);
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
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    
    try {
      const newScreenshots: UploadedScreenshot[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        newScreenshots.push({
          id: crypto.randomUUID(),
          dataUrl: base64,
          filename: file.name
        });
      }
      
      setUploadedScreenshots(prev => [...prev, ...newScreenshots]);
      setUploading(false);
      
      toast({
        title: `${newScreenshots.length} Screenshot(s) Uploaded`,
        description: "Ready for AI analysis. Add biometrics and click Analyze.",
      });
    } catch (err) {
      console.error('Upload error:', err);
      setUploading(false);
      toast({
        title: "Upload Failed",
        description: "Could not process the screenshot(s)",
        variant: "destructive"
      });
    }
  }, [toast]);

  const removeScreenshot = (id: string) => {
    setUploadedScreenshots(prev => prev.filter(s => s.id !== id));
  };

  const analyzeScreenshots = async () => {
    if (uploadedScreenshots.length === 0) {
      toast({
        title: "No Screenshots",
        description: "Please upload F24 radar screenshot(s) first",
        variant: "destructive"
      });
      return;
    }

    setAnalyzing(true);
    const baseTimestamp = new Date();
    const processedEvents: WatchtowerEvent[] = [];

    // Add processing events for all screenshots
    const processingEvents = uploadedScreenshots.map((screenshot, idx) => ({
      id: screenshot.id,
      timestamp: new Date(baseTimestamp.getTime() + idx * 1000).toISOString(),
      event_type: `Processing (${idx + 1}/${uploadedScreenshots.length})...`,
      location,
      tags: ['Processing'],
      flight_data: null,
      biometrics: null,
      josiah_reflection: `Analyzing screenshot ${idx + 1}...`,
      screenshot_url: screenshot.dataUrl,
      status: 'processing' as const
    }));
    setEvents(prev => [...processingEvents, ...prev]);

    try {
      // Process each screenshot
      for (let i = 0; i < uploadedScreenshots.length; i++) {
        const screenshot = uploadedScreenshots[i];
        const timestamp = new Date(baseTimestamp.getTime() + i * 1000).toISOString();

        try {
          // Call AI to analyze the screenshot
          const { data: aiResponse, error: aiError } = await supabase.functions.invoke('josiah-analyze-f24', {
            body: {
              image: screenshot.dataUrl,
              biometrics: {
                heart_rate: parseInt(manualBiometrics.heart_rate) || null,
                hrv: parseInt(manualBiometrics.hrv) || null
              },
              location,
              additionalNotes: `${additionalNotes} [Screenshot ${i + 1} of ${uploadedScreenshots.length}]`,
              timestamp
            }
          });

          if (aiError) throw aiError;

          const extractedData = aiResponse?.data || aiResponse;
          
          // Create the complete event
          const completeEvent: WatchtowerEvent = {
            id: screenshot.id,
            timestamp,
            event_type: extractedData?.event_type || 'Surveillance Detection',
            location,
            tags: extractedData?.tags || ['F24 Analysis', 'Watchtower', `Batch ${i + 1}`],
            flight_data: extractedData?.flight_data || null,
            biometrics: {
              heart_rate: parseInt(manualBiometrics.heart_rate) || 0,
              hrv: parseInt(manualBiometrics.hrv) || 0,
              status: extractedData?.biometric_status || 'Logged',
              interpretation: extractedData?.biometric_interpretation || ''
            },
            josiah_reflection: extractedData?.josiah_reflection || 'Analysis complete.',
            screenshot_url: screenshot.dataUrl,
            status: 'complete'
          };

          processedEvents.push(completeEvent);

          // Update the event in state
          setEvents(prev => prev.map(e => e.id === screenshot.id ? completeEvent : e));

          // Store in Neon for persistence
          await supabase.functions.invoke('neon-query', {
            body: {
              action: 'insertRecord',
              table: 'josiah_reflections_rows',
              data: {
                id: screenshot.id,
                reflection_text: completeEvent.josiah_reflection || '',
                pattern_type: completeEvent.event_type,
                location: location,
                tags: completeEvent.tags,
                aircraft_data: JSON.stringify(completeEvent.flight_data || {}),
                biometric_data: JSON.stringify(completeEvent.biometrics || {}),
                screenshot_url: screenshot.dataUrl?.slice(0, 200) || '',
                created_at: timestamp
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
                  detected_at: timestamp
                }
              }
            });
          }
        } catch (err) {
          console.error(`Analysis error for screenshot ${i + 1}:`, err);
          setEvents(prev => prev.map(e => 
            e.id === screenshot.id 
              ? { ...e, status: 'error' as const, josiah_reflection: 'Analysis failed.' }
              : e
          ));
        }
      }

      // Log biometrics once for the batch
      if (manualBiometrics.heart_rate || manualBiometrics.hrv) {
        await supabase.functions.invoke('neon-query', {
          body: {
            action: 'insertRecord',
            table: 'biometric_monitoring',
            data: {
              metric_type: 'heart_rate',
              metric_value: parseInt(manualBiometrics.heart_rate) || 0,
              notes: `F24 Batch Analysis: ${processedEvents.length} screenshots`,
              recorded_at: baseTimestamp.toISOString()
            }
          }
        });
      }

      const successCount = processedEvents.filter(e => e.status === 'complete').length;
      toast({
        title: "Batch Analysis Complete",
        description: `${successCount}/${uploadedScreenshots.length} screenshots analyzed successfully`,
      });

      // Reset form
      setUploadedScreenshots([]);
      setManualBiometrics({ heart_rate: '', hrv: '' });
      setAdditionalNotes('');

    } catch (err) {
      console.error('Batch analysis error:', err);
      toast({
        title: "Analysis Failed",
        description: err instanceof Error ? err.message : "Could not analyze screenshots",
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
              multiple
              onChange={handleImageUpload}
              className="hidden"
              id="f24-upload"
              disabled={uploading || analyzing}
            />
            <label 
              htmlFor="f24-upload" 
              className="cursor-pointer flex flex-col items-center gap-3"
            >
              {uploadedScreenshots.length > 0 ? (
                <div className="space-y-2 w-full">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {uploadedScreenshots.map((screenshot, idx) => (
                      <div key={screenshot.id} className="relative group">
                        <img 
                          src={screenshot.dataUrl} 
                          alt={`F24 Screenshot ${idx + 1}`} 
                          className="h-20 w-full object-cover rounded border border-cyan-500/30"
                        />
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            removeScreenshot(screenshot.id);
                          }}
                          className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                        <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[10px] text-cyan-400 text-center truncate px-1">
                          {screenshot.filename}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-cyan-400/70 text-xs">
                    {uploadedScreenshots.length} screenshot(s) ready • Click to add more
                  </p>
                </div>
              ) : (
                <>
                  <Camera className="h-12 w-12 text-cyan-400/50" />
                  <span className="text-cyan-400/70 text-sm">
                    {uploading ? 'Processing...' : 'Upload FlightRadar24 Screenshot(s)'}
                  </span>
                  <span className="text-cyan-400/50 text-xs">
                    Multiple files supported
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
            onClick={analyzeScreenshots}
            disabled={uploadedScreenshots.length === 0 || analyzing}
            className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing {uploadedScreenshots.length} screenshot(s)...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />
                Analyze {uploadedScreenshots.length > 0 ? `${uploadedScreenshots.length} Screenshot(s)` : '& Log Event'}
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
