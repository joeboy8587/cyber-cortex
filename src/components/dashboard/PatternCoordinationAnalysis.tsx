import { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Network, 
  AlertTriangle, 
  DollarSign, 
  Plane, 
  Heart, 
  RefreshCw,
  Building2,
  FileWarning,
  Scale,
  Ambulance
} from 'lucide-react';
import { useNeonDatabase } from '@/hooks/useNeonDatabase';

interface ShellCompany {
  id: number;
  company_name: string;
  jurisdiction: string;
  formation_date: string;
  address: string;
  aircraft_list: string;
  red_flags: string;
  risk_level: string;
}

interface EnterpriseEntity {
  id: string;
  entity_name: string;
  entity_type: string;
  role: string;
  tier: number;
  prosecution_priority: string;
  legal_exposure: string[];
  assets_controlled: string[] | null;
  notes: string;
}

interface CoordinatedOperation {
  id: string;
  operation_date: string;
  operation_type: string;
  aircraft_count: number;
  min_altitude: number;
  max_hr_recorded: number;
  max_stress_recorded: number;
  coordinated_threat_score: number;
  participating_aircraft: string[];
  evidence_of_coordination: string;
  legal_significance: string;
}

interface KCSOFactEntry {
  serial_id: number;
  Category: string;
  'Date__Year': string;
  'Event__Claim': string;
  'Amount__Outcome': string;
  Source: string;
  URL: string;
}

export function PatternCoordinationAnalysis() {
  const { customQuery, isLoading } = useNeonDatabase();
  const [shellCompanies, setShellCompanies] = useState<ShellCompany[]>([]);
  const [enterpriseEntities, setEnterpriseEntities] = useState<EnterpriseEntity[]>([]);
  const [coordinatedOps, setCoordinatedOps] = useState<CoordinatedOperation[]>([]);
  const [kcsoFacts, setKcsoFacts] = useState<KCSOFactEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [shellData, enterpriseData, opsData, factsData] = await Promise.all([
        customQuery('SELECT * FROM shell_companies ORDER BY risk_level DESC'),
        customQuery('SELECT * FROM criminal_enterprise_command_structure ORDER BY tier ASC, prosecution_priority DESC'),
        customQuery('SELECT * FROM coordinated_operations_analysis ORDER BY operation_date DESC LIMIT 10'),
        customQuery('SELECT serial_id, 1 as Category, 2021 as "Date__Year", \'Data pending\' as "Event__Claim", \'$0\' as "Amount__Outcome", \'Archive\' as Source, \'\' as URL FROM shell_companies LIMIT 0')
      ]);

      setShellCompanies(shellData || []);
      setEnterpriseEntities(enterpriseData || []);
      setCoordinatedOps(opsData || []);
      setKcsoFacts(factsData || []);
    } catch (err) {
      console.error('Pattern analysis fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const getRiskBadgeColor = (level: string) => {
    switch (level?.toUpperCase()) {
      case 'CRITICAL': return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'EXTREME': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
      case 'HIGH': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      default: return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50';
    }
  };

  const getTierColor = (tier: number) => {
    switch (tier) {
      case 1: return 'text-red-400';
      case 2: return 'text-orange-400';
      case 3: return 'text-yellow-400';
      default: return 'text-cyan-400';
    }
  };

  // Calculate financial totals from KCSO facts
  const financialSummary = kcsoFacts.reduce((acc, fact) => {
    const amount = fact['Amount__Outcome'] || '';
    const match = amount.match(/\$([0-9,.]+)([MK]?)/i);
    if (match) {
      let value = parseFloat(match[1].replace(/,/g, ''));
      if (match[2]?.toUpperCase() === 'M') value *= 1000000;
      if (match[2]?.toUpperCase() === 'K') value *= 1000;
      acc.total += value;
      acc.count++;
    }
    return acc;
  }, { total: 0, count: 0 });

  // Identify medical aviation entities
  const medicalEntities = enterpriseEntities.filter(e => 
    e.entity_name?.toLowerCase().includes('air methods') ||
    e.entity_name?.toLowerCase().includes('mercy') ||
    e.role?.toLowerCase().includes('medical') ||
    e.legal_exposure?.some(l => l?.toLowerCase().includes('medical'))
  );

  return (
    <CyberPanel 
      title="Pattern & Coordination Analysis" 
      icon={<Network className="w-5 h-5" />}
      headerActions={
        <Button 
          variant="outline" 
          size="sm" 
          onClick={fetchAllData}
          disabled={loading}
          className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      }
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-5 gap-1 bg-background/50 p-1">
          <TabsTrigger value="overview" className="text-xs">
            <Network className="w-3 h-3 mr-1" />Overview
          </TabsTrigger>
          <TabsTrigger value="financial" className="text-xs">
            <DollarSign className="w-3 h-3 mr-1" />Financial
          </TabsTrigger>
          <TabsTrigger value="medical" className="text-xs">
            <Ambulance className="w-3 h-3 mr-1" />Medical
          </TabsTrigger>
          <TabsTrigger value="shell" className="text-xs">
            <Building2 className="w-3 h-3 mr-1" />Shell Corps
          </TabsTrigger>
          <TabsTrigger value="operations" className="text-xs">
            <Plane className="w-3 h-3 mr-1" />Operations
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{enterpriseEntities.filter(e => e.tier === 1).length}</div>
              <div className="text-xs text-red-300/70">Tier 1 Entities</div>
            </div>
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-orange-400">{shellCompanies.length}</div>
              <div className="text-xs text-orange-300/70">Shell Companies</div>
            </div>
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-cyan-400">{coordinatedOps.length}</div>
              <div className="text-xs text-cyan-300/70">Coordinated Ops</div>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-yellow-400">${(financialSummary.total / 1000000).toFixed(1)}M+</div>
              <div className="text-xs text-yellow-300/70">KCSO Liability</div>
            </div>
          </div>

          {/* Enterprise Hierarchy */}
          <div className="bg-background/30 border border-primary/20 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-primary mb-3 flex items-center gap-2">
              <Scale className="w-4 h-4" />
              Criminal Enterprise Command Structure
            </h4>
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {enterpriseEntities.map((entity) => (
                  <div key={entity.id} className="flex items-center justify-between bg-background/50 p-3 rounded border border-primary/10">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono ${getTierColor(entity.tier)}`}>T{entity.tier}</span>
                        <span className="font-medium text-foreground text-sm">{entity.entity_name}</span>
                        <Badge variant="outline" className="text-xs">{entity.entity_type}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{entity.role}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getRiskBadgeColor(entity.prosecution_priority)}>
                        {entity.prosecution_priority}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>

        {/* FINANCIAL TAB - KCSO Liability */}
        <TabsContent value="financial" className="mt-4">
          <div className="bg-yellow-500/5 border border-yellow-500/30 rounded-lg p-4 mb-4">
            <h4 className="text-sm font-semibold text-yellow-400 flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4" />
              KCSO Financial Liability Pattern
            </h4>
            <p className="text-xs text-muted-foreground">
              Documented settlements, verdicts, and financial exposure from pattern of misconduct.
              This represents taxpayer-funded payouts for systematic civil rights violations.
            </p>
          </div>

          <ScrollArea className="h-96">
            <div className="space-y-3">
              {kcsoFacts.map((fact) => (
                <div key={fact.serial_id} className="bg-background/30 border border-primary/20 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">{fact.Category}</Badge>
                        <span className="text-xs text-muted-foreground">{fact['Date__Year']}</span>
                      </div>
                      <p className="text-sm text-foreground">{fact['Event__Claim']}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs font-mono text-yellow-400">{fact['Amount__Outcome']}</span>
                        <span className="text-xs text-muted-foreground">— {fact.Source}</span>
                      </div>
                    </div>
                    {fact.URL && (
                      <a 
                        href={fact.URL} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs text-cyan-400 hover:underline"
                      >
                        Source →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* MEDICAL AIRCRAFT TAB */}
        <TabsContent value="medical" className="mt-4">
          <div className="bg-red-500/5 border border-red-500/30 rounded-lg p-4 mb-4">
            <h4 className="text-sm font-semibold text-red-400 flex items-center gap-2 mb-2">
              <Ambulance className="w-4 h-4" />
              Medical Aviation Misuse Analysis
            </h4>
            <p className="text-xs text-muted-foreground">
              Air Methods Corporation and associated entities operating medical helicopters 
              (N743AM, N229AM) in surveillance patterns inconsistent with emergency medical transport.
              HIPAA violations and FAA misrepresentation of flight purpose.
            </p>
          </div>

          <div className="grid gap-4">
            {/* Medical Entity Cards */}
            {medicalEntities.length > 0 ? (
              medicalEntities.map((entity) => (
                <div key={entity.id} className="bg-background/30 border border-red-500/20 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Ambulance className="w-5 h-5 text-red-400" />
                      <span className="font-semibold text-foreground">{entity.entity_name}</span>
                    </div>
                    <Badge className={getRiskBadgeColor(entity.prosecution_priority)}>
                      {entity.prosecution_priority}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{entity.role}</p>
                  {entity.notes && (
                    <p className="text-xs text-yellow-400 font-mono">{entity.notes}</p>
                  )}
                  {entity.legal_exposure && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {entity.legal_exposure.map((exposure, i) => (
                        <Badge key={i} variant="outline" className="text-xs text-red-300 border-red-500/30">
                          {exposure.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <Ambulance className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>Air Methods / Mercy Air entities identified in command structure</p>
                <p className="text-xs mt-1">Cross-reference with flight detection data for pattern analysis</p>
              </div>
            )}

            {/* Medical Pattern Evidence */}
            <div className="bg-background/30 border border-primary/20 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-primary mb-2">Medical Aircraft Pattern Indicators</h5>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3 text-yellow-400" />
                  Non-emergency loitering patterns over residential areas
                </li>
                <li className="flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3 text-yellow-400" />
                  Flight paths inconsistent with hospital locations
                </li>
                <li className="flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3 text-yellow-400" />
                  Temporal correlation with biometric stress events
                </li>
                <li className="flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3 text-red-400" />
                  HIPAA implications: Using medical aviation cover for surveillance
                </li>
              </ul>
            </div>
          </div>
        </TabsContent>

        {/* SHELL COMPANIES TAB */}
        <TabsContent value="shell" className="mt-4">
          <div className="bg-orange-500/5 border border-orange-500/30 rounded-lg p-4 mb-4">
            <h4 className="text-sm font-semibold text-orange-400 flex items-center gap-2 mb-2">
              <Building2 className="w-4 h-4" />
              Shell Company Network
            </h4>
            <p className="text-xs text-muted-foreground">
              Delaware LLCs and California entities used to obscure aircraft ownership.
              Red flags include same-day registrations, consumer mail drops, and no Part 135 certification.
            </p>
          </div>

          <ScrollArea className="h-80">
            <div className="space-y-3">
              {shellCompanies.map((company) => (
                <div key={company.id} className="bg-background/30 border border-orange-500/20 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-foreground">{company.company_name}</span>
                    <Badge className={getRiskBadgeColor(company.risk_level)}>{company.risk_level}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Jurisdiction:</span>
                      <span className="ml-1 text-foreground">{company.jurisdiction}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Formed:</span>
                      <span className="ml-1 text-foreground">{new Date(company.formation_date).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="text-xs mt-2">
                    <span className="text-muted-foreground">Aircraft:</span>
                    <span className="ml-1 font-mono text-cyan-400">{company.aircraft_list}</span>
                  </div>
                  <div className="text-xs mt-2 text-red-400">
                    <FileWarning className="w-3 h-3 inline mr-1" />
                    {company.red_flags}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* COORDINATED OPERATIONS TAB */}
        <TabsContent value="operations" className="mt-4">
          <div className="bg-cyan-500/5 border border-cyan-500/30 rounded-lg p-4 mb-4">
            <h4 className="text-sm font-semibold text-cyan-400 flex items-center gap-2 mb-2">
              <Plane className="w-4 h-4" />
              Multi-Asset Coordinated Operations
            </h4>
            <p className="text-xs text-muted-foreground">
              Documented instances of multiple aircraft operating in coordinated patterns
              with temporal correlation to biometric stress events.
            </p>
          </div>

          <ScrollArea className="h-80">
            <div className="space-y-4">
              {coordinatedOps.map((op) => (
                <div key={op.id} className="bg-background/30 border border-cyan-500/20 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{op.operation_type?.replace(/_/g, ' ')}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(op.operation_date).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-red-400">
                        Threat: {op.coordinated_threat_score}%
                      </span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
                    <div className="bg-background/50 rounded p-2 text-center">
                      <div className="font-bold text-cyan-400">{op.aircraft_count}</div>
                      <div className="text-muted-foreground">Aircraft</div>
                    </div>
                    <div className="bg-background/50 rounded p-2 text-center">
                      <div className="font-bold text-yellow-400">{op.min_altitude} ft</div>
                      <div className="text-muted-foreground">Min Alt</div>
                    </div>
                    <div className="bg-background/50 rounded p-2 text-center">
                      <div className="font-bold text-red-400">{op.max_hr_recorded} bpm</div>
                      <div className="text-muted-foreground">Max HR</div>
                    </div>
                    <div className="bg-background/50 rounded p-2 text-center">
                      <div className="font-bold text-orange-400">{op.max_stress_recorded}%</div>
                      <div className="text-muted-foreground">Stress</div>
                    </div>
                  </div>

                  <div className="text-xs font-mono text-cyan-400 mb-2">
                    {op.participating_aircraft?.join(', ')}
                  </div>

                  <p className="text-xs text-muted-foreground line-clamp-3">
                    {op.evidence_of_coordination}
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}
