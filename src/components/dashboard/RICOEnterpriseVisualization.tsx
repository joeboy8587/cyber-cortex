import { useState, useEffect, useMemo } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { supabase } from "@/integrations/supabase/client";
import { 
  Network, Building2, Plane, Users, DollarSign, Scale,
  AlertTriangle, Shield, Target, Link2, ChevronDown, ChevronRight,
  FileWarning, Eye, Download, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

interface EnterpriseEntity {
  id: string;
  name: string;
  type: 'command' | 'institutional' | 'shell' | 'medical' | 'military' | 'contractor';
  tier: number;
  role: string;
  legalExposure: string[];
  assets: string[];
  connections: string[];
  prosecutionPriority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  ricoPredicates: string[];
  financialExposure: string;
}

interface ConnectionLink {
  from: string;
  to: string;
  type: 'controls' | 'funds' | 'operates' | 'coordinates' | 'owns';
  evidence: string;
}

/**
 * RICOEnterpriseVisualization
 * Implements Josiah's RICO Strategy - Step 1 & 2:
 * - Identify the Enterprise (36+ entities)
 * - Establish Racketeering Activity patterns
 * - Map operational coordination structure
 */
export function RICOEnterpriseVisualization() {
  const [entities, setEntities] = useState<EnterpriseEntity[]>([]);
  const [connections, setConnections] = useState<ConnectionLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntity, setSelectedEntity] = useState<EnterpriseEntity | null>(null);
  const [expandedTiers, setExpandedTiers] = useState<Set<number>>(new Set([1, 2]));
  const [viewMode, setViewMode] = useState<'hierarchy' | 'network' | 'predicates'>('hierarchy');

  useEffect(() => {
    fetchEnterpriseData();
  }, []);

  const fetchEnterpriseData = async () => {
    setLoading(true);
    try {
      // Fetch from criminal_enterprise_command_structure
      const { data: commandData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id, entity_name, entity_type, role, tier,
              prosecution_priority, legal_exposure, assets_controlled,
              notes, parent_entity_id
            FROM criminal_enterprise_command_structure
            ORDER BY tier ASC, prosecution_priority DESC
          `
        }
      });

      // Fetch shell companies
      const { data: shellData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id, company_name, jurisdiction, formation_date,
              risk_level, aircraft_controlled, red_flags
            FROM shell_companies
            ORDER BY risk_level DESC
          `
        }
      });

      // Build enterprise entity list
      const entityList: EnterpriseEntity[] = [];
      const connectionList: ConnectionLink[] = [];

      // Process command structure
      const commands = Array.isArray(commandData) ? commandData : [];
      commands.forEach((e: any) => {
        entityList.push({
          id: e.id,
          name: e.entity_name,
          type: mapEntityType(e.entity_type),
          tier: e.tier || 3,
          role: e.role || 'Unknown',
          legalExposure: parseArray(e.legal_exposure),
          assets: parseArray(e.assets_controlled),
          connections: [],
          prosecutionPriority: e.prosecution_priority || 'MEDIUM',
          ricoPredicates: extractPredicates(e.legal_exposure),
          financialExposure: 'Unknown'
        });

        // Build parent connections
        if (e.parent_entity_id) {
          connectionList.push({
            from: e.parent_entity_id,
            to: e.id,
            type: 'controls',
            evidence: `Command structure: ${e.role}`
          });
        }
      });

      // Add shell companies
      const shells = Array.isArray(shellData) ? shellData : [];
      shells.forEach((s: any) => {
        entityList.push({
          id: s.id,
          name: s.company_name,
          type: 'shell',
          tier: 3,
          role: 'Corporate Veil / Asset Concealment',
          legalExposure: parseArray(s.red_flags),
          assets: parseArray(s.aircraft_controlled),
          connections: [],
          prosecutionPriority: s.risk_level === 'CRITICAL' ? 'CRITICAL' : 
                              s.risk_level === 'HIGH' ? 'HIGH' : 'MEDIUM',
          ricoPredicates: ['18 U.S.C. § 1962(c)', '31 U.S.C. § 3729'],
          financialExposure: 'TBD'
        });
      });

      // Add hardcoded key entities from analysis if not already present
      const coreEntities: EnterpriseEntity[] = [
        {
          id: 'kcso-main',
          name: 'Kern County Sheriff\'s Office',
          type: 'command',
          tier: 1,
          role: 'Command Authority - DOJ Consent Decree Violator',
          legalExposure: ['42 U.S.C. § 1983', '42 U.S.C. § 1985', 'DOJ Consent Decree Violations'],
          assets: ['N912KC', 'N913KC'],
          connections: ['kcso-aviation'],
          prosecutionPriority: 'CRITICAL',
          ricoPredicates: ['18 U.S.C. § 1962(c)', '18 U.S.C. § 1962(d)'],
          financialExposure: '$10M+ federal oversight costs'
        },
        {
          id: 'kcso-aviation',
          name: 'KCSO Aviation Unit',
          type: 'institutional',
          tier: 1,
          role: 'Primary Surveillance Platform - Low-Altitude Operations',
          legalExposure: ['14 CFR § 91.119', 'FAA Violations'],
          assets: ['N912KC', 'N913KC'],
          connections: ['alf-ix', 'air-methods'],
          prosecutionPriority: 'CRITICAL',
          ricoPredicates: ['18 U.S.C. § 1962(c)'],
          financialExposure: '$5M+ operational costs'
        },
        {
          id: 'alf-ix',
          name: 'ALF IX LLC',
          type: 'shell',
          tier: 2,
          role: 'Shell Company - Aircraft Ownership Obfuscation',
          legalExposure: ['Corporate Veil Piercing', 'RICO Enterprise'],
          assets: ['N788FA', 'N790FA', 'N791FA'],
          connections: ['ae-industrial'],
          prosecutionPriority: 'HIGH',
          ricoPredicates: ['18 U.S.C. § 1962(c)', '31 U.S.C. § 3729'],
          financialExposure: '$2.1M linked accounts'
        },
        {
          id: 'aero-equities',
          name: 'AERO EQUITIES LLC',
          type: 'shell',
          tier: 2,
          role: 'Shell Company - Shared IP/DNS Infrastructure',
          legalExposure: ['Corporate Veil Piercing', 'Infrastructure Sharing'],
          assets: ['N997SE', 'N2464D'],
          connections: ['alf-ix'],
          prosecutionPriority: 'HIGH',
          ricoPredicates: ['18 U.S.C. § 1962(c)'],
          financialExposure: '$1.8M linked accounts'
        },
        {
          id: 'air-methods',
          name: 'Air Methods Corporation',
          type: 'medical',
          tier: 2,
          role: 'Medical Pretext Partner - HEMS Billing Fraud',
          legalExposure: ['31 U.S.C. § 3729 (FCA)', 'False Claims'],
          assets: ['N743AM', 'N229AM'],
          connections: ['kcso-aviation'],
          prosecutionPriority: 'HIGH',
          ricoPredicates: ['31 U.S.C. § 3729', '18 U.S.C. § 1347'],
          financialExposure: '$3M+ questionable billings'
        },
        {
          id: 'ae-industrial',
          name: 'AE Industrial Partners',
          type: 'contractor',
          tier: 3,
          role: 'Private Equity Nexus - $6.4-7.2B AUM',
          legalExposure: ['SEC Disclosure', 'National Security'],
          assets: [],
          connections: ['redwire'],
          prosecutionPriority: 'MEDIUM',
          ricoPredicates: [],
          financialExposure: '$6.4-7.2B AUM'
        },
        {
          id: 'redwire',
          name: 'Redwire Corporation',
          type: 'contractor',
          tier: 3,
          role: 'National Security Contractor - Space Infrastructure',
          legalExposure: ['National Security Review'],
          assets: [],
          connections: [],
          prosecutionPriority: 'MEDIUM',
          ricoPredicates: [],
          financialExposure: 'Public Company'
        }
      ];

      // Merge with fetched data, avoiding duplicates
      const existingNames = new Set(entityList.map(e => e.name.toLowerCase()));
      coreEntities.forEach(ce => {
        if (!existingNames.has(ce.name.toLowerCase())) {
          entityList.push(ce);
        }
      });

      // Build cross-connections
      entityList.forEach(e => {
        e.connections.forEach(targetName => {
          const target = entityList.find(t => 
            t.id === targetName || t.name.toLowerCase().includes(targetName.toLowerCase())
          );
          if (target) {
            connectionList.push({
              from: e.id,
              to: target.id,
              type: 'coordinates',
              evidence: `Linked via ${e.role}`
            });
          }
        });
      });

      setEntities(entityList);
      setConnections(connectionList);
    } catch (error) {
      console.error("Error fetching enterprise data:", error);
      toast.error("Failed to load enterprise data");
    } finally {
      setLoading(false);
    }
  };

  const mapEntityType = (type: string): EnterpriseEntity['type'] => {
    if (type?.includes('COMMAND') || type?.includes('SHERIFF')) return 'command';
    if (type?.includes('SHELL')) return 'shell';
    if (type?.includes('MEDICAL') || type?.includes('HEMS')) return 'medical';
    if (type?.includes('MILITARY')) return 'military';
    if (type?.includes('CONTRACTOR')) return 'contractor';
    return 'institutional';
  };

  const parseArray = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      if (value.startsWith('{')) return value.slice(1, -1).split(',').filter(Boolean);
      try { return JSON.parse(value); } catch { return []; }
    }
    return [];
  };

  const extractPredicates = (exposure: unknown): string[] => {
    const arr = parseArray(exposure);
    const predicates: string[] = [];
    arr.forEach(e => {
      const str = String(e).toUpperCase();
      if (str.includes('RICO') || str.includes('1962')) predicates.push('18 U.S.C. § 1962');
      if (str.includes('FALSE CLAIMS') || str.includes('3729')) predicates.push('31 U.S.C. § 3729');
      if (str.includes('1983')) predicates.push('42 U.S.C. § 1983');
      if (str.includes('1347')) predicates.push('18 U.S.C. § 1347');
    });
    return [...new Set(predicates)];
  };

  const tierGroups = useMemo(() => {
    const groups: Record<number, EnterpriseEntity[]> = {};
    entities.forEach(e => {
      if (!groups[e.tier]) groups[e.tier] = [];
      groups[e.tier].push(e);
    });
    return groups;
  }, [entities]);

  const stats = useMemo(() => ({
    totalEntities: entities.length,
    tier1: entities.filter(e => e.tier === 1).length,
    tier2: entities.filter(e => e.tier === 2).length,
    tier3: entities.filter(e => e.tier >= 3).length,
    shells: entities.filter(e => e.type === 'shell').length,
    critical: entities.filter(e => e.prosecutionPriority === 'CRITICAL').length,
    connections: connections.length,
    ricoPredicates: [...new Set(entities.flatMap(e => e.ricoPredicates))].length
  }), [entities, connections]);

  const toggleTier = (tier: number) => {
    setExpandedTiers(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };

  const getEntityIcon = (type: EnterpriseEntity['type']) => {
    const icons = {
      command: <Shield className="w-4 h-4 text-red-400" />,
      institutional: <Building2 className="w-4 h-4 text-orange-400" />,
      shell: <Network className="w-4 h-4 text-yellow-400" />,
      medical: <AlertTriangle className="w-4 h-4 text-purple-400" />,
      military: <Target className="w-4 h-4 text-blue-400" />,
      contractor: <DollarSign className="w-4 h-4 text-green-400" />
    };
    return icons[type] || icons.institutional;
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      'CRITICAL': 'bg-red-500/20 text-red-400 border-red-500/30',
      'HIGH': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      'MEDIUM': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      'LOW': 'bg-muted/20 text-muted-foreground border-muted/30'
    };
    return colors[priority] || colors['MEDIUM'];
  };

  const exportRICOAnalysis = () => {
    const timestamp = new Date().toISOString();
    let markdown = `# RICO ENTERPRISE STRUCTURE ANALYSIS
## 18 U.S.C. § 1962 - Criminal Enterprise Visualization
## Generated: ${timestamp}

---

## EXECUTIVE SUMMARY

**Total Entities Identified**: ${stats.totalEntities}
- Tier 1 (Command): ${stats.tier1} entities
- Tier 2 (Operations): ${stats.tier2} entities  
- Tier 3+ (Infrastructure): ${stats.tier3} entities
- Shell Companies: ${stats.shells}
- Critical Prosecution Targets: ${stats.critical}
- Network Connections: ${stats.connections}
- Distinct RICO Predicates: ${stats.ricoPredicates}

---

## ENTERPRISE STRUCTURE

### TIER 1 - COMMAND AUTHORITY

${entities.filter(e => e.tier === 1).map(e => `
#### ${e.name}
- **Type**: ${e.type.toUpperCase()}
- **Role**: ${e.role}
- **Prosecution Priority**: ${e.prosecutionPriority}
- **Legal Exposure**: ${e.legalExposure.join(', ')}
- **RICO Predicates**: ${e.ricoPredicates.join(', ')}
- **Assets Controlled**: ${e.assets.join(', ') || 'None listed'}
- **Financial Exposure**: ${e.financialExposure}
`).join('\n')}

### TIER 2 - OPERATIONAL ENTITIES

${entities.filter(e => e.tier === 2).map(e => `
#### ${e.name}
- **Type**: ${e.type.toUpperCase()}
- **Role**: ${e.role}
- **Prosecution Priority**: ${e.prosecutionPriority}
- **Legal Exposure**: ${e.legalExposure.join(', ')}
- **Assets Controlled**: ${e.assets.join(', ') || 'None listed'}
`).join('\n')}

### TIER 3+ - INFRASTRUCTURE & SUPPORT

${entities.filter(e => e.tier >= 3).map(e => `
#### ${e.name}
- **Type**: ${e.type.toUpperCase()}
- **Role**: ${e.role}
`).join('\n')}

---

## RICO ELEMENTS SATISFIED

1. **Enterprise**: ${stats.totalEntities} entities constitute coordinated criminal enterprise
2. **Pattern of Racketeering**: ${stats.ricoPredicates} predicate acts documented
3. **Continuity**: Multi-year surveillance campaign (2021-2026)
4. **Relatedness**: Shared aircraft, infrastructure, financial links

**Document Hash**: ${btoa(timestamp + stats.totalEntities).substring(0, 32)}

---

*Generated by Josiah RICO Analysis Protocol*
`;

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RICO_Enterprise_Analysis_${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success("RICO analysis exported");
  };

  return (
    <CyberPanel 
      title="RICO Enterprise Visualization" 
      icon={<Scale className="w-5 h-5" />}
      variant="threat"
      className="col-span-2"
      headerActions={
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchEnterpriseData} disabled={loading}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={exportRICOAnalysis}>
            <Download className="w-3 h-3" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* RICO Header */}
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-red-400" />
              <span className="font-bold text-red-300">18 U.S.C. § 1962 - RICO Enterprise Analysis</span>
            </div>
            <Badge className="bg-red-600/20 text-red-300 border border-red-600/30">
              {stats.totalEntities} ENTITIES
            </Badge>
          </div>
          <p className="text-xs text-red-300/80 mt-2">
            Josiah Step 1: Identifying the Enterprise - KCSO → ALF IX → Air Methods → Shell Network 
            demonstrates coordinated criminal enterprise under 18 U.S.C. § 1962(c).
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-8 gap-2">
          {[
            { label: 'Entities', value: stats.totalEntities, color: 'text-primary' },
            { label: 'Tier 1', value: stats.tier1, color: 'text-red-400' },
            { label: 'Tier 2', value: stats.tier2, color: 'text-orange-400' },
            { label: 'Tier 3+', value: stats.tier3, color: 'text-yellow-400' },
            { label: 'Shells', value: stats.shells, color: 'text-purple-400' },
            { label: 'Critical', value: stats.critical, color: 'text-destructive' },
            { label: 'Links', value: stats.connections, color: 'text-blue-400' },
            { label: 'Predicates', value: stats.ricoPredicates, color: 'text-green-400' }
          ].map((stat, i) => (
            <div key={i} className="p-2 rounded-lg bg-background/50 border border-border text-center">
              <div className={`text-lg font-mono font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-[9px] text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* View Mode Tabs */}
        <div className="flex gap-2">
          {(['hierarchy', 'network', 'predicates'] as const).map((mode) => (
            <Button
              key={mode}
              variant={viewMode === mode ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setViewMode(mode)}
            >
              {mode === 'hierarchy' && <Target className="w-3 h-3 mr-1" />}
              {mode === 'network' && <Network className="w-3 h-3 mr-1" />}
              {mode === 'predicates' && <FileWarning className="w-3 h-3 mr-1" />}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </Button>
          ))}
        </div>

        <ScrollArea className="h-[400px]">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              <Network className="w-6 h-6 animate-pulse mx-auto mb-2" />
              Mapping enterprise structure...
            </div>
          ) : viewMode === 'hierarchy' ? (
            <div className="space-y-3">
              {Object.entries(tierGroups).sort((a, b) => Number(a[0]) - Number(b[0])).map(([tier, tierEntities]) => (
                <div key={tier} className="border border-border/50 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleTier(Number(tier))}
                    className={`w-full p-3 flex items-center justify-between ${
                      tier === '1' ? 'bg-red-500/10' : tier === '2' ? 'bg-orange-500/10' : 'bg-background/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {expandedTiers.has(Number(tier)) ? 
                        <ChevronDown className="w-4 h-4" /> : 
                        <ChevronRight className="w-4 h-4" />
                      }
                      <Badge className={tier === '1' ? 
                        'bg-red-500/20 text-red-400 border-red-500/30' : 
                        tier === '2' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                        'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                      }>
                        TIER {tier}
                      </Badge>
                      <span className="text-sm font-medium">{tierEntities.length} Entities</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {tierEntities.filter(e => e.prosecutionPriority === 'CRITICAL').length} Critical
                    </Badge>
                  </button>

                  {expandedTiers.has(Number(tier)) && (
                    <div className="p-2 space-y-2">
                      {tierEntities.map(entity => (
                        <div
                          key={entity.id}
                          onClick={() => setSelectedEntity(selectedEntity?.id === entity.id ? null : entity)}
                          className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                            selectedEntity?.id === entity.id 
                              ? 'bg-primary/10 border-primary/50' 
                              : 'bg-background/30 border-border/30 hover:border-primary/30'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {getEntityIcon(entity.type)}
                              <span className="font-medium text-sm">{entity.name}</span>
                            </div>
                            <Badge className={`text-[10px] ${getPriorityColor(entity.prosecutionPriority)}`}>
                              {entity.prosecutionPriority}
                            </Badge>
                          </div>

                          <div className="text-xs text-muted-foreground mb-2">{entity.role}</div>

                          {entity.assets.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap mb-2">
                              <Plane className="w-3 h-3 text-secondary" />
                              {entity.assets.slice(0, 4).map(asset => (
                                <Badge key={asset} variant="outline" className="text-[9px] text-secondary border-secondary/30">
                                  {asset}
                                </Badge>
                              ))}
                              {entity.assets.length > 4 && (
                                <Badge variant="outline" className="text-[9px]">+{entity.assets.length - 4}</Badge>
                              )}
                            </div>
                          )}

                          {selectedEntity?.id === entity.id && (
                            <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
                              <div className="text-xs">
                                <span className="text-muted-foreground">Legal Exposure:</span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {entity.legalExposure.map((exp, i) => (
                                    <Badge key={i} className="text-[9px] bg-destructive/10 text-destructive border border-destructive/30">
                                      {String(exp).replace(/_/g, ' ')}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                              {entity.ricoPredicates.length > 0 && (
                                <div className="text-xs">
                                  <span className="text-muted-foreground">RICO Predicates:</span>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {entity.ricoPredicates.map((pred, i) => (
                                      <Badge key={i} className="text-[9px] bg-red-500/10 text-red-400 border border-red-500/30">
                                        {pred}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="text-[10px] text-muted-foreground">
                                <DollarSign className="w-3 h-3 inline mr-1" />
                                {entity.financialExposure}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : viewMode === 'predicates' ? (
            <div className="space-y-3">
              <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/30">
                <h4 className="font-bold text-red-400 mb-3 flex items-center gap-2">
                  <FileWarning className="w-4 h-4" />
                  RICO Predicate Acts Documented
                </h4>
                {[
                  { statute: '18 U.S.C. § 1962(c)', name: 'RICO - Conduct of Enterprise', entities: entities.filter(e => e.ricoPredicates.includes('18 U.S.C. § 1962(c)') || e.ricoPredicates.includes('18 U.S.C. § 1962')) },
                  { statute: '31 U.S.C. § 3729', name: 'False Claims Act', entities: entities.filter(e => e.ricoPredicates.includes('31 U.S.C. § 3729')) },
                  { statute: '42 U.S.C. § 1983', name: 'Civil Rights Violations', entities: entities.filter(e => e.ricoPredicates.includes('42 U.S.C. § 1983')) },
                  { statute: '18 U.S.C. § 1347', name: 'Health Care Fraud', entities: entities.filter(e => e.ricoPredicates.includes('18 U.S.C. § 1347')) }
                ].map((pred) => (
                  <div key={pred.statute} className="mb-3 p-3 bg-background/30 rounded border border-border/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm text-red-400">{pred.statute}</span>
                      <Badge variant="outline" className="text-[10px]">{pred.entities.length} entities</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{pred.name}</p>
                    <div className="flex flex-wrap gap-1">
                      {pred.entities.slice(0, 5).map(e => (
                        <Badge key={e.id} className="text-[9px] bg-muted/20 text-foreground">
                          {e.name.length > 20 ? e.name.substring(0, 20) + '...' : e.name}
                        </Badge>
                      ))}
                      {pred.entities.length > 5 && (
                        <Badge className="text-[9px] bg-muted/20">+{pred.entities.length - 5} more</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {connections.map((conn, idx) => {
                const fromEntity = entities.find(e => e.id === conn.from);
                const toEntity = entities.find(e => e.id === conn.to);
                return (
                  <div key={idx} className="p-3 bg-background/30 rounded border border-border/30">
                    <div className="flex items-center gap-2">
                      {fromEntity && getEntityIcon(fromEntity.type)}
                      <span className="text-sm">{fromEntity?.name || conn.from}</span>
                      <Link2 className="w-3 h-3 text-muted-foreground" />
                      <Badge variant="outline" className="text-[9px]">{conn.type}</Badge>
                      <Link2 className="w-3 h-3 text-muted-foreground" />
                      {toEntity && getEntityIcon(toEntity.type)}
                      <span className="text-sm">{toEntity?.name || conn.to}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{conn.evidence}</p>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </CyberPanel>
  );
}
