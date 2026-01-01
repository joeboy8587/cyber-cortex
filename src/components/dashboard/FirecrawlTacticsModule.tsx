import React, { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Crosshair, Plane, Activity, Building2, Clock, Download, Search, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { firecrawlApi } from '@/lib/api/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface TacticResult {
  id: string;
  tactic: string;
  target: string;
  timestamp: string;
  success: boolean;
  data?: any;
  findings?: string[];
  error?: string;
}

interface CrawlTarget {
  name: string;
  url: string;
  fields: string[];
  description: string;
}

const TACTIC_TARGETS: Record<string, CrawlTarget[]> = {
  tailSwarm: [
    { name: 'FAA Registry', url: 'https://registry.faa.gov/AircraftInquiry/Search/NNumberResult', fields: ['n_number', 'serial', 'registrant', 'mode_s_hex'], description: 'Official FAA registration data' },
    { name: 'ADS-B Exchange', url: 'https://globe.adsbexchange.com', fields: ['icao', 'callsign', 'altitude', 'track'], description: 'Real-time transponder data' },
  ],
  loitering: [
    { name: 'FlightAware History', url: 'https://flightaware.com/live/flight', fields: ['altitude', 'speed', 'heading', 'duration'], description: 'Flight track history' },
    { name: 'ADS-B Exchange Globe', url: 'https://globe.adsbexchange.com', fields: ['lat', 'lon', 'alt_baro', 'gs'], description: 'Historical position data' },
  ],
  medicalCosplay: [
    { name: 'Air Methods Fleet', url: 'https://www.airmethods.com', fields: ['base', 'aircraft_type', 'mission_type'], description: 'Official medical fleet data' },
    { name: 'Helis.com', url: 'https://www.helis.com', fields: ['operator', 'model', 'registration'], description: 'Helicopter database' },
  ],
  shellCompany: [
    { name: 'Delaware Corps', url: 'https://icis.corp.delaware.gov', fields: ['entity_name', 'file_number', 'status', 'agent'], description: 'Delaware corporate registry' },
    { name: 'Wyoming SOS', url: 'https://wyobiz.wyo.gov', fields: ['business_name', 'filing_date', 'registered_agent'], description: 'Wyoming business search' },
    { name: 'OpenCorporates', url: 'https://opencorporates.com', fields: ['company_name', 'jurisdiction', 'officers'], description: 'Global corporate data' },
  ],
  timeline: [
    { name: 'Internal Correlations', url: 'internal://master_biometric_aircraft_correlations', fields: ['timestamp', 'registration', 'heart_rate', 'hr_spike_detected'], description: 'Watchtower fusion events' },
  ],
};

export const FirecrawlTacticsModule: React.FC = () => {
  const [activeTactic, setActiveTactic] = useState<string>('tailSwarm');
  const [targetInput, setTargetInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<TacticResult[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);

  const tactics = [
    { id: 'tailSwarm', name: 'Tail Swarm Analysis', icon: Plane, description: 'Detect ICAO aliasing (XXB → N912KC)' },
    { id: 'loitering', name: 'Loitering Signature', icon: Crosshair, description: 'Map sub-500ft patrol patterns' },
    { id: 'medicalCosplay', name: 'Medical Cosplay Trace', icon: Activity, description: 'Verify medical vs actual behavior' },
    { id: 'shellCompany', name: 'Shell Company Backtrace', icon: Building2, description: 'Cross-link registrations & P.O. boxes' },
    { id: 'timeline', name: 'Timeline Correlation', icon: Clock, description: 'Align flights with biometric spikes' },
  ];

  const runTactic = async () => {
    if (!targetInput.trim()) {
      toast.error('Enter a target (tail number, company name, or ICAO)');
      return;
    }

    setIsRunning(true);
    const newResults: TacticResult[] = [];

    try {
      const targets = TACTIC_TARGETS[activeTactic] || [];
      
      for (const target of targets) {
        if (selectedTargets.length > 0 && !selectedTargets.includes(target.name)) continue;

        const resultId = `${activeTactic}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        
        try {
          let response;
          let findings: string[] = [];

          if (target.url.startsWith('internal://')) {
            // Internal database query
            const tableName = target.url.replace('internal://', '');
            const { data } = await supabase.functions.invoke('neon-query', {
              body: {
                action: 'customQuery',
                query: `SELECT * FROM ${tableName} WHERE registration ILIKE '%${targetInput}%' OR icao_hex ILIKE '%${targetInput}%' LIMIT 50`
              }
            });
            
            if (data && data.length > 0) {
              findings.push(`Found ${data.length} correlation events`);
              findings.push(`HR spikes detected: ${data.filter((d: any) => d.hr_spike_detected).length}`);
              findings.push(`Avg heart rate: ${Math.round(data.reduce((a: number, d: any) => a + (d.heart_rate || 0), 0) / data.length)} BPM`);
            }
            
            newResults.push({
              id: resultId,
              tactic: activeTactic,
              target: target.name,
              timestamp: new Date().toISOString(),
              success: true,
              data,
              findings
            });
          } else if (activeTactic === 'tailSwarm') {
            // FAA Registry lookup
            response = await firecrawlApi.lookupFaaRegistry(targetInput);
            
            if (response.success && response.data) {
              const markdown = response.data.markdown || response.data.data?.markdown || '';
              
              // Parse key fields
              if (markdown.includes('Mode S Code')) {
                findings.push('Mode S transponder code found');
              }
              if (markdown.includes('Fractional Owner')) {
                findings.push('⚠️ Fractional ownership detected - possible shell');
              }
              if (markdown.toLowerCase().includes('llc') || markdown.toLowerCase().includes('trust')) {
                findings.push('⚠️ LLC/Trust registration - obfuscation pattern');
              }
            }
            
            newResults.push({
              id: resultId,
              tactic: activeTactic,
              target: target.name,
              timestamp: new Date().toISOString(),
              success: response.success,
              data: response.data,
              findings,
              error: response.error
            });
          } else if (activeTactic === 'shellCompany') {
            // Search for company information
            response = await firecrawlApi.searchShellCompany(targetInput);
            
            if (response.success && response.data) {
              const results = response.data.data || response.data || [];
              if (Array.isArray(results)) {
                findings.push(`Found ${results.length} corporate records`);
                results.slice(0, 3).forEach((r: any) => {
                  if (r.title) findings.push(`→ ${r.title.slice(0, 60)}...`);
                });
              }
            }
            
            newResults.push({
              id: resultId,
              tactic: activeTactic,
              target: target.name,
              timestamp: new Date().toISOString(),
              success: response.success,
              data: response.data,
              findings,
              error: response.error
            });
          } else if (activeTactic === 'medicalCosplay') {
            // Search for operator info
            response = await firecrawlApi.searchOperator(targetInput);
            
            if (response.success && response.data) {
              const results = response.data.data || response.data || [];
              if (Array.isArray(results)) {
                results.forEach((r: any) => {
                  const content = r.markdown || r.description || '';
                  if (content.toLowerCase().includes('medical') || content.toLowerCase().includes('ems')) {
                    findings.push('✓ Medical mission claims found');
                  }
                  if (content.toLowerCase().includes('law enforcement') || content.toLowerCase().includes('surveillance')) {
                    findings.push('⚠️ Law enforcement/surveillance capability mentioned');
                  }
                });
              }
            }
            
            newResults.push({
              id: resultId,
              tactic: activeTactic,
              target: target.name,
              timestamp: new Date().toISOString(),
              success: response.success,
              data: response.data,
              findings,
              error: response.error
            });
          } else {
            // Generic scrape
            response = await firecrawlApi.scrape(target.url, { formats: ['markdown'], onlyMainContent: true });
            
            newResults.push({
              id: resultId,
              tactic: activeTactic,
              target: target.name,
              timestamp: new Date().toISOString(),
              success: response.success,
              data: response.data,
              findings: response.success ? ['Data extracted successfully'] : [],
              error: response.error
            });
          }
        } catch (err) {
          newResults.push({
            id: resultId,
            tactic: activeTactic,
            target: target.name,
            timestamp: new Date().toISOString(),
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error'
          });
        }
      }

      setResults(prev => [...newResults, ...prev]);
      toast.success(`Tactic complete: ${newResults.filter(r => r.success).length}/${newResults.length} sources succeeded`);
    } catch (error) {
      toast.error('Tactic execution failed');
      console.error(error);
    } finally {
      setIsRunning(false);
    }
  };

  const exportResults = () => {
    const json = JSON.stringify(results, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `firecrawl-${activeTactic}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Results exported');
  };

  const currentTactic = tactics.find(t => t.id === activeTactic);
  const currentTargets = TACTIC_TARGETS[activeTactic] || [];

  return (
    <CyberPanel title="Firecrawl Tactics Module" icon={<Crosshair className="h-5 w-5 text-primary" />}>
      <Tabs value={activeTactic} onValueChange={setActiveTactic} className="space-y-4">
        <TabsList className="grid grid-cols-5 gap-1">
          {tactics.map(tactic => (
            <TabsTrigger key={tactic.id} value={tactic.id} className="text-xs px-2">
              <tactic.icon className="h-3 w-3 mr-1" />
              <span className="hidden sm:inline">{tactic.name.split(' ')[0]}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="space-y-4">
          {/* Tactic Description */}
          <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              {currentTactic && <currentTactic.icon className="h-4 w-4 text-primary" />}
              <span className="font-semibold text-sm">{currentTactic?.name}</span>
            </div>
            <p className="text-xs text-muted-foreground">{currentTactic?.description}</p>
          </div>

          {/* Target Sources */}
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">Data Sources:</span>
            <div className="flex flex-wrap gap-2">
              {currentTargets.map(target => (
                <Badge
                  key={target.name}
                  variant={selectedTargets.includes(target.name) || selectedTargets.length === 0 ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => {
                    if (selectedTargets.includes(target.name)) {
                      setSelectedTargets(prev => prev.filter(t => t !== target.name));
                    } else {
                      setSelectedTargets(prev => [...prev, target.name]);
                    }
                  }}
                >
                  {target.name}
                </Badge>
              ))}
            </div>
          </div>

          {/* Input & Actions */}
          <div className="flex gap-2">
            <Input
              placeholder={
                activeTactic === 'tailSwarm' ? 'Enter N-Number (e.g., N912KC)' :
                activeTactic === 'shellCompany' ? 'Enter company name' :
                activeTactic === 'medicalCosplay' ? 'Enter operator name' :
                'Enter search target'
              }
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="flex-1"
            />
            <Button onClick={runTactic} disabled={isRunning}>
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-2 hidden sm:inline">Execute</span>
            </Button>
            {results.length > 0 && (
              <Button variant="outline" onClick={exportResults}>
                <Download className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Quick Targets */}
          {activeTactic === 'tailSwarm' && (
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground mr-2">Quick:</span>
              {['N912KC', 'N913KC', 'N480MT', 'N121HT', 'XXB'].map(tail => (
                <Badge
                  key={tail}
                  variant="outline"
                  className="cursor-pointer text-xs hover:bg-primary/20"
                  onClick={() => setTargetInput(tail)}
                >
                  {tail}
                </Badge>
              ))}
            </div>
          )}

          {/* Results */}
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {results.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-8">
                  Select a tactic and enter a target to begin
                </div>
              ) : (
                results.map(result => (
                  <div
                    key={result.id}
                    className={`p-3 rounded-lg border ${
                      result.success ? 'border-green-500/30 bg-green-500/5' : 'border-destructive/30 bg-destructive/5'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {result.success ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        )}
                        <span className="font-medium text-sm">{result.target}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(result.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    
                    {result.findings && result.findings.length > 0 && (
                      <div className="space-y-1 mt-2">
                        {result.findings.map((finding, i) => (
                          <div key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                            <span className="text-primary">•</span>
                            <span>{finding}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {result.error && (
                      <p className="text-xs text-destructive mt-1">{result.error}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </Tabs>
    </CyberPanel>
  );
};
