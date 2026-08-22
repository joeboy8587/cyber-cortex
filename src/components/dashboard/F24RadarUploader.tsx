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
  screenshotTimestampToUtcIso,
  pacificNaiveToUtc,
  formatPacific,
  formatUtc,
  pacificZoneLabel,
} from '@/lib/timezone';
import { correlateScreenshotWithAdsb, type CorrelationResult } from '@/lib/adsbCorrelation';

// exif-js is dynamically imported to avoid bundling issues
let EXIF: any = null;
const loadExifJs = async () => {
  if (!EXIF) {
    try {
      const module = await import('exif-js');
      EXIF = module.default || module;
    } catch (e) {
      console.warn('[EXIF] Failed to load exif-js library:', e);
    }
  }
  return EXIF;
};
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
  Calendar,
  Shield
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

// Forensic timestamp source priority (highest = most reliable)
type TimestampSource = 
  | 'EXIF_DATETIME_ORIGINAL'   // Priority 1: Camera capture time
  | 'EXIF_DATETIME_DIGITIZED'  // Priority 2: Digitization time  
  | 'EXIF_MODIFY_DATE'         // Priority 3: Last EXIF modification
  | 'FILENAME_PATTERN'         // Priority 4: Extracted from filename (UNRELIABLE - may be upload date)
  | 'FILE_LAST_MODIFIED'       // Priority 5: OS file modification (UNRELIABLE)
  | 'CURRENT_TIME';            // Priority 6: Fallback to now

interface ExifMetadata {
  dateTimeOriginal: string | null;
  dateTimeDigitized: string | null;
  modifyDate: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  make: string | null;
  model: string | null;
  software: string | null;
  timestampSource: TimestampSource;
  forensicNotes: string;
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
  /** Pacific local wall-clock string used as the source of truth for the capture. */
  capturedAtLocal: string | null;
  /** UTC instant derived from the Pacific capture time — this is what matches ADS-B. */
  capturedAtUtc: string | null;
  /** How the local capture time was established. */
  clockSource: 'EXIF' | 'SCREEN_CLOCK' | 'FILENAME' | 'FALLBACK' | null;
  adsb: CorrelationResult | null;
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

  // Parse timestamp from filename patterns like "Screenshot_20250613_002914.png"
  const extractTimestampFromFilename = useCallback((filename: string): { timestamp: string | null; pattern: string | null } => {
    // Common screenshot filename patterns
    const patterns = [
      // Android/Samsung: Screenshot_20250613_002914.png or Screenshot_2025-06-13-00-29-14.png
      { regex: /Screenshot[_-](\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/, format: 'YYYYMMDD_HHMMSS' },
      { regex: /Screenshot[_-](\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/, format: 'YYYY-MM-DD-HH-MM-SS' },
      // iOS: IMG_20250613_002914.PNG
      { regex: /IMG[_-](\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/, format: 'YYYYMMDD_HHMMSS' },
      // FlightRadar24 exports: FR24_N123AB_20250613_002914.jpg
      { regex: /FR24[^_]*[_-](\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/, format: 'YYYYMMDD_HHMMSS' },
      // Generic date patterns
      { regex: /(\d{4})-(\d{2})-(\d{2})[_T](\d{2})[:-](\d{2})[:-](\d{2})/, format: 'ISO' },
      { regex: /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, format: 'compact' },
    ];

    for (const { regex, format } of patterns) {
      const match = filename.match(regex);
      if (match) {
        const [, year, month, day, hour, min, sec] = match;
        const isoDate = `${year}-${month}-${day}T${hour}:${min}:${sec}`;
        console.log(`[EXIF] Filename pattern "${format}" extracted: ${isoDate} from "${filename}"`);
        return { timestamp: isoDate, pattern: format };
      }
    }
    return { timestamp: null, pattern: null };
  }, []);

  // Extract EXIF metadata using exif-js library (properly follows SubIFD for DateTimeOriginal)
  const extractExifData = useCallback(async (file: File): Promise<ExifMetadata> => {
    return new Promise((resolve) => {
      // Initialize result with fallback values
      const createResult = (
        data: Partial<ExifMetadata>,
        source: TimestampSource,
        notes: string
      ): ExifMetadata => ({
        dateTimeOriginal: data.dateTimeOriginal ?? null,
        dateTimeDigitized: data.dateTimeDigitized ?? null,
        modifyDate: data.modifyDate ?? null,
        gpsLatitude: data.gpsLatitude ?? null,
        gpsLongitude: data.gpsLongitude ?? null,
        make: data.make ?? null,
        model: data.model ?? null,
        software: data.software ?? null,
        timestampSource: source,
        forensicNotes: notes,
      });

      // Convert EXIF date format "YYYY:MM:DD HH:MM:SS" to ISO
      const parseExifDate = (dateStr: string | undefined): string | null => {
        if (!dateStr || typeof dateStr !== 'string') return null;
        // EXIF format: "2025:06:13 00:29:14"
        const match = dateStr.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
        if (match) {
          const [, year, month, day, hour, min, sec] = match;
          return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
        }
        return dateStr; // Return as-is if already in different format
      };

      // Fallback chain helper
      const fallbackToFilename = () => {
        const { timestamp: filenameTs, pattern } = extractTimestampFromFilename(file.name);
        if (filenameTs) {
          console.log(`[EXIF] ⚠ Using filename timestamp: ${filenameTs} (LESS RELIABLE - may be upload date)`);
          resolve(createResult({
            modifyDate: filenameTs,
          }, 'FILENAME_PATTERN', `WARNING: Timestamp extracted from filename pattern "${pattern}". May represent UPLOAD date, not capture date. Verify against other evidence.`));
        } else if (file.lastModified) {
          const fileDate = new Date(file.lastModified).toISOString();
          console.log(`[EXIF] ⚠ Falling back to file.lastModified: ${fileDate} (UNRELIABLE)`);
          resolve(createResult({
            modifyDate: fileDate,
          }, 'FILE_LAST_MODIFIED', `WARNING: Using OS file modification time. This changes when file is copied/moved. NOT forensically reliable.`));
        } else {
          console.log('[EXIF] ✗ No timestamp source available, using current time');
          resolve(createResult({
            modifyDate: new Date().toISOString(),
          }, 'CURRENT_TIME', `CRITICAL: No timestamp source found. Using upload time. Forensic value: NONE.`));
        }
      };

      // Use exif-js library to read EXIF data (properly traverses SubIFD)
      // Load library dynamically to avoid bundling issues
      loadExifJs().then((exifLib) => {
        if (!exifLib || typeof exifLib.getData !== 'function') {
          console.warn('[EXIF] exif-js library not available, using fallback');
          fallbackToFilename();
          return;
        }

        try {
          exifLib.getData(file as any, function(this: any) {
            const allTags = exifLib.getAllTags(this);
            
            console.log('[EXIF] Raw tags from exif-js:', Object.keys(allTags));
            
            const dateTimeOriginal = parseExifDate(allTags.DateTimeOriginal);
            const dateTimeDigitized = parseExifDate(allTags.DateTimeDigitized);
            const modifyDate = parseExifDate(allTags.DateTime);
            
            // GPS coordinates
            let gpsLatitude: number | null = null;
            let gpsLongitude: number | null = null;
            
            if (allTags.GPSLatitude && allTags.GPSLatitudeRef) {
              const lat = allTags.GPSLatitude;
              gpsLatitude = lat[0] + lat[1] / 60 + lat[2] / 3600;
              if (allTags.GPSLatitudeRef === 'S') gpsLatitude = -gpsLatitude;
            }
            if (allTags.GPSLongitude && allTags.GPSLongitudeRef) {
              const lng = allTags.GPSLongitude;
              gpsLongitude = lng[0] + lng[1] / 60 + lng[2] / 3600;
              if (allTags.GPSLongitudeRef === 'W') gpsLongitude = -gpsLongitude;
            }

            // Determine best timestamp and source
            if (dateTimeOriginal) {
              console.log(`[EXIF] ✓ DateTimeOriginal found: ${dateTimeOriginal} (FORENSIC GOLD)`);
              resolve(createResult({
                dateTimeOriginal,
                dateTimeDigitized,
                modifyDate,
                gpsLatitude,
                gpsLongitude,
                make: allTags.Make || null,
                model: allTags.Model || null,
                software: allTags.Software || null,
              }, 'EXIF_DATETIME_ORIGINAL', `Camera capture time verified from EXIF SubIFD. Device: ${allTags.Make || 'Unknown'} ${allTags.Model || ''}`));
              return;
            }

            if (dateTimeDigitized) {
              console.log(`[EXIF] DateTimeDigitized found: ${dateTimeDigitized}`);
              resolve(createResult({
                dateTimeDigitized,
                modifyDate,
                gpsLatitude,
                gpsLongitude,
                make: allTags.Make || null,
                model: allTags.Model || null,
                software: allTags.Software || null,
              }, 'EXIF_DATETIME_DIGITIZED', `Digitization time from EXIF. May differ from capture time.`));
              return;
            }

            if (modifyDate) {
              console.log(`[EXIF] DateTime (modify) found: ${modifyDate}`);
              resolve(createResult({
                modifyDate,
                gpsLatitude,
                gpsLongitude,
                make: allTags.Make || null,
                model: allTags.Model || null,
                software: allTags.Software || null,
              }, 'EXIF_MODIFY_DATE', `EXIF modify date only. Original capture time unknown.`));
              return;
            }

            // No EXIF dates found - use fallback
            console.log('[EXIF] No EXIF timestamp tags found, using fallback...');
            fallbackToFilename();
          });
        } catch (err) {
          console.error('[EXIF] Library error:', err);
          fallbackToFilename();
        }
      }).catch((err) => {
        console.error('[EXIF] Failed to load library:', err);
        fallbackToFilename();
      });
    });
  }, [extractTimestampFromFilename]);

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
      
      // Categorize by timestamp source quality
      const exifOriginal = newScreenshots.filter(s => s.exifData?.timestampSource === 'EXIF_DATETIME_ORIGINAL');
      const exifOther = newScreenshots.filter(s => 
        s.exifData?.timestampSource === 'EXIF_DATETIME_DIGITIZED' || 
        s.exifData?.timestampSource === 'EXIF_MODIFY_DATE'
      );
      const filenameExtracted = newScreenshots.filter(s => s.exifData?.timestampSource === 'FILENAME_PATTERN');
      const unreliable = newScreenshots.filter(s => 
        s.exifData?.timestampSource === 'FILE_LAST_MODIFIED' || 
        s.exifData?.timestampSource === 'CURRENT_TIME'
      );
      
      setUploadedScreenshots(prev => [...prev, ...newScreenshots]);
      setUploading(false);
      
      // Show forensic quality breakdown
      const parts: string[] = [];
      if (exifOriginal.length > 0) parts.push(`${exifOriginal.length} EXIF verified ✓`);
      if (exifOther.length > 0) parts.push(`${exifOther.length} EXIF partial`);
      if (filenameExtracted.length > 0) parts.push(`${filenameExtracted.length} from filename ⚠`);
      if (unreliable.length > 0) parts.push(`${unreliable.length} unreliable ✗`);
      
      toast({
        title: `${newScreenshots.length} Screenshot(s) Uploaded`,
        description: parts.join(' • ') || 'Processing timestamps...',
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
      exifMetadata: screenshot.exifData,
      capturedAtLocal: null,
      capturedAtUtc: null,
      clockSource: null,
      adsb: null
    }));
    setEvents(prev => [...processingEvents, ...prev]);

    try {
      // Process each screenshot
      for (let i = 0; i < uploadedScreenshots.length; i++) {
        const screenshot = uploadedScreenshots[i];
        // EXIF values are naive PACIFIC wall-clock strings, not UTC.
        const exifTs = screenshot.exifData?.dateTimeOriginal || screenshot.exifData?.modifyDate;
        const exifUtc = screenshotTimestampToUtcIso(exifTs || null);
        const timestamp = exifUtc || new Date(baseTimestamp.getTime() + i * 1000).toISOString();

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
              additionalNotes: `${additionalNotes} [Screenshot ${i + 1} of ${uploadedScreenshots.length}]${exifTs ? ` [EXIF local time: ${exifTs} Pacific]` : ''}`,
              timestamp,
              exifMetadata: screenshot.exifData
            }
          });

          if (aiError) throw aiError;

          const extractedData = aiResponse?.data || aiResponse;

          // ── Resolve the capture instant ────────────────────────────────
          // Priority: EXIF DateTimeOriginal > on-screen clock (paired with the
          // EXIF/filename date) > filename pattern > upload time. Everything the
          // phone shows is Pacific local; ADS-B tables are UTC.
          let capturedAtLocal: string | null = exifTs || null;
          let clockSource: WatchtowerEvent['clockSource'] =
            screenshot.exifData?.timestampSource === 'EXIF_DATETIME_ORIGINAL'
              ? 'EXIF'
              : screenshot.exifData?.timestampSource === 'FILENAME_PATTERN'
              ? 'FILENAME'
              : exifTs
              ? 'EXIF'
              : 'FALLBACK';

          const screenClock: string | null =
            extractedData?.track_clock_local || extractedData?.screen_clock_local || null;
          const useScreenClock =
            !!screenClock &&
            /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(screenClock).trim()) &&
            clockSource !== 'EXIF';
          if (useScreenClock) {
            const datePart =
              extractedData?.screen_date_local ||
              (capturedAtLocal ? capturedAtLocal.slice(0, 10) : new Date().toISOString().slice(0, 10));
            const [hh, mm, ss] = String(screenClock).trim().split(':');
            capturedAtLocal = `${datePart}T${hh.padStart(2, '0')}:${mm}:${ss || '00'}`;
            clockSource = 'SCREEN_CLOCK';
          }

          const capturedAtUtc =
            (capturedAtLocal ? pacificNaiveToUtc(capturedAtLocal)?.toISOString() : null) || timestamp;

          // ── Correlate against ADS-B evidence (UTC) ─────────────────────
          const adsb = await correlateScreenshotWithAdsb({
            capturedAtUtc,
            registration: extractedData?.flight_data?.registration,
            icao: extractedData?.flight_data?.icao,
            callsign: extractedData?.flight_data?.callsign,
            windowMinutes: 15
          });
          
          // Create the complete event with forensic timestamp source tag
          const timestampSource = screenshot.exifData?.timestampSource || 'CURRENT_TIME';
          const completeEvent: WatchtowerEvent = {
            id: screenshot.id,
            timestamp: capturedAtUtc,
            exifTimestamp: exifTs || null,
            event_type: extractedData?.event_type || 'Surveillance Detection',
            location,
            tags: [
              ...(extractedData?.tags || ['F24 Analysis', 'Watchtower', `Batch ${i + 1}`]),
              timestampSource, // Use exact source tag for forensic audit
              `CLOCK_${clockSource}`,
              adsb.identityMatches.length > 0 ? 'ADSB_MATCHED' : 'ADSB_UNMATCHED'
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
            exifMetadata: screenshot.exifData,
            capturedAtLocal,
            capturedAtUtc,
            clockSource,
            adsb
          };

          processedEvents.push(completeEvent);

          // Update the event in state
          setEvents(prev => prev.map(e => e.id === screenshot.id ? completeEvent : e));

          // Store in Neon for persistence with forensic timestamp audit trail
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
                created_at: capturedAtUtc,
                exif_timestamp: exifTs || null,
                exif_metadata: JSON.stringify({
                  ...(screenshot.exifData || {}),
                  capturedAtLocalPacific: capturedAtLocal,
                  capturedAtUtc,
                  clockSource,
                  pacificZone: capturedAtUtc ? pacificZoneLabel(new Date(capturedAtUtc)) : null,
                  adsbIdentityMatches: adsb.identityMatches.length,
                  adsbContextMatches: adsb.contextMatches.length
                }),
                timestamp_source: timestampSource, // Forensic audit: how was timestamp derived?
                forensic_notes: [
                  screenshot.exifData?.forensicNotes || '',
                  `Capture ${capturedAtLocal || 'unknown'} Pacific = ${capturedAtUtc} UTC (clock source: ${clockSource}).`,
                  adsb.identityMatches.length > 0
                    ? `ADS-B corroboration: ${adsb.identityMatches.length} identity match(es), closest ${adsb.identityMatches[0].delta_seconds}s.`
                    : `No ADS-B identity match within ±${adsb.windowMinutes} min; ${adsb.contextMatches.length} other aircraft in window.`
                ].filter(Boolean).join(' ')
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
      const exifVerified = processedEvents.filter(e => 
        e.exifMetadata?.timestampSource === 'EXIF_DATETIME_ORIGINAL'
      ).length;
      const partialExif = processedEvents.filter(e => 
        e.exifMetadata?.timestampSource === 'EXIF_DATETIME_DIGITIZED' || 
        e.exifMetadata?.timestampSource === 'EXIF_MODIFY_DATE'
      ).length;
      const unreliableTs = processedEvents.filter(e => 
        e.exifMetadata?.timestampSource === 'FILENAME_PATTERN' || 
        e.exifMetadata?.timestampSource === 'FILE_LAST_MODIFIED' ||
        e.exifMetadata?.timestampSource === 'CURRENT_TIME'
      ).length;
      
      const forensicSummary = [
        exifVerified > 0 ? `${exifVerified} forensic ✓` : null,
        partialExif > 0 ? `${partialExif} partial` : null,
        unreliableTs > 0 ? `${unreliableTs} unreliable ⚠` : null,
      ].filter(Boolean).join(' • ');
      
      toast({
        title: "Batch Analysis Complete",
        description: `${successCount}/${uploadedScreenshots.length} analyzed • ${forensicSummary || 'Check timestamp sources'} • Synced to Neon`,
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
