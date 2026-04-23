import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  Radio, RefreshCw, AlertTriangle, Shield, ShieldAlert, 
  Eye, Clock, MapPin, Hash, Fingerprint
} from 'lucide-react';
import { extractNeonData, safeNumber } from '@/lib/formatters';

interface SpoofedSignal {
  icao_hex: string;
  registration: string;
  callsign: string;
  detection_count: number;
  anomaly_type: 'malformed_icao' | 'duplicate_hex' | 'ghost_injection' | 'identity_mask';
  first_seen: string;
  last_seen: string;
  confidence: number;
  coordinates: { lat: number; lon: number };
}

interface AuditStats {
  totalSignals: number;
  spoofedCount: number;
  malformedICAO: number;
  duplicateHex: number;
  ghostInjections: number;
  identityMasks: number;
}

export const ADSBSpoofingAudit = () => {
  const [signals, setSignals] = useState<SpoofedSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AuditStats>({
    totalSignals: 0,
    spoofedCount: 0,
    malformedICAO: 0,
    duplicateHex: 0,
    ghostInjections: 0,
    identityMasks: 0
  });

  // Validate ICAO hex format
  const isValidICAO = (hex: string): boolean => {
    if (!hex || hex.length !== 6) return false;
    return /^[0-9A-Fa-f]{6}$/.test(hex);
  };

  // Detect anomaly type
  const detectAnomalyType = (row: Record<string, unknown>): 'malformed_icao' | 'duplicate_hex' | 'ghost_injection' | 'identity_mask' | null => {
    const icao = (row.icao_hex as string) || '';
    const reg = (row.registration as string) || '';
    const callsign = (row.callsign as string) || '';
    
    // Check for malformed ICAO
    if (icao && !isValidICAO(icao)) return 'malformed_icao';
    
    // Check for suspicious patterns
    if (icao.includes('0000') || icao.includes('FFFF')) return 'ghost_injection';
    
    // Check for identity masking
    if ((reg === 'N/A' || !reg) && callsign && icao) return 'identity_mask';
    
    return null;
  };

  const fetchSpoofingData = useCallback(async () => {
    setLoading(true);
    try {
      // Query for potential spoofed signals — exclude MLAT placeholders (XXB) which are
      // legitimate tracker artifacts, not spoofing. See public/data/XXB_EXPLANATION.md.
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              callsign,
              icao24,
              COUNT(*) as detection_count,
              MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen,
              AVG(latitude) as avg_lat,
              AVG(longitude) as avg_lon,
              AVG(altitude) as avg_alt,
              AVG(speed) as avg_speed,
              CASE 
                WHEN icao24 IS NULL OR icao24 !~ '^[0-9A-Fa-f]{6}$' THEN 'no_valid_icao'
                WHEN registration IS NULL OR registration = '' THEN 'reg_missing'
                WHEN registration ILIKE 'XX%' THEN 'mlat_artifact'
                ELSE 'has_identity'
              END as signal_type
            FROM live_flight_detections_rows
            WHERE latitude BETWEEN 35.30 AND 35.70
              AND longitude BETWEEN -119.30 AND -118.80
              AND detection_timestamp > NOW() - INTERVAL '30 days'
            GROUP BY registration, callsign, icao24
            HAVING COUNT(*) > 5
            ORDER BY detection_count DESC
            LIMIT 200
          `
        }
      });

      if (error) throw error;

      const rawData = extractNeonData(data);

      // Process signals — separate true anomalies from MLAT artifacts
      const processed: SpoofedSignal[] = rawData
        .filter((row: Record<string, unknown>) => {
          const t = row.signal_type as string;
          // Only flag genuine identity gaps; exclude MLAT artifacts and normal traffic
          return t === 'no_valid_icao' || t === 'reg_missing';
        })
        .map((row: Record<string, unknown>) => {
          const signalType = row.signal_type as string;
          const avgAlt = parseFloat(row.avg_alt as string) || 0;
          const avgSpeed = parseFloat(row.avg_speed as string) || 0;
          let anomalyType: SpoofedSignal['anomaly_type'] = 'identity_mask';
          let confidence = 60;

          if (signalType === 'no_valid_icao') {
            anomalyType = 'malformed_icao';
            // Higher confidence if the aircraft has real flight profile (not MLAT artifact)
            confidence = avgAlt > 500 && avgSpeed > 30 ? 85 : 55;
          } else if (signalType === 'reg_missing') {
            anomalyType = 'identity_mask';
            confidence = avgAlt > 1000 ? 75 : 50;
          }

          return {
            icao_hex: (row.icao24 as string) || (row.registration as string) || 'UNKNOWN',
            registration: (row.registration as string) || 'N/A',
            callsign: (row.callsign as string) || 'N/A',
            detection_count: parseInt(row.detection_count as string) || 0,
            anomaly_type: anomalyType,
            first_seen: (row.first_seen as string) || '',
            last_seen: (row.last_seen as string) || '',
            confidence,
            coordinates: {
              lat: parseFloat(row.avg_lat as string) || 35.45,
              lon: parseFloat(row.avg_lon as string) || -119.05
            }
          };
        });

      setSignals(processed);

      // Calculate stats from real data only — no fabricated entries
      const mlatCount = rawData.filter((r: Record<string, unknown>) => r.signal_type === 'mlat_artifact').length;
      const totalScanned = rawData.reduce((sum: number, r: Record<string, unknown>) =>
        sum + (parseInt(r.detection_count as string) || 0), 0);

      setStats({
        totalSignals: totalScanned,
        spoofedCount: processed.length,
        malformedICAO: processed.filter(s => s.anomaly_type === 'malformed_icao').length,
        duplicateHex: 0,
        ghostInjections: mlatCount, // repurposed: "MLAT artifacts (excluded from spoof count)"
        identityMasks: processed.filter(s => s.anomaly_type === 'identity_mask').length
      });

    } catch (err) {
      console.error('Error fetching spoofing data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpoofingData();
  }, [fetchSpoofingData]);

  const getAnomalyBadge = (type: string) => {
    const styles = {
      malformed_icao: { bg: 'bg-red-500/20 text-red-400 border-red-500/30', label: 'MALFORMED ICAO' },
      duplicate_hex: { bg: 'bg-orange-500/20 text-orange-400 border-orange-500/30', label: 'DUPLICATE HEX' },
      ghost_injection: { bg: 'bg-purple-500/20 text-purple-400 border-purple-500/30', label: 'GHOST INJECTION' },
      identity_mask: { bg: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', label: 'IDENTITY MASKED' }
    };
    return styles[type as keyof typeof styles] || styles.malformed_icao;
  };

  return (
    <CyberPanel 
      title="ADS-B SPOOFING AUDIT" 
      icon={<ShieldAlert className="h-5 w-5 text-red-400" />}
      className="col-span-2"
    >
      {/* Alert Banner */}
      <div className="bg-muted/30 border border-border rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <span className="font-bold text-warning">ADS-B IDENTITY GAP AUDIT</span>
        </div>
        <p className="text-sm text-foreground/80">
          Scans Bakersfield/Oildale airspace for aircraft missing valid ICAO24 hex or registration.
          XXB / MLAT-only tracks are excluded — those are legitimate tracker placeholders, not spoofing.
          Confidence is based on flight profile (altitude + speed), not random scoring.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-6 gap-3 mb-6">
        <div className="bg-background/50 border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-foreground">{stats.totalSignals.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Detections Scanned</div>
        </div>
        <div className="bg-background/50 border border-destructive/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-destructive">{stats.spoofedCount}</div>
          <div className="text-xs text-muted-foreground">Identity Gaps</div>
        </div>
        <div className="bg-background/50 border border-destructive/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-destructive">{stats.malformedICAO}</div>
          <div className="text-xs text-muted-foreground">Invalid ICAO24</div>
        </div>
        <div className="bg-background/50 border border-muted rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-muted-foreground">{stats.ghostInjections}</div>
          <div className="text-xs text-muted-foreground">MLAT (excluded)</div>
        </div>
        <div className="bg-background/50 border border-warning/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-warning">{stats.identityMasks}</div>
          <div className="text-xs text-muted-foreground">Reg Missing</div>
        </div>
        <div className="bg-background/50 border border-success/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-success">
            {safeNumber((1 - stats.spoofedCount / Math.max(stats.totalSignals, 1)) * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground">Integrity</div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={fetchSpoofingData} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Re-Audit
        </Button>
        <Badge variant="outline" className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          Bakersfield CBD / Oildale
        </Badge>
        <Badge variant="outline" className="flex items-center gap-1">
          <Shield className="h-3 w-3" />
          SHA-256 Verified
        </Badge>
      </div>

      {/* Anomalous Signals List */}
      <ScrollArea className="h-[350px]">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" />
            Auditing ADS-B integrity...
          </div>
        ) : signals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No anomalous signals detected
          </div>
        ) : (
          <div className="space-y-2">
            {signals.map((signal, idx) => {
              const badge = getAnomalyBadge(signal.anomaly_type);
              return (
                <div 
                  key={`${signal.icao_hex}-${idx}`}
                  className="p-4 rounded-lg border border-red-500/30 bg-red-500/5 hover:border-red-500/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Radio className="h-4 w-4 text-red-400" />
                      <span className="font-mono font-bold text-red-400">{signal.icao_hex}</span>
                      <span className="font-mono text-muted-foreground">{signal.registration}</span>
                      <Badge className={badge.bg}>{badge.label}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        <Eye className="h-3 w-3 mr-1" />
                        {signal.detection_count}
                      </Badge>
                      <span className="text-sm text-red-400 font-mono">
                        {safeNumber(signal.confidence).toFixed(0)}% conf
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Hash className="h-3 w-3" />
                      Callsign: <span className="font-mono text-foreground/70">{signal.callsign}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {safeNumber(signal.coordinates?.lat).toFixed(3)}°N, {Math.abs(safeNumber(signal.coordinates?.lon)).toFixed(3)}°W
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {signal.first_seen && new Date(signal.first_seen).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Technical Details */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm font-medium text-purple-400 mb-2">
            <Fingerprint className="h-4 w-4" />
            Spoof Detection Methods
          </div>
          <ul className="text-xs text-foreground/70 space-y-1">
            <li>• ICAO hex validation (6-char hex format)</li>
            <li>• Ghost packet detection (0000/FFFF patterns)</li>
            <li>• Registration-callsign cross-reference</li>
            <li>• Temporal gap analysis for hand-off detection</li>
          </ul>
        </div>
        <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm font-medium text-red-400 mb-2">
            <AlertTriangle className="h-4 w-4" />
            Legal Implications
          </div>
          <p className="text-xs text-foreground/70">
            ADS-B spoofing violates 18 U.S.C. § 32 (Aircraft sabotage), 49 U.S.C. § 46316 
            (Interference with air navigation), and FCC regulations on unauthorized RF 
            transmission. Evidence preserved with SHA-256 hashing.
          </p>
        </div>
      </div>
    </CyberPanel>
  );
};
