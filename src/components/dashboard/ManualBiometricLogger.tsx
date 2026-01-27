import { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Heart, Activity, Save, Clock, AlertTriangle, CheckCircle2, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BiometricEntry {
  id: string;
  timestamp: string;
  heart_rate: number;
  hrv?: number;
  stress_level: string;
  notes?: string;
}

const STRESS_LEVELS = [
  { value: 'NORMAL', label: 'Normal', color: 'bg-green-500/20 text-green-400' },
  { value: 'ELEVATED', label: 'Elevated', color: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'HIGH', label: 'High', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'CRITICAL', label: 'Critical', color: 'bg-red-500/20 text-red-400' },
];

export const ManualBiometricLogger = () => {
  const [isLogging, setIsLogging] = useState(false);
  const [recentEntries, setRecentEntries] = useState<BiometricEntry[]>([]);
  
  // Form state
  const [heartRate, setHeartRate] = useState('');
  const [hrv, setHrv] = useState('');
  const [stressLevel, setStressLevel] = useState('NORMAL');
  const [notes, setNotes] = useState('');
  const [markAsEvidence, setMarkAsEvidence] = useState(false);
  const [markAsMedicalAlert, setMarkAsMedicalAlert] = useState(false);
  const [useCurrentTime, setUseCurrentTime] = useState(true);
  const [customTimestamp, setCustomTimestamp] = useState('');

  const validateHeartRate = (hr: number): boolean => {
    return hr >= 40 && hr <= 220;
  };

  const validateHrv = (hrvValue: number): boolean => {
    return hrvValue >= 0 && hrvValue <= 300;
  };

  const getStressBadge = (level: string) => {
    const stressConfig = STRESS_LEVELS.find(s => s.value === level);
    return (
      <Badge className={stressConfig?.color || 'bg-muted text-muted-foreground'}>
        {stressConfig?.label || level}
      </Badge>
    );
  };

  const handleSubmit = async () => {
    // Validate heart rate
    const hr = parseInt(heartRate);
    if (!heartRate || isNaN(hr)) {
      toast.error('Heart rate is required');
      return;
    }
    if (!validateHeartRate(hr)) {
      toast.error('Heart rate must be between 40-220 BPM');
      return;
    }

    // Validate HRV if provided
    let hrvValue: number | null = null;
    if (hrv) {
      hrvValue = parseFloat(hrv);
      if (isNaN(hrvValue) || !validateHrv(hrvValue)) {
        toast.error('HRV must be between 0-300 ms');
        return;
      }
    }

    // Determine timestamp
    const timestamp = useCurrentTime 
      ? new Date().toISOString() 
      : customTimestamp 
        ? new Date(customTimestamp).toISOString() 
        : new Date().toISOString();

    setIsLogging(true);

    try {
      // Build the data object for insertRecord action
      const insertData: Record<string, any> = {
        measurement_timestamp: timestamp,
        heart_rate: hr,
        stress_level: stressLevel,
        medical_alert: markAsMedicalAlert,
        legal_evidence: markAsEvidence,
        source_table: 'manual_entry'
      };
      
      if (hrvValue !== null) {
        insertData.hrv = hrvValue;
      }
      if (notes.trim()) {
        insertData.notes = notes.trim();
      }

      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'insertRecord', table: 'biometric_monitoring', data: insertData }
      });

      if (error) throw error;

      const insertedRow = data?.rows?.[0] || data?.[0] || data;
      
      // Add to recent entries
      if (insertedRow) {
        const newEntry: BiometricEntry = {
          id: insertedRow.id,
          timestamp: insertedRow.measurement_timestamp,
          heart_rate: insertedRow.heart_rate,
          hrv: insertedRow.hrv,
          stress_level: insertedRow.stress_level,
          notes: notes.trim() || undefined
        };
        setRecentEntries(prev => [newEntry, ...prev].slice(0, 10));
      }

      // Auto-correlate with ADSB data within 5-minute window
      try {
        const correlationQuery = `
          WITH biometric_event AS (
            SELECT '${timestamp}'::timestamptz as event_time, ${hr} as heart_rate
          ),
          nearby_flights AS (
            SELECT 
              f.id as flight_id,
              f.registration,
              f.operator,
              f.aircraft_type,
              COALESCE(f.altitude_ft, f.altitude) as altitude,
              COALESCE(f.detection_timestamp, f.detected_at, f.created_at) as flight_time,
              EXTRACT(EPOCH FROM (COALESCE(f.detection_timestamp, f.detected_at, f.created_at) - '${timestamp}'::timestamptz))/60 as time_diff_minutes
            FROM live_flight_detections_rows f
            WHERE COALESCE(f.detection_timestamp, f.detected_at, f.created_at) 
              BETWEEN '${timestamp}'::timestamptz - INTERVAL '5 minutes' 
              AND '${timestamp}'::timestamptz + INTERVAL '5 minutes'
          )
          SELECT * FROM nearby_flights ORDER BY ABS(time_diff_minutes) LIMIT 10
        `;
        
        const { data: correlationData } = await supabase.functions.invoke('neon-query', {
          body: { action: 'customQuery', query: correlationQuery }
        });

        const flights = correlationData?.rows || correlationData || [];
        if (flights.length > 0) {
          toast.success(`Found ${flights.length} aircraft within 5-minute window`, {
            description: flights.slice(0, 3).map((f: any) => f.registration).join(', ')
          });

          // Store correlation in master_forensic_events if available
          const correlationInsert = `
            INSERT INTO master_forensic_events (
              event_timestamp, event_type, primary_entity_type, summary, 
              linked_records, confidence_score, factor_count
            ) VALUES (
              '${timestamp}',
              'biometric',
              'aircraft',
              'Manual biometric entry (HR: ${hr} BPM) correlated with ${flights.length} aircraft',
              '${JSON.stringify({ biometric_id: insertedRow?.id, flights: flights.slice(0, 5) }).replace(/'/g, "''")}',
              ${Math.min(95, 50 + flights.length * 10)},
              2
            )
            ON CONFLICT DO NOTHING
          `;
          await supabase.functions.invoke('neon-query', {
            body: { action: 'customQuery', query: correlationInsert }
          }).catch(() => {}); // Silent fail if table doesn't exist
        }
      } catch (corrErr) {
        console.log('Correlation check skipped:', corrErr);
      }

      toast.success('Biometric data logged successfully', {
        description: `HR: ${hr} BPM | Stress: ${stressLevel}`
      });

      // Reset form
      setHeartRate('');
      setHrv('');
      setStressLevel('NORMAL');
      setNotes('');
      setMarkAsEvidence(false);
      setMarkAsMedicalAlert(false);
      setCustomTimestamp('');

    } catch (error) {
      console.error('Failed to log biometric data:', error);
      toast.error('Failed to log biometric data', {
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsLogging(false);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <CyberPanel 
      title="Manual Biometric Logger" 
      icon={<Heart className="h-5 w-5 text-red-400" />}
      className="border-red-500/30"
    >
      <div className="space-y-6">
        {/* Header Info */}
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <p className="text-xs text-red-300">
            <AlertTriangle className="h-3 w-3 inline mr-1" />
            Log physiological readings for correlation with aircraft detections. 
            All entries are SHA-256 hashed for chain of custody.
          </p>
        </div>

        {/* Input Form */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Heart Rate */}
          <div className="space-y-2">
            <Label htmlFor="heart-rate" className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-red-400" />
              Heart Rate (BPM) *
            </Label>
            <Input
              id="heart-rate"
              type="number"
              min="40"
              max="220"
              placeholder="e.g., 85"
              value={heartRate}
              onChange={(e) => setHeartRate(e.target.value)}
              className="bg-background/50 border-border/50"
            />
            {heartRate && !validateHeartRate(parseInt(heartRate)) && (
              <p className="text-xs text-destructive">Must be 40-220 BPM</p>
            )}
          </div>

          {/* HRV */}
          <div className="space-y-2">
            <Label htmlFor="hrv" className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-400" />
              HRV (ms)
            </Label>
            <Input
              id="hrv"
              type="number"
              min="0"
              max="300"
              placeholder="e.g., 45"
              value={hrv}
              onChange={(e) => setHrv(e.target.value)}
              className="bg-background/50 border-border/50"
            />
            {hrv && !validateHrv(parseFloat(hrv)) && (
              <p className="text-xs text-destructive">Must be 0-300 ms</p>
            )}
          </div>

          {/* Stress Level */}
          <div className="space-y-2">
            <Label>Stress Level</Label>
            <Select value={stressLevel} onValueChange={setStressLevel}>
              <SelectTrigger className="bg-background/50 border-border/50">
                <SelectValue placeholder="Select stress level" />
              </SelectTrigger>
              <SelectContent>
                {STRESS_LEVELS.map(level => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Timestamp */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Timestamp
            </Label>
            <div className="flex items-center gap-2">
              <Switch
                checked={useCurrentTime}
                onCheckedChange={setUseCurrentTime}
              />
              <span className="text-xs text-muted-foreground">
                {useCurrentTime ? 'Use current time' : 'Custom time'}
              </span>
            </div>
            {!useCurrentTime && (
              <Input
                type="datetime-local"
                value={customTimestamp}
                onChange={(e) => setCustomTimestamp(e.target.value)}
                className="bg-background/50 border-border/50 mt-2"
              />
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="notes">Notes / Context</Label>
          <Textarea
            id="notes"
            placeholder="Aircraft overhead, sudden anxiety, physical symptoms..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="bg-background/50 border-border/50 min-h-[60px]"
          />
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <Switch
              checked={markAsEvidence}
              onCheckedChange={setMarkAsEvidence}
            />
            <Label className="text-sm cursor-pointer">
              Mark as Legal Evidence
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={markAsMedicalAlert}
              onCheckedChange={setMarkAsMedicalAlert}
            />
            <Label className="text-sm cursor-pointer">
              Medical Alert
            </Label>
          </div>
        </div>

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={isLogging || !heartRate}
          className="w-full bg-red-600 hover:bg-red-700"
        >
          {isLogging ? (
            <>Logging...</>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-2" />
              Log Biometric Reading
            </>
          )}
        </Button>

        {/* Recent Entries */}
        {recentEntries.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              Recently Logged ({recentEntries.length})
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {recentEntries.map(entry => (
                <div 
                  key={entry.id} 
                  className="bg-muted/30 rounded-lg p-3 text-xs flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-red-400">
                      {entry.heart_rate} BPM
                    </span>
                    {entry.hrv && (
                      <span className="text-cyan-400">
                        HRV: {entry.hrv}ms
                      </span>
                    )}
                    {getStressBadge(entry.stress_level)}
                  </div>
                  <span className="text-muted-foreground">
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CyberPanel>
  );
};

export default ManualBiometricLogger;
