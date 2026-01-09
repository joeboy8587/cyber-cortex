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
  Activity,
  Database,
  Calendar
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

interface ExifMetadata {
  dateTimeOriginal: string | null;
  dateTimeDigitized: string | null;
  modifyDate: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  make: string | null;
  model: string | null;
  software: string | null;
}

interface WatchtowerEvent {
  id: string;
  timestamp: string;
  exifTimestamp: string | null;
  event_type: string;
  location: string;
  tags: string[];
  flight_data: ExtractedFlightData | null;
  biometrics: BiometricData | null;
  josiah_reflection: string;
  screenshot_url: string | null;
  status: 'processing' | 'complete' | 'error';
  neonSynced: boolean;
  exifMetadata: ExifMetadata | null;
}

interface UploadedScreenshot {
  id: string;
  dataUrl: string;
  filename: string;
  exifData: ExifMetadata | null;
  file: File;
}

interface NeonSyncStatus {
  totalRecords: number;
  lastSync: string | null;
  pendingUploads: number;
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
  const [neonStatus, setNeonStatus] = useState<NeonSyncStatus>({
    totalRecords: 0,
    lastSync: null,
    pendingUploads: 0
  });

  // Extract EXIF metadata from image file
  const extractExifData = useCallback(async (file: File): Promise<ExifMetadata> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const dataView = new DataView(arrayBuffer);
          
          let exifData: ExifMetadata = {
            dateTimeOriginal: null,
            dateTimeDigitized: null,
            modifyDate: null,
            gpsLatitude: null,
            gpsLongitude: null,
            make: null,
            model: null,
            software: null
          };
          
          let foundExif = false;
          
          // Check for JPEG marker (0xFFD8)
          if (dataView.byteLength >= 2 && dataView.getUint16(0) === 0xFFD8) {
            console.log('[EXIF] Detected JPEG format');
            let offset = 2;
            
            while (offset < dataView.byteLength - 4) {
              try {
                const marker = dataView.getUint16(offset);
                
                // Check for APP1 marker (EXIF)
                if (marker === 0xFFE1) {
                  const segmentLength = dataView.getUint16(offset + 2);
                  const exifStart = offset + 4;
                  
                  // Check for "Exif\0\0" header
                  if (dataView.byteLength > exifStart + 6) {
                    const exifHeader = String.fromCharCode(
                      dataView.getUint8(exifStart),
                      dataView.getUint8(exifStart + 1),
                      dataView.getUint8(exifStart + 2),
                      dataView.getUint8(exifStart + 3)
                    );
                    
                    if (exifHeader === 'Exif') {
                      console.log('[EXIF] Found EXIF header');
                      const tiffStart = exifStart + 6;
                      const littleEndian = dataView.getUint16(tiffStart) === 0x4949;
                      
                      // Get IFD0 offset
                      const ifd0Offset = dataView.getUint32(tiffStart + 4, littleEndian);
                      
                      if (tiffStart + ifd0Offset + 2 < dataView.byteLength) {
                        const numEntries = dataView.getUint16(tiffStart + ifd0Offset, littleEndian);
                        
                        // Parse IFD entries
                        for (let i = 0; i < Math.min(numEntries, 50); i++) {
                          const entryOffset = tiffStart + ifd0Offset + 2 + i * 12;
                          if (entryOffset + 12 > dataView.byteLength) break;
                          
                          const tag = dataView.getUint16(entryOffset, littleEndian);
                          const type = dataView.getUint16(entryOffset + 2, littleEndian);
                          const count = dataView.getUint32(entryOffset + 4, littleEndian);
                          
                          // DateTime tag (0x0132) or DateTimeOriginal (0x9003) or DateTimeDigitized (0x9004)
                          if (tag === 0x0132 || tag === 0x9003 || tag === 0x9004) {
                            const valueOffset = count <= 4 
                              ? entryOffset + 8 
                              : tiffStart + dataView.getUint32(entryOffset + 8, littleEndian);
                            
                            if (valueOffset + 19 <= dataView.byteLength) {
                              let dateStr = '';
                              for (let j = 0; j < 19; j++) {
                                const char = dataView.getUint8(valueOffset + j);
                                if (char === 0) break;
                                dateStr += String.fromCharCode(char);
                              }
                              
                              if (dateStr.length >= 10) {
                                // Convert "YYYY:MM:DD HH:MM:SS" to ISO format
                                const isoDate = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
                                console.log(`[EXIF] Found date tag 0x${tag.toString(16)}: ${isoDate}`);
                                
                                if (tag === 0x9003) exifData.dateTimeOriginal = isoDate;
                                else if (tag === 0x9004) exifData.dateTimeDigitized = isoDate;
                                else exifData.modifyDate = isoDate;
                                foundExif = true;
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                  break;
                }
                
                // Move to next marker
                if ((marker & 0xFF00) !== 0xFF00) break;
                const segmentLength = dataView.getUint16(offset + 2);
                offset += 2 + segmentLength;
              } catch (parseErr) {
                console.error('[EXIF] Parse error at offset', offset, parseErr);
                break;
              }
            }
          }
          // Check for PNG (screenshots are often PNG)
          else if (dataView.byteLength >= 8 && 
                   dataView.getUint32(0) === 0x89504E47 && 
                   dataView.getUint32(4) === 0x0D0A1A0A) {
            console.log('[EXIF] Detected PNG format (no native EXIF support)');
            // PNG doesn't have EXIF, use file metadata
          }
          
          // Use file's lastModified as the timestamp source
          // This is reliable for screenshots as it captures when the file was created
          if (!foundExif && file.lastModified) {
            const fileDate = new Date(file.lastModified);
            exifData.modifyDate = fileDate.toISOString();
            console.log(`[EXIF] Using file.lastModified: ${exifData.modifyDate}`);
          }
          
          // Prioritize dateTimeOriginal if found
          const bestTimestamp = exifData.dateTimeOriginal || exifData.dateTimeDigitized || exifData.modifyDate;
          console.log(`[EXIF] Best timestamp for ${file.name}: ${bestTimestamp}`);
          
          resolve(exifData);
        } catch (err) {
          console.error('[EXIF] Extraction error:', err);
          // Fallback to file metadata
          const fallbackDate = file.lastModified ? new Date(file.lastModified).toISOString() : null;
          console.log(`[EXIF] Fallback to file.lastModified: ${fallbackDate}`);
          resolve({
            dateTimeOriginal: null,
            dateTimeDigitized: null,
            modifyDate: fallbackDate,
            gpsLatitude: null,
            gpsLongitude: null,
            make: null,
            model: null,
            software: null
          });
        }
      };
      reader.onerror = () => {
        console.error('[EXIF] FileReader error');
        resolve({
          dateTimeOriginal: null,
          dateTimeDigitized: null,
          modifyDate: file.lastModified ? new Date(file.lastModified).toISOString() : null,
          gpsLatitude: null,
          gpsLongitude: null,
          make: null,
          model: null,
          software: null
        });
      };
      reader.readAsArrayBuffer(file);
    });
  }, []);

  // Fetch Neon DB sync status
  const fetchNeonStatus = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `SELECT COUNT(*) as count FROM josiah_reflections_rows`
        }
      });
      const rows = Array.isArray(data) ? data : data?.data || [];
      setNeonStatus(prev => ({
        ...prev,
        totalRecords: parseInt(rows[0]?.count) || 0,
        lastSync: new Date().toISOString()
      }));
    } catch (err) {
      console.error('Neon status fetch error:', err);
    }
  }, []);

  // Fetch recent events on mount
  useEffect(() => {
    fetchRecentEvents();
    fetchNeonStatus();
  }, [fetchNeonStatus]);

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
          exifTimestamp: row.exif_timestamp || null,
          event_type: row.pattern_type || 'Surveillance Event',
          location: row.location || 'Unknown',
          tags: row.tags || [],
          flight_data: row.aircraft_data ? (typeof row.aircraft_data === 'string' ? JSON.parse(row.aircraft_data) : row.aircraft_data) : null,
          biometrics: row.biometric_data ? (typeof row.biometric_data === 'string' ? JSON.parse(row.biometric_data) : row.biometric_data) : null,
          josiah_reflection: row.reflection_text || '',
          screenshot_url: row.screenshot_url || null,
          status: 'complete' as const,
          neonSynced: true,
          exifMetadata: row.exif_metadata ? (typeof row.exif_metadata === 'string' ? JSON.parse(row.exif_metadata) : row.exif_metadata) : null
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
        
        // Extract EXIF metadata
        const exifData = await extractExifData(file);
        
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        newScreenshots.push({
          id: crypto.randomUUID(),
          dataUrl: base64,
          filename: file.name,
          exifData,
          file
        });
      }
      
      // Count files with timestamps
      const withTimestamps = newScreenshots.filter(s => 
        s.exifData?.dateTimeOriginal || s.exifData?.dateTimeDigitized || s.exifData?.modifyDate
      );
      const withExifDate = newScreenshots.filter(s => s.exifData?.dateTimeOriginal || s.exifData?.dateTimeDigitized);
      
      setUploadedScreenshots(prev => [...prev, ...newScreenshots]);
      setUploading(false);
      
      // Show what timestamp source was found
      let description = '';
      if (withExifDate.length > 0) {
        description = `EXIF camera timestamps from ${withExifDate.length} file(s)`;
      } else if (withTimestamps.length > 0) {
        description = `File modification timestamps from ${withTimestamps.length} file(s)`;
      } else {
        description = "No timestamps found - will use current time";
      }
      
      toast({
        title: `${newScreenshots.length} Screenshot(s) Uploaded`,
        description,
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
  }, [toast, extractExifData]);

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
    const processingEvents: WatchtowerEvent[] = uploadedScreenshots.map((screenshot, idx) => ({
      id: screenshot.id,
      timestamp: screenshot.exifData?.dateTimeOriginal || screenshot.exifData?.modifyDate || new Date(baseTimestamp.getTime() + idx * 1000).toISOString(),
      exifTimestamp: screenshot.exifData?.dateTimeOriginal || screenshot.exifData?.modifyDate || null,
      event_type: `Processing (${idx + 1}/${uploadedScreenshots.length})...`,
      location,
      tags: ['Processing'],
      flight_data: null,
      biometrics: null,
      josiah_reflection: `Analyzing screenshot ${idx + 1}...`,
      screenshot_url: screenshot.dataUrl,
      status: 'processing' as const,
      neonSynced: false,
      exifMetadata: screenshot.exifData
    }));
    setEvents(prev => [...processingEvents, ...prev]);

    try {
      // Process each screenshot
      for (let i = 0; i < uploadedScreenshots.length; i++) {
        const screenshot = uploadedScreenshots[i];
        // Use EXIF timestamp if available, otherwise use current time
        const exifTs = screenshot.exifData?.dateTimeOriginal || screenshot.exifData?.modifyDate;
        const timestamp = exifTs || new Date(baseTimestamp.getTime() + i * 1000).toISOString();

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
              additionalNotes: `${additionalNotes} [Screenshot ${i + 1} of ${uploadedScreenshots.length}]${exifTs ? ` [EXIF Timestamp: ${exifTs}]` : ''}`,
              timestamp,
              exifMetadata: screenshot.exifData
            }
          });

          if (aiError) throw aiError;

          const extractedData = aiResponse?.data || aiResponse;
          
          // Create the complete event
          const completeEvent: WatchtowerEvent = {
            id: screenshot.id,
            timestamp,
            exifTimestamp: exifTs || null,
            event_type: extractedData?.event_type || 'Surveillance Detection',
            location,
            tags: [
              ...(extractedData?.tags || ['F24 Analysis', 'Watchtower', `Batch ${i + 1}`]),
              exifTs ? 'EXIF_VERIFIED' : 'NO_EXIF'
            ],
            flight_data: extractedData?.flight_data || null,
            biometrics: {
              heart_rate: parseInt(manualBiometrics.heart_rate) || 0,
              hrv: parseInt(manualBiometrics.hrv) || 0,
              status: extractedData?.biometric_status || 'Logged',
              interpretation: extractedData?.biometric_interpretation || ''
            },
            josiah_reflection: extractedData?.josiah_reflection || 'Analysis complete.',
            screenshot_url: screenshot.dataUrl,
            status: 'complete',
            neonSynced: false,
            exifMetadata: screenshot.exifData
          };

          processedEvents.push(completeEvent);

          // Update the event in state
          setEvents(prev => prev.map(e => e.id === screenshot.id ? completeEvent : e));

          // Store in Neon for persistence
          const { data: insertResult, error: insertError } = await supabase.functions.invoke('neon-query', {
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
                created_at: timestamp,
                exif_timestamp: exifTs || null,
                exif_metadata: JSON.stringify(screenshot.exifData || {})
              }
            }
          });

          if (insertError) {
            console.error('Neon insert error:', insertError);
          } else {
            // Mark as synced
            setEvents(prev => prev.map(e => 
              e.id === screenshot.id ? { ...e, neonSynced: true } : e
            ));
          }

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
                  detected_at: timestamp,
                  exif_verified: !!exifTs
                }
              }
            });
          }
        } catch (err) {
          console.error(`Analysis error for screenshot ${i + 1}:`, err);
          setEvents(prev => prev.map(e => 
            e.id === screenshot.id 
              ? { ...e, status: 'error' as const, josiah_reflection: 'Analysis failed.', neonSynced: false }
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

      // Refresh Neon status
      await fetchNeonStatus();

      const successCount = processedEvents.filter(e => e.status === 'complete').length;
      const exifCount = processedEvents.filter(e => e.exifTimestamp).length;
      
      toast({
        title: "Batch Analysis Complete",
        description: `${successCount}/${uploadedScreenshots.length} analyzed • ${exifCount} with EXIF timestamps • Synced to Neon DB`,
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
                        <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-[10px] text-center px-1 py-0.5">
                          <span className="text-cyan-400 truncate block">{screenshot.filename}</span>
                          {screenshot.exifData?.dateTimeOriginal ? (
                            <span className="text-green-400 flex items-center justify-center gap-0.5">
                              <Calendar className="h-2.5 w-2.5" />
                              EXIF: {new Date(screenshot.exifData.dateTimeOriginal).toLocaleDateString()}
                            </span>
                          ) : screenshot.exifData?.modifyDate ? (
                            <span className="text-yellow-400 flex items-center justify-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              File: {new Date(screenshot.exifData.modifyDate).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-cyan-400/70">
                      {uploadedScreenshots.length} screenshot(s) ready
                    </span>
                    <span className={`flex items-center gap-1 ${
                      uploadedScreenshots.filter(s => s.exifData?.dateTimeOriginal || s.exifData?.modifyDate).length > 0 
                        ? 'text-green-400' : 'text-yellow-400'
                    }`}>
                      <Calendar className="h-3 w-3" />
                      {uploadedScreenshots.filter(s => s.exifData?.dateTimeOriginal).length} EXIF / {uploadedScreenshots.filter(s => s.exifData?.modifyDate && !s.exifData?.dateTimeOriginal).length} File
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <Camera className="h-12 w-12 text-cyan-400/50" />
                  <span className="text-cyan-400/70 text-sm">
                    {uploading ? 'Extracting timestamps...' : 'Upload FlightRadar24 Screenshot(s)'}
                  </span>
                  <span className="text-cyan-400/50 text-xs">
                    Extracts EXIF camera dates or file modification times
                  </span>
                </>
              )}
            </label>
          </div>

          {/* Neon DB Status */}
          <div className="flex items-center justify-between p-2 rounded bg-black/30 border border-cyan-500/20">
            <div className="flex items-center gap-2 text-xs">
              <Database className="h-4 w-4 text-cyan-400" />
              <span className="text-cyan-400/70">Neon DB Status</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-cyan-400">
                {neonStatus.totalRecords.toLocaleString()} records
              </span>
              {neonStatus.lastSync && (
                <span className="text-green-400 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Synced
                </span>
              )}
            </div>
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
                      <div className="flex flex-col items-end text-xs">
                        <span className="text-cyan-400/50">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </span>
                        {event.exifTimestamp && (
                          <span className="text-green-400 flex items-center gap-1 text-[10px]">
                            <Calendar className="h-2.5 w-2.5" />
                            EXIF
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Location + Neon Sync Status */}
                    <div className="flex items-center justify-between text-xs mb-2">
                      <div className="flex items-center gap-1 text-cyan-400/70">
                        <MapPin className="h-3 w-3" />
                        {event.location}
                      </div>
                      <div className={`flex items-center gap-1 ${event.neonSynced ? 'text-green-400' : 'text-yellow-400'}`}>
                        <Database className="h-3 w-3" />
                        {event.neonSynced ? 'Synced' : 'Pending'}
                      </div>
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
