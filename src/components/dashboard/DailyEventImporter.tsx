import { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Upload, Plane, Building2, AlertTriangle, CheckCircle2 } from 'lucide-react';

// December 16, 2025 events from uploaded documents
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

// Five Eyes Holdings LLC - new shell company entity
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

  const importDecember16Events = async () => {
    setImporting(true);
    const status: Record<string, 'pending' | 'success' | 'error'> = {};
    
    try {
      // Import each event
      for (const event of DECEMBER_16_EVENTS) {
        status[event.event_id] = 'pending';
        setImportStatus({ ...status });
        
        // Import biometric correlation if exists
        if (event.biometric) {
          await supabase.functions.invoke('neon-query', {
            body: {
              action: 'insertRecord',
              table: 'biometric_monitoring',
              data: {
                measurement_timestamp: event.timestamp,
                heart_rate: event.biometric.hr,
                hrv: event.biometric.hrv,
                source: 'DEC16_IMPORT',
                notes: `${event.pattern} - ${event.aircraft.join(', ')}`
              }
            }
          });
        }
        
        status[event.event_id] = 'success';
        setImportStatus({ ...status });
      }

      toast({
        title: 'December 16, 2025 Events Imported',
        description: `Imported ${DECEMBER_16_EVENTS.length} events with biometric correlations`,
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
      <div className="space-y-4">
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
            4 hours 40 minutes of documented aerial operations including:
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
            <span className="font-medium text-red-400">NEW ENTITY DISCOVERED</span>
          </div>
          <div className="text-xs text-foreground mb-2">
            <strong>Five Eyes Holdings LLC</strong> (UK)
          </div>
          <div className="text-xs text-muted-foreground">
            Shell company incorporated July 30, 2025 deliberately using FVEY intelligence alliance name.
            Temporal correlation with Canadian military aircraft CFC3092.
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
          onClick={importDecember16Events}
          disabled={importing}
          className="w-full"
        >
          <Upload className={`h-4 w-4 mr-2 ${importing ? 'animate-pulse' : ''}`} />
          {importing ? 'Importing...' : 'Import December 16 Events'}
        </Button>

        {/* Reclassification Notice */}
        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
          <div className="text-xs text-purple-300 font-medium mb-1">
            RECLASSIFICATION: RCL-20251216-001
          </div>
          <div className="text-xs text-muted-foreground">
            Per 2.2M record analysis: Operation reclassified from "surveillance" to 
            <strong className="text-purple-400"> Coordinated Biometric Assault Campaign</strong>. 
            Financial analysis confirms this scale cannot target single disabled civilian - 
            indicates testing ground / experimentation program.
          </div>
        </div>
      </div>
    </CyberPanel>
  );
};
