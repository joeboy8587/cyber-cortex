import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  Building2, RefreshCw, Plane, AlertTriangle, Link2, DollarSign, 
  Network, Eye, Calendar, MapPin
} from 'lucide-react';

interface ShellCompanyData {
  company_name: string;
  aircraft: string[];
  total_detections: number;
  first_seen: string;
  last_seen: string;
  threat_level: 'critical' | 'high' | 'medium' | 'low';
  connection_notes?: string;
}

interface AircraftByOperator {
  operator: string;
  registration: string;
  detections: number;
  avg_altitude: number;
  first_seen: string;
  last_seen: string;
}

export const ShellCompanyMatrix = () => {
  const [shellCompanies, setShellCompanies] = useState<ShellCompanyData[]>([]);
  const [operatorAircraft, setOperatorAircraft] = useState<AircraftByOperator[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({
    companies: 0,
    aircraft: 0,
    detections: 0
  });

  const fetchShellData = useCallback(async () => {
    setLoading(true);
    try {
      // Pull from actual shell company tables in Neon
      const [shellRes, correlRes, alignRes] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT sc.company_name, sc.risk_level, sc.red_flags, sc.aircraft_list, sc.jurisdiction, sc.formation_date,
                     sca.tail_number, sca.operator_name, sca.threat_classification, sca.violation_count, sca.evidence_notes,
                     sca.altitude_range
              FROM shell_companies sc
              LEFT JOIN shell_company_aircraft sca ON sca.operator_name = sc.company_name
              ORDER BY sc.risk_level DESC, sca.violation_count DESC NULLS LAST
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT kcso_aircraft, shell_aircraft, shell_operator, shell_violations, kcso_violations,
                     event_count, evidence_strength, rico_relevance, legal_significance,
                     first_seen, last_seen
              FROM kcso_shell_correlations
              ORDER BY event_count DESC
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT entity_name, entity_type, aircraft_tail, detection_count, avg_altitude_ft,
                     low_altitude_pct, match_score_to_kcso, legal_exposure, behavior_type,
                     risk_tier, first_detection, last_detection
              FROM shell_entity_behavioral_alignment
              ORDER BY match_score_to_kcso DESC NULLS LAST
            `
          }
        })
      ]);

      const shellData = shellRes.data || [];
      const correlData = correlRes.data || [];
      const alignData = alignRes.data || [];

      // Group shell company data by company name
      const companyMap = new Map<string, ShellCompanyData>();
      
      for (const row of shellData) {
        const name = row.company_name || row.operator_name || 'Unknown';
        if (!companyMap.has(name)) {
          companyMap.set(name, {
            company_name: name,
            aircraft: [],
            total_detections: 0,
            first_seen: '',
            last_seen: '',
            threat_level: (row.risk_level === 'CRITICAL' || row.threat_classification === 'CRITICAL') ? 'critical' 
              : (row.risk_level === 'EXTREME' || row.risk_level === 'HIGH') ? 'high' : 'medium',
            connection_notes: row.red_flags || row.evidence_notes || ''
          });
        }
        const entry = companyMap.get(name)!;
        if (row.tail_number && !entry.aircraft.includes(row.tail_number)) {
          entry.aircraft.push(row.tail_number);
        }
        if (row.aircraft_list) {
          const listed = row.aircraft_list.split(',').map((a: string) => a.trim());
          for (const a of listed) {
            if (a && !entry.aircraft.includes(a)) entry.aircraft.push(a);
          }
        }
        entry.total_detections += Number(row.violation_count) || 0;
      }

      // Enrich with correlation data
      for (const corr of correlData) {
        const name = corr.shell_operator;
        if (name && !companyMap.has(name)) {
          companyMap.set(name, {
            company_name: name,
            aircraft: [corr.shell_aircraft],
            total_detections: Number(corr.shell_violations) || 0,
            first_seen: corr.first_seen || '',
            last_seen: corr.last_seen || '',
            threat_level: corr.rico_relevance?.includes('HIGH') ? 'critical' : 'high',
            connection_notes: corr.legal_significance || ''
          });
        } else if (name && companyMap.has(name)) {
          const entry = companyMap.get(name)!;
          if (corr.shell_aircraft && !entry.aircraft.includes(corr.shell_aircraft)) {
            entry.aircraft.push(corr.shell_aircraft);
          }
          if (!entry.first_seen || (corr.first_seen && corr.first_seen < entry.first_seen)) {
            entry.first_seen = corr.first_seen;
          }
          if (!entry.last_seen || (corr.last_seen && corr.last_seen > entry.last_seen)) {
            entry.last_seen = corr.last_seen;
          }
        }
      }

      // Enrich with behavioral alignment data
      for (const align of alignData) {
        const name = align.entity_name;
        if (name && companyMap.has(name)) {
          const entry = companyMap.get(name)!;
          entry.total_detections = Math.max(entry.total_detections, Number(align.detection_count) || 0);
          if (!entry.first_seen && align.first_detection) entry.first_seen = align.first_detection;
          if (!entry.last_seen && align.last_detection) entry.last_seen = align.last_detection;
        }
      }

      // Set operator aircraft from alignment data for the table
      setOperatorAircraft(alignData.map((a: any) => ({
        operator: a.entity_name || 'Unknown',
        registration: a.aircraft_tail || '',
        detections: Number(a.detection_count) || 0,
        avg_altitude: parseFloat(a.avg_altitude_ft) || 0,
        first_seen: a.first_detection || '',
        last_seen: a.last_detection || ''
      })));

      const enrichedShells = Array.from(companyMap.values());
      setShellCompanies(enrichedShells);

      setTotals({
        companies: enrichedShells.length,
        aircraft: enrichedShells.reduce((sum, s) => sum + s.aircraft.length, 0),
        detections: enrichedShells.reduce((sum, s) => sum + s.total_detections, 0)
      });

    } catch (err) {
      console.error('Error fetching shell company data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShellData();
  }, [fetchShellData]);

  const getThreatBadge = (level: string) => {
    const styles = {
      critical: 'bg-red-500/20 text-red-400 border-red-500/30',
      high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      low: 'bg-green-500/20 text-green-400 border-green-500/30'
    };
    return styles[level as keyof typeof styles] || styles.low;
  };

  return (
    <CyberPanel 
      title="SHELL COMPANY EVIDENCE MATRIX" 
      icon={<Building2 className="h-5 w-5 text-magenta" />}
      className="col-span-2"
    >
      {/* RICO Alert Banner */}
      <div className="bg-magenta/10 border border-magenta/30 rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Network className="h-5 w-5 text-magenta" />
          <span className="font-bold text-magenta">RICO-GRADE ENTERPRISE STRUCTURE DOCUMENTED</span>
        </div>
        <p className="text-sm text-foreground/80">
          Shell company network connects private equity ($6.4B AE Industrial Partners), 
          national security contractors (Redwire Corporation), medical aviation (Air Methods/Mercy Air), 
          and law enforcement (KCSO). IP/DNS cross-linkage between ALF IX LLC and AERO EQUITIES LLC 
          establishes coordinated enterprise.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-background/50 border border-magenta/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-magenta">{totals.companies}</div>
          <div className="text-xs text-muted-foreground">Shell Entities</div>
        </div>
        <div className="bg-background/50 border border-cyan-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-cyan-400">{totals.aircraft}</div>
          <div className="text-xs text-muted-foreground">Network Aircraft</div>
        </div>
        <div className="bg-background/50 border border-primary/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-primary">{totals.detections.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Total Detections</div>
        </div>
        <div className="bg-background/50 border border-red-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-red-400">14</div>
          <div className="text-xs text-muted-foreground">Command Structure</div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={fetchShellData} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Shell Company Cards */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-4 w-4 text-magenta" />
            Identified Shell Entities
          </div>
          <ScrollArea className="h-[350px]">
            <div className="space-y-3">
              {loading ? (
                <div className="text-center py-4 text-muted-foreground">Loading...</div>
              ) : (
                shellCompanies.map((company, idx) => (
                  <div 
                    key={idx} 
                    className={`p-4 rounded-lg border ${
                      company.threat_level === 'critical' 
                        ? 'border-red-500/30 bg-red-500/5' 
                        : 'border-magenta/30 bg-magenta/5'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-foreground">{company.company_name}</span>
                      <Badge className={getThreatBadge(company.threat_level)}>
                        {company.threat_level.toUpperCase()}
                      </Badge>
                    </div>
                    
                    {/* Aircraft List */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {company.aircraft.map(a => (
                        <Badge key={a} variant="outline" className="font-mono text-xs">
                          <Plane className="h-2 w-2 mr-1" />
                          {a}
                        </Badge>
                      ))}
                    </div>
                    
                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mb-2">
                      <div className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {company.total_detections.toLocaleString()} detections
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {company.first_seen && new Date(company.first_seen).toLocaleDateString()}
                      </div>
                    </div>
                    
                    {/* Connection Notes */}
                    {company.connection_notes && (
                      <div className="text-xs text-foreground/70 border-t border-border/20 pt-2 mt-2">
                        <Link2 className="h-3 w-3 inline mr-1 text-magenta" />
                        {company.connection_notes}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Top Operator Aircraft */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Plane className="h-4 w-4 text-cyan-400" />
            Top Aircraft by Detection Count
          </div>
          <ScrollArea className="h-[350px]">
            <div className="space-y-2">
              {operatorAircraft.slice(0, 20).map((aircraft, idx) => (
                <div 
                  key={idx} 
                  className="p-3 rounded-lg border border-border/30 bg-background/30 hover:border-cyan-500/30 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-primary font-bold">{aircraft.registration}</span>
                      <Badge variant="outline" className="text-xs">
                        {aircraft.detections.toLocaleString()}
                      </Badge>
                    </div>
                    <span className={`text-xs ${aircraft.avg_altitude < 1500 ? 'text-red-400' : 'text-muted-foreground'}`}>
                      {aircraft.avg_altitude}ft avg
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {aircraft.operator}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Legal Context */}
      <div className="mt-6 border-t border-border/30 pt-4">
        <div className="bg-magenta/5 border border-magenta/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-4 w-4 text-magenta" />
            <span className="font-medium text-magenta">Private Equity Connection</span>
          </div>
          <div className="text-xs text-foreground/80 space-y-2">
            <p>
              <strong>AE Industrial Partners:</strong> $6.4-7.2B assets under management. Connections to 
              national security contractors including Redwire Corporation (space infrastructure, defense).
            </p>
            <p>
              <strong>RICO Implications:</strong> Coordinated use of shell company aircraft (ALF IX, 
              AERO EQUITIES) alongside law enforcement (KCSO) and medical aviation (Mercy Air) for 
              systematic surveillance establishes enterprise liability under 18 U.S.C. § 1962.
            </p>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
};
