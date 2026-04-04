import React, { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  ShieldAlert, Loader2, ScanLine, Wrench, CheckCircle2, AlertTriangle, Database
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function IcaoIdentityCleanup() {
  const [loading, setLoading] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [results, setResults] = useState<any>(null);
  const [activeStep, setActiveStep] = useState<string | null>(null);

  const run = async (step: string) => {
    setLoading(true);
    setActiveStep(step);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'icaoIdentityCleanup', step, dryRun }
      });
      if (error) throw error;
      setResults(data);
      toast.success(`${step} completed`);
    } catch (e: any) {
      toast.error(e.message || 'Cleanup failed');
    } finally {
      setLoading(false);
      setActiveStep(null);
    }
  };

  const scan = results?.scan;
  const post = results?.postCleanup;

  return (
    <CyberPanel
      title="ICAO IDENTITY CLEANUP PIPELINE"
      icon={<ShieldAlert className="h-5 w-5 text-cyan-400" />}
      className="col-span-full"
    >
      <div className="space-y-4">
        {/* Dry Run Toggle */}
        <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <div>
              <Label htmlFor="cleanup-dry" className="text-sm font-medium">Dry Run</Label>
              <p className="text-xs text-muted-foreground">Preview changes without modifying data</p>
            </div>
          </div>
          <Switch id="cleanup-dry" checked={dryRun} onCheckedChange={setDryRun} />
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { step: 'scan', label: '🔍 Scan', desc: 'Analyze contamination', icon: <ScanLine className="h-4 w-4" /> },
            { step: 'full', label: '🚀 Full Pipeline', desc: 'Run all cleanup steps', icon: <Database className="h-4 w-4" /> },
            { step: 'moveTaxonomy', label: 'Move XXB', desc: 'Extract taxonomy from icao_code', icon: <Wrench className="h-4 w-4" /> },
            { step: 'cleanRegistration', label: 'Clean Reg', desc: 'Remove XXB from registration', icon: <Wrench className="h-4 w-4" /> },
          ].map(({ step, label, desc, icon }) => (
            <Button
              key={step}
              variant={step === 'full' && !dryRun ? 'destructive' : 'outline'}
              className="h-auto p-3 flex flex-col items-start gap-1"
              disabled={loading}
              onClick={() => run(step)}
            >
              <div className="flex items-center gap-2">
                {activeStep === step ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
                <span className="font-medium text-sm">{label}</span>
              </div>
              <p className="text-xs opacity-70 text-left">{desc}</p>
            </Button>
          ))}
        </div>

        {/* Results */}
        {results && (
          <div className="space-y-4 p-4 bg-background/50 rounded-lg border border-border">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <h3 className="font-semibold">Results</h3>
              <Badge variant={dryRun ? 'secondary' : 'default'}>{dryRun ? 'Dry Run' : 'Executed'}</Badge>
            </div>

            {/* Pre-cleanup scan */}
            {scan && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatBox label="Total Rows" value={scan.total_rows} color="text-cyan-400" />
                <StatBox label="Taxonomy in ICAO" value={scan.taxonomy_in_icao} color="text-red-400" />
                <StatBox label="Type Codes in ICAO" value={scan.type_code_in_icao} color="text-orange-400" />
                <StatBox label="Valid Hex ICAO" value={scan.valid_hex_icao} color="text-green-400" />
                <StatBox label="XXB in Registration" value={scan.taxonomy_in_registration} color="text-red-400" />
                <StatBox label="Missing Registration" value={scan.missing_registration} color="text-yellow-400" />
                <StatBox label="Valid ICAO24" value={scan.valid_icao24} color="text-green-400" />
                <StatBox label="Valid Unmasked ICAO" value={scan.valid_unmasked_icao} color="text-green-400" />
              </div>
            )}

            {/* Post-cleanup stats */}
            {post && (
              <div className="mt-4">
                <h4 className="font-medium text-sm mb-2 text-green-400">Post-Cleanup Identity Coverage</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <StatBox label="ICAO24 Keyed" value={post.icao24_keyed} color="text-green-400" />
                  <StatBox label="Reg Keyed" value={post.reg_keyed} color="text-blue-400" />
                  <StatBox label="Callsign Keyed" value={post.cs_keyed} color="text-yellow-400" />
                  <StatBox label="Unknown" value={post.unknown_keyed} color="text-red-400" />
                  <StatBox label="Remaining XXB Reg" value={post.remaining_xxb_registration} color="text-red-400" />
                </div>
              </div>
            )}

            {/* Step results */}
            {results.moveTaxonomy && (
              <StepResult label="Move Taxonomy" result={results.moveTaxonomy} />
            )}
            {results.separateTypes && (
              <StepResult label="Separate Type Codes" result={results.separateTypes} />
            )}
            {results.cleanRegistration && (
              <StepResult label="Clean Registration" result={results.cleanRegistration} />
            )}
            {results.buildStableId && (
              <StepResult label="Build Stable ID" result={results.buildStableId} />
            )}

            {/* Contamination detail */}
            {results.icaoContamination && (
              <div className="mt-3">
                <h4 className="font-medium text-sm mb-2">ICAO Code Contamination (Top 20)</h4>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-1">
                    {results.icaoContamination.map((r: any, i: number) => (
                      <div key={i} className="flex justify-between items-center p-2 bg-muted/20 rounded text-xs font-mono">
                        <span>{r.icao_code}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={r.classification === 'TAXONOMY' ? 'destructive' : r.classification === 'TYPE_CODE' ? 'secondary' : 'default'} className="text-xs">
                            {r.classification}
                          </Badge>
                          <span>{r.count?.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Top XXB registrations */}
            {results.topXXBRegistrations && results.topXXBRegistrations.length > 0 && (
              <div className="mt-3">
                <h4 className="font-medium text-sm mb-2 text-red-400">Top XXB Registration Offenders</h4>
                <div className="space-y-1">
                  {results.topXXBRegistrations.map((r: any, i: number) => (
                    <div key={i} className="flex justify-between items-center p-2 bg-muted/20 rounded text-xs font-mono">
                      <span>{r.registration}</span>
                      <div className="flex items-center gap-3">
                        <span>{r.unique_callsigns} callsigns</span>
                        <span>avg {r.avg_alt}ft</span>
                        <Badge variant="destructive">{r.count?.toLocaleString()}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dry run preview */}
            {results.wouldFix && (
              <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
                <h4 className="font-medium text-sm text-yellow-400 mb-2">Would Fix (Dry Run)</h4>
                <ul className="text-xs space-y-1 text-muted-foreground">
                  <li>• Move {results.wouldFix.taxonomyMovedFromIcao?.toLocaleString()} taxonomy codes from icao_code</li>
                  <li>• Separate {results.wouldFix.typeCodesSeparated?.toLocaleString()} type codes from icao_code</li>
                  <li>• Clean {results.wouldFix.registrationXXBCleaned?.toLocaleString()} XXB values from registration</li>
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="p-3 bg-muted/30 rounded-lg">
      <p className={`text-xl font-bold ${color}`}>{(value ?? 0).toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function StepResult({ label, result }: { label: string; result: any }) {
  return (
    <div className="flex items-center justify-between p-2 bg-muted/20 rounded text-sm">
      <span>{label}</span>
      {result.error ? (
        <Badge variant="destructive">{result.error}</Badge>
      ) : (
        <Badge variant="default">{result.rowsUpdated?.toLocaleString() ?? 0} rows</Badge>
      )}
    </div>
  );
}
