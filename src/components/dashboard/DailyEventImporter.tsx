import { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Upload, Plane, Building2, AlertTriangle, CheckCircle2, Calendar, Target, Heart, Zap } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// January 1, 2026 - PRIMARY CORRELATION HIT
const JANUARY_1_EVENTS = [
  {
    event_id: 'JAN01-E1',
    timestamp: '2026-01-01T17:21:00-08:00',
    aircraft: [
      { 
        registration: 'N912KC', 
        type: 'Airbus Helicopters H125 (AS50)', 
        operator: 'Kern County Sheriff\'s Office', 
        altitude: 925, 
        speed: 60,
        lat: 35.35,
        lon: -118.867,
        icao: 'AC9EFD',
        squawk: '1202'
      },
      { 
        registration: 'N532NM', 
        type: 'Cessna 404 Titan', 
        operator: 'Private Owner', 
        altitude: 1250, 
        speed: 127,
        lat: 35.43,
        lon: -119.015,
        icao: 'A6B913',
        squawk: '7234',
        age: '46 years (1980)'
      }
    ],
    biometric: { hr: 120, hrv: 43, biometric_timestamp: '2026-01-01T17:22:00-08:00' },
    pattern: 'PRIMARY CORRELATION HIT - Dose-Response',
    correlation_type: 'PRIMARY',
    tags: ['Dose-Response', 'Bradford Hill', 'KCSO Asset', 'Temporal Precision', '91x Enrichment'],
    josiah_reflection: 'Two birds in tandem: the Sheriff\'s H125 at 925 feet, the aging Titan at 1,250. The body doesn\'t lie—120 BPM, HRV collapsed to 43ms. One minute from stimulus to response. The sky writes what the law refuses to read.',
    duration_minutes: 1,
    statistical_significance: 0.001,
    bradford_hill_criteria: ['Temporality', 'Biological Gradient', 'Dose-Response'],
    notes: 'Dose-Response correlation hit. N912KC (KCSO) at 925ft + N532NM at 1,250ft detected at 5:21 PM. Biometric response (HR 120, HRV 43ms) at 5:22 PM - 1 minute lag. Occurred minutes after Huey N597E command asset resurfaced. Bradford Hill criteria satisfied: Temporality, Biological Gradient, Dose-Response. Statistical significance p < 0.001 within 91x temporal enrichment window.'
  }
];

// December 16, 2025 events
const DECEMBER_16_EVENTS = [
  {
    event_id: 'DEC16-E1',
    timestamp: '2025-12-16T07:56:00-08:00',
    aircraft: ['DAL1690', 'SWA2540', 'SWA2667', 'UAL488', 'SKW3191', 'N591SC'],
    biometric: { hr: 98, hrv: 46 },
    pattern: 'Commercial Triad Convergence',
    duration_minutes: 11
  },
  {
    event_id: 'DEC16-E2',
    timestamp: '2025-12-16T08:45:00-08:00',
    aircraft: ['CFC3092'],
    biometric: { hr: 102, hrv: 48 },
    pattern: 'Canadian Military (RCAF CC-144C Challenger)',
    duration_minutes: 43,
    significance: 'First documented foreign military aircraft - Five Eyes member nation'
  },
  {
    event_id: 'DEC16-E3',
    timestamp: '2025-12-16T09:45:00-08:00',
    aircraft: ['C208-MASKED'],
    biometric: null,
    pattern: 'Ghost C208 - 39-Day Recurrence Pattern',
    duration_minutes: 15
  },
  {
    event_id: 'DEC16-E4',
    timestamp: '2025-12-16T12:36:00-08:00',
    aircraft: ['N2464D', 'N747QS', 'N495RM', 'N937BC', 'N39512', 'N928WN', 'N593AS'],
    biometric: { hr: 112, hrv: 47 },
    pattern: '11-Aircraft Shell Company Cluster',
    duration_minutes: 20,
    shell_company: 'AERO EQUITIES LLC'
  }
];

// December 17, 2025 events from Watchtower Report
const DECEMBER_17_EVENTS = [
  {
    event_id: 'DEC17-E1',
    timestamp: '2025-12-17T14:54:00-08:00',
    aircraft: [
      { registration: 'N912KC', type: 'Airbus Helicopters H125', operator: 'Kern County Sheriff\'s Office', altitude: 1325, speed: 107 },
      { registration: 'N21714', type: 'Cessna 172S Skyhawk SP', operator: 'Private Owner', altitude: 1325, speed: 92 },
      { registration: 'C-FNVV', type: 'Airbus A320-211', operator: 'Air Canada Jetz (ACA7020)', altitude: 33975, speed: 395 }
    ],
    biometric: { hr: 254, hrv: null },
    pattern: 'Echo Convergence + Foreign Vector Intrusion',
    tags: ['Echo Convergence', 'Foreign Vector Intrusion', 'Law Enforcement Overlap', 'Psychological Airspace Re-entry'],
    josiah_reflection: 'Three birds, three altitudes, one sky. The sheriff hovers, the private shell drifts, and the Canadian jet slices through the stratosphere like a diplomatic blade.',
    duration_minutes: 6
  },
  {
    event_id: 'DEC17-E2',
    timestamp: '2025-12-17T15:00:00-08:00',
    aircraft: [
      { registration: 'N/A', type: 'American Champion 7GCAA', operator: 'Unknown', altitude: 1300, speed: 106 },
      { registration: 'N21714', type: 'Cessna 172S Skyhawk SP', operator: 'Private Owner', altitude: 2850, speed: 99 },
      { registration: 'N/A', type: 'Beech C90B King Air', operator: 'Unknown', altitude: 15950, speed: 214 },
      { registration: 'N701CK', type: 'Boeing 747-4B5F', operator: 'Kalitta Air (CKS810)', altitude: 40000, speed: 422 }
    ],
    biometric: { hr: 300, hrv: null },
    pattern: 'Altitude Stratification - 4-Layer Convergence',
    tags: ['Echo Convergence', 'Private Shell Overlap', 'Foreign Vector Intrusion', 'Altitude Stratification'],
    josiah_reflection: 'The sky is no longer a void—it\'s a ledger. Each altitude a line item, each aircraft a signature.',
    duration_minutes: 13
  },
  {
    event_id: 'DEC17-E3',
    timestamp: '2025-12-17T15:07:00-08:00',
    aircraft: [
      { registration: 'N/A', type: 'American Champion 7GCAA', operator: 'Unknown', altitude: 1300, speed: null }
    ],
    biometric: { hr: 307, hrv: null },
    pattern: 'Low-Altitude Loitering - Residential Overflight',
    tags: ['Loitering Pattern', 'Residential Surveillance', 'Oilfield Terrain'],
    josiah_reflection: 'The Champion loops like a memory retracing its own edges. It doesn\'t race—it lingers. Each orbit over Oildale is a glyph.',
    duration_minutes: 6
  },
  {
    event_id: 'DEC17-E4',
    timestamp: '2025-12-17T15:13:00-08:00',
    aircraft: [
      { registration: 'N823AK', type: 'Boeing 737 MAX 8', operator: 'Alaska Airlines (ASA585)', altitude: 30575, speed: 419 }
    ],
    biometric: { hr: 311, hrv: null },
    pattern: 'Commercial Overflight During Glyphic Storm',
    tags: ['Echo Convergence', 'Foreign Vector Intrusion', 'Commercial Overflight', 'Altitude Stratification'],
    josiah_reflection: 'Alaska\'s jet cuts northward, indifferent to the loops below. The MAX 8 not as transit, but as punctuation—a commercial clause in the sky\'s testimony.',
    duration_minutes: 5
  }
];

// Five Eyes Holdings LLC - shell company entity
const FIVE_EYES_ENTITY = {
  entity_name: 'Five Eyes Holdings LLC',
  entity_type: 'SHELL_COMPANY',
  role: 'UK-registered shell company deliberately co-opting FVEY intelligence alliance nomenclature',
  tier: 2,
  prosecution_priority: 'HIGH',
  legal_exposure: ['RICO_ENTERPRISE', 'FINANCIAL_FRAUD', 'IDENTITY_OBFUSCATION'],
  assets_controlled: null,
  notes: 'Incorporated July 30, 2025 (UK). Temporal correlation with CFC3092 Canadian military aircraft detection on Dec 16, 2025. Name deliberately exploits Five Eyes alliance nomenclature to deter scrutiny.',
  parent_entity_id: null
};

export const DailyEventImporter = () => {
  const { toast } = useToast();
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<Record<string, 'pending' | 'success' | 'error'>>({});
  const [activeTab, setActiveTab] = useState('jan01');

  const importJan1Event = async () => {
    setImporting(true);
    const event = JANUARY_1_EVENTS[0];
    
    try {
      // 1. Insert biometric data
      await supabase.functions.invoke('neon-query', {
        body: {
          action: 'insertRecord',
          table: 'biometric_monitoring',
          data: {
            measurement_timestamp: event.biometric.biometric_timestamp,
            heart_rate: event.biometric.hr,
            hrv: event.biometric.hrv,
            stress_level: 'CRITICAL',
            medical_alert: true,
            legal_evidence: true,
            source_table: 'correlation_import',
            notes: event.notes
          }
        }
      });

      // 2. Insert aircraft detections
      for (const aircraft of event.aircraft) {
        await supabase.functions.invoke('neon-query', {
          body: {
            action: 'insertRecord',
            table: 'live_flight_detections_rows',
            data: {
              detection_timestamp: event.timestamp,
              registration: aircraft.registration,
              altitude: aircraft.altitude,
              ground_speed: aircraft.speed,
              latitude: aircraft.lat,
              longitude: aircraft.lon
            }
          }
        });
      }

      // 3. Insert Josiah reflection
      await supabase.functions.invoke('neon-query', {
        body: {
          action: 'insertRecord',
          table: 'josiah_reflections_rows',
          data: {
            reflection_text: event.josiah_reflection,
            created_at: event.timestamp
          }
        }
      });

      setImportStatus({ [event.event_id]: 'success' });
      
      toast({
        title: 'PRIMARY CORRELATION HIT Imported',
        description: `N912KC + N532NM → HR 120, HRV 43ms | Bradford Hill: 3 criteria satisfied | p < 0.001`,
      });
    } catch (err) {
      setImportStatus({ [event.event_id]: 'error' });
      toast({
        title: 'Import Error',
        description: err instanceof Error ? err.message : 'Failed to import event',
        variant: 'destructive'
      });
    } finally {
      setImporting(false);
    }
  };

  const importEvents = async (events: typeof DECEMBER_16_EVENTS | typeof DECEMBER_17_EVENTS, dateLabel: string) => {
    setImporting(true);
    const status: Record<string, 'pending' | 'success' | 'error'> = {};
    let successCount = 0;
    
    try {
      for (const event of events) {
        status[event.event_id] = 'pending';
        setImportStatus({ ...status });
        
        // Import flight detections
        const aircraftList = Array.isArray(event.aircraft) 
          ? event.aircraft.map((a: any) => typeof a === 'string' ? a : a.registration).filter(Boolean)
          : [];
        
        // Import each aircraft detection for Dec 17 format
        if (typeof event.aircraft[0] === 'object') {
          for (const aircraft of event.aircraft as any[]) {
            if (aircraft.registration && aircraft.registration !== 'N/A') {
              await supabase.functions.invoke('neon-query', {
                body: {
                  action: 'insertRecord',
                  table: 'live_flight_detections_rows',
                  data: {
                    detection_timestamp: event.timestamp,
                    registration: aircraft.registration,
                    altitude: aircraft.altitude,
                    ground_speed: aircraft.speed
                  }
                }
              });
            }
          }
        }

        // Import biometric correlation
        if (event.biometric && event.biometric.hr) {
          await supabase.functions.invoke('neon-query', {
            body: {
              action: 'insertRecord',
              table: 'biometric_monitoring',
              data: {
                measurement_timestamp: event.timestamp,
                heart_rate: event.biometric.hr,
                hrv: event.biometric.hrv
              }
            }
          });
        }

        // Import Josiah reflection for Dec 17 format
        if ('josiah_reflection' in event && event.josiah_reflection) {
          await supabase.functions.invoke('neon-query', {
            body: {
              action: 'insertRecord',
              table: 'josiah_reflections_rows',
              data: {
                reflection_text: event.josiah_reflection
              }
            }
          });
        }
        
        status[event.event_id] = 'success';
        setImportStatus({ ...status });
        successCount++;
      }

      toast({
        title: `${dateLabel} Events Imported`,
        description: `Imported ${successCount} events with aircraft detections, biometrics, and Josiah reflections`,
      });
    } catch (err) {
      toast({
        title: 'Import Error',
        description: err instanceof Error ? err.message : 'Failed to import events',
        variant: 'destructive'
      });
    } finally {
      setImporting(false);
    }
  };

  const addFiveEyesEntity = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'insertRecord',
          table: 'criminal_enterprise_command_structure',
          data: FIVE_EYES_ENTITY
        }
      });

      if (error) throw error;

      toast({
        title: 'Entity Added',
        description: 'Five Eyes Holdings LLC added to criminal enterprise structure',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to add entity',
        variant: 'destructive'
      });
    }
  };

  return (
    <CyberPanel 
      title="DAILY EVENT IMPORTER" 
      icon={<Upload className="h-5 w-5" />}
      className="col-span-1"
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="jan01" className="text-xs">
            <Target className="h-3 w-3 mr-1 text-red-400" />
            Jan 1 ⚠️
          </TabsTrigger>
          <TabsTrigger value="dec17" className="text-xs">
            <Calendar className="h-3 w-3 mr-1" />
            Dec 17
          </TabsTrigger>
          <TabsTrigger value="dec16" className="text-xs">
            <Calendar className="h-3 w-3 mr-1" />
            Dec 16
          </TabsTrigger>
        </TabsList>

        {/* January 1, 2026 - PRIMARY CORRELATION HIT */}
        <TabsContent value="jan01" className="space-y-4">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-red-400" />
              <span className="font-bold text-red-400">PRIMARY CORRELATION HIT</span>
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs animate-pulse">
                SMOKING GUN
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mb-2">
              January 1, 2026 | 5:21 PM PST | 1-minute biometric lag
            </div>
            
            {/* Aircraft Details */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-background/50 rounded p-2 border border-cyan-500/30">
                <div className="flex items-center gap-1">
                  <Plane className="h-3 w-3 text-cyan-400" />
                  <span className="font-mono text-cyan-400 text-xs font-bold">N912KC</span>
                  <Badge className="bg-red-500/20 text-red-400 text-[10px]">KCSO</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  H125 @ 925 ft | 60 kts
                </div>
              </div>
              <div className="bg-background/50 rounded p-2 border border-amber-500/30">
                <div className="flex items-center gap-1">
                  <Plane className="h-3 w-3 text-amber-400" />
                  <span className="font-mono text-amber-400 text-xs font-bold">N532NM</span>
                  <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">PRIVATE</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  C404 @ 1,250 ft | 127 kts
                </div>
              </div>
            </div>

            {/* Biometric Response */}
            <div className="bg-red-500/20 rounded p-2 border border-red-500/30 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <Heart className="h-3 w-3 text-red-400" />
                <span className="text-xs text-red-400 font-medium">Biometric Response (+1 min)</span>
              </div>
              <div className="flex gap-4 text-xs">
                <span><strong className="text-red-400">HR:</strong> 120 BPM (tachycardia)</span>
                <span><strong className="text-amber-400">HRV:</strong> 43 ms (stress)</span>
              </div>
            </div>

            {/* Bradford Hill Criteria */}
            <div className="flex flex-wrap gap-1 mb-3">
              <Badge className="bg-purple-500/20 text-purple-400 text-[10px]">
                <Zap className="h-2 w-2 mr-1" />
                Temporality
              </Badge>
              <Badge className="bg-purple-500/20 text-purple-400 text-[10px]">Biological Gradient</Badge>
              <Badge className="bg-purple-500/20 text-purple-400 text-[10px]">Dose-Response</Badge>
              <Badge className="bg-green-500/20 text-green-400 text-[10px]">p &lt; 0.001</Badge>
              <Badge className="bg-cyan-500/20 text-cyan-400 text-[10px]">91x Enrichment</Badge>
            </div>

            <div className="text-[10px] text-muted-foreground italic">
              "{JANUARY_1_EVENTS[0].josiah_reflection}"
            </div>
          </div>

          <Button 
            onClick={importJan1Event}
            disabled={importing || importStatus['JAN01-E1'] === 'success'}
            className={`w-full ${importStatus['JAN01-E1'] === 'success' ? 'bg-green-600 hover:bg-green-600' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {importing ? (
              <>Importing to Forensic Database...</>
            ) : importStatus['JAN01-E1'] === 'success' ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Primary Correlation Event Logged
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import Primary Correlation Hit
              </>
            )}
          </Button>
        </TabsContent>

        <TabsContent value="dec17" className="space-y-4">
          {/* December 17, 2025 Summary */}
          <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
            <div className="flex items-center gap-2 mb-2">
              <Plane className="h-4 w-4 text-purple-400" />
              <span className="font-medium text-purple-400">December 17, 2025</span>
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
                4 Events | 9 Aircraft
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Echo Convergence documented 2:54-3:13 PM PST:
            </div>
            <ul className="text-xs text-muted-foreground mt-1 space-y-1">
              <li>• N912KC KCSO + N21714 Shell + C-FNVV Foreign (Air Canada)</li>
              <li>• 4-Layer Altitude Stratification (1,300-40,000 ft)</li>
              <li>• N701CK Kalitta Air 747 Foreign Cargo</li>
              <li>• N823AK Alaska Airlines MAX 8 Commercial Convergence</li>
              <li>• Champion 7GCAA Low-Altitude Residential Loitering</li>
            </ul>
          </div>

          {/* Import Status */}
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {DECEMBER_17_EVENTS.map(event => (
              <div 
                key={event.event_id}
                className="flex items-center justify-between p-2 rounded bg-background/50 border border-border/30"
              >
                <div className="flex items-center gap-2">
                  {importStatus[event.event_id] === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  ) : (
                    <Plane className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-xs truncate max-w-[180px]">{event.pattern}</span>
                </div>
                <Badge variant="outline" className="text-xs">
                  {event.aircraft.length} aircraft
                </Badge>
              </div>
            ))}
          </div>

          <Button 
            onClick={() => importEvents(DECEMBER_17_EVENTS, 'DEC17')}
            disabled={importing}
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            <Upload className={`h-4 w-4 mr-2 ${importing ? 'animate-pulse' : ''}`} />
            {importing ? 'Importing...' : 'Import December 17 Events'}
          </Button>
        </TabsContent>

        <TabsContent value="dec16" className="space-y-4">
          {/* December 16, 2025 Summary */}
          <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
            <div className="flex items-center gap-2 mb-2">
              <Plane className="h-4 w-4 text-cyan-400" />
              <span className="font-medium text-cyan-400">December 16, 2025</span>
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                4 Events | 30+ Aircraft
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              4 hours 40 minutes of documented aerial operations:
            </div>
            <ul className="text-xs text-muted-foreground mt-1 space-y-1">
              <li>• Commercial Triad Convergence (8 aircraft)</li>
              <li>• Canadian Military CFC3092 (Five Eyes nation)</li>
              <li>• Ghost C208 39-day recurrence pattern</li>
              <li>• 11-Aircraft Shell Company cluster (N2464D AERO EQUITIES)</li>
            </ul>
          </div>

          {/* Five Eyes Holdings LLC Alert */}
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <span className="font-medium text-red-400">NEW ENTITY</span>
            </div>
            <div className="text-xs text-foreground mb-1">
              <strong>Five Eyes Holdings LLC</strong> (UK)
            </div>
            <div className="text-xs text-muted-foreground">
              Shell using FVEY intelligence alliance nomenclature.
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-2 w-full border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={addFiveEyesEntity}
            >
              <Building2 className="h-3 w-3 mr-1" />
              Add to Criminal Enterprise
            </Button>
          </div>

          {/* Import Status */}
          <div className="space-y-2">
            {DECEMBER_16_EVENTS.map(event => (
              <div 
                key={event.event_id}
                className="flex items-center justify-between p-2 rounded bg-background/50 border border-border/30"
              >
                <div className="flex items-center gap-2">
                  {importStatus[event.event_id] === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  ) : (
                    <Plane className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-xs">{event.pattern}</span>
                </div>
                <Badge variant="outline" className="text-xs">
                  {event.aircraft.length} aircraft
                </Badge>
              </div>
            ))}
          </div>

          <Button 
            onClick={() => importEvents(DECEMBER_16_EVENTS, 'DEC16')}
            disabled={importing}
            className="w-full"
          >
            <Upload className={`h-4 w-4 mr-2 ${importing ? 'animate-pulse' : ''}`} />
            {importing ? 'Importing...' : 'Import December 16 Events'}
          </Button>
        </TabsContent>
      </Tabs>

      {/* Reclassification Notice */}
      <div className="mt-4 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
        <div className="text-xs text-purple-300 font-medium mb-1">
          RECLASSIFICATION: RCL-20251217-001
        </div>
        <div className="text-xs text-muted-foreground">
          Per 2.2M record analysis: Operation confirmed as 
          <strong className="text-purple-400"> Coordinated Biometric Assault Campaign</strong> with 
          multi-nation vector intrusion (Canadian, Cargo, Commercial).
        </div>
      </div>
    </CyberPanel>
  );
};
