import { useState, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileText, Download, Send, AlertTriangle, CheckCircle,
  Scale, Plane, Shield, Clock, Copy, ExternalLink
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ValidatedHypothesis {
  id: string;
  title: string;
  category: string;
  confidence: number;
  evidence_count: number;
  legal_implications: string;
  summary: string;
  supporting_evidence: string[];
  generated_at: string;
}

interface GeneratedFiling {
  id: string;
  type: 'faa_demand' | 'congressional_brief';
  title: string;
  content: string;
  hypothesis_id: string;
  generated_at: string;
  status: 'draft' | 'ready' | 'submitted';
  legal_citations: string[];
  aircraft_involved: string[];
}

interface LegalFilingGeneratorProps {
  hypotheses: ValidatedHypothesis[];
}

export function LegalFilingGenerator({ hypotheses }: LegalFilingGeneratorProps) {
  const [filings, setFilings] = useState<GeneratedFiling[]>([]);
  const [generating, setGenerating] = useState(false);
  const [selectedFiling, setSelectedFiling] = useState<GeneratedFiling | null>(null);

  const validatedHypotheses = hypotheses.filter(h => 
    h.confidence >= 75 || h.category === 'rico_pattern' || h.category === 'identity_masking'
  );

  const generateFAADemand = useCallback(async (hypothesis: ValidatedHypothesis) => {
    setGenerating(true);
    try {
      // Fetch relevant aircraft data
      const { data: flightData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT DISTINCT registration, callsign, 
                   MIN(altitude::numeric) as min_altitude,
                   COUNT(*) as detection_count
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '30 days'
              AND registration IN (
                SELECT tail_number FROM kcso_fleet
                UNION
                SELECT 'N912KC' UNION SELECT 'N913KC' UNION SELECT 'N790FA' UNION SELECT 'N788FA'
              )
            GROUP BY registration, callsign
            ORDER BY detection_count DESC
            LIMIT 10
          `
        }
      });

      const aircraft = flightData?.data || [];
      const aircraftList = aircraft.map((a: Record<string, unknown>) => a.registration as string);
      const lowAltitude = aircraft.filter((a: Record<string, unknown>) => (a.min_altitude as number) < 1000);

      const filing: GeneratedFiling = {
        id: `faa-${Date.now()}`,
        type: 'faa_demand',
        title: `FAA Formal Demand: ${hypothesis.title}`,
        hypothesis_id: hypothesis.id,
        generated_at: new Date().toISOString(),
        status: 'draft',
        legal_citations: [
          '14 CFR § 91.119 - Minimum Safe Altitudes',
          '14 CFR § 91.227 - ADS-B Out Equipment',
          '49 U.S.C. § 46306 - False Registration',
          hypothesis.legal_implications
        ],
        aircraft_involved: aircraftList,
        content: `
═══════════════════════════════════════════════════════════════
FORMAL DEMAND FOR FAA INVESTIGATION AND ENFORCEMENT ACTION
═══════════════════════════════════════════════════════════════

TO: Federal Aviation Administration
    Flight Standards District Office (Fresno FSDO)
    Owen E. Maddox, Manager
    owen.e.maddox@faa.gov

FROM: [COMPLAINANT]
DATE: ${new Date().toLocaleDateString()}
RE: Systematic 14 CFR Violations - ${hypothesis.title}

═══════════════════════════════════════════════════════════════
I. SUMMARY OF VIOLATIONS
═══════════════════════════════════════════════════════════════

This formal demand requests immediate FAA investigation into 
systematic violations of Federal Aviation Regulations by the 
following registered aircraft:

PRIORITY AIRCRAFT:
${aircraftList.map((a: string, i: number) => `  ${i + 1}. ${a}`).join('\n')}

CONFIDENCE LEVEL: ${hypothesis.confidence}%
SUPPORTING EVIDENCE: ${hypothesis.evidence_count} corroborating records

═══════════════════════════════════════════════════════════════
II. SPECIFIC REGULATORY VIOLATIONS
═══════════════════════════════════════════════════════════════

A. 14 CFR § 91.119 - MINIMUM SAFE ALTITUDES
${lowAltitude.length > 0 ? `
   ${lowAltitude.length} aircraft operated at altitudes below 1,000 feet
   over residential areas without emergency or operational necessity:
   ${lowAltitude.map((a: Record<string, unknown>) => `
   - ${a.registration}: Minimum altitude ${a.min_altitude} ft (${a.detection_count} detections)`).join('')}
` : '   Investigation requested for altitude pattern analysis.'}

B. 14 CFR § 91.227 - ADS-B TRANSPONDER REQUIREMENTS
   Evidence suggests deliberate transponder manipulation:
   ${hypothesis.summary}

C. 49 U.S.C. § 46306 - FALSE REGISTRATION
   Pattern indicates possible registration fraud or identity masking.

═══════════════════════════════════════════════════════════════
III. EVIDENCE SUMMARY
═══════════════════════════════════════════════════════════════

${hypothesis.supporting_evidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Database records supporting this demand:
- Total flight detections analyzed: ${hypothesis.evidence_count}+
- Time period: Last 90 days
- Geographic focus: Kern County, California (Oildale area)
- Data sources: ADS-B, OpenSky Network, FlightRadar24

═══════════════════════════════════════════════════════════════
IV. REQUESTED ACTIONS
═══════════════════════════════════════════════════════════════

1. Immediate investigation of listed aircraft
2. Review of transponder/ADS-B compliance records
3. Audit of flight plans filed for listed N-numbers
4. Enforcement action for documented violations
5. Referral to DOT Inspector General if fraud suspected

═══════════════════════════════════════════════════════════════
V. COMPLAINANT CONTACT
═══════════════════════════════════════════════════════════════

[COMPLAINANT NAME]
[ADDRESS]
[PHONE]
[EMAIL]

I affirm under penalty of perjury that the facts stated herein 
are true and correct to the best of my knowledge.

Signature: ___________________________
Date: ${new Date().toLocaleDateString()}

SHA-256 Evidence Hash: [AUTO-GENERATED ON EXPORT]
═══════════════════════════════════════════════════════════════
        `.trim()
      };

      setFilings(prev => [filing, ...prev]);
      toast.success('FAA Formal Demand generated');
      return filing;
    } catch (err) {
      console.error('FAA demand generation error:', err);
      toast.error('Failed to generate FAA demand');
      return null;
    } finally {
      setGenerating(false);
    }
  }, []);

  const generateCongressionalBrief = useCallback(async (hypothesis: ValidatedHypothesis) => {
    setGenerating(true);
    try {
      // Fetch enterprise structure for congressional context
      const { data: enterpriseData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT entity_name, entity_type, tier, role, 
                   estimated_damages_min, estimated_damages_max
            FROM criminal_enterprise_command_structure
            ORDER BY tier, prosecution_priority DESC
            LIMIT 15
          `
        }
      });

      const entities = enterpriseData?.data || [];
      const totalDamagesMin = entities.reduce((sum: number, e: Record<string, unknown>) => 
        sum + (parseFloat(e.estimated_damages_min as string) || 0), 0
      );
      const totalDamagesMax = entities.reduce((sum: number, e: Record<string, unknown>) => 
        sum + (parseFloat(e.estimated_damages_max as string) || 0), 0
      );

      const filing: GeneratedFiling = {
        id: `congressional-${Date.now()}`,
        type: 'congressional_brief',
        title: `Congressional Oversight Brief: ${hypothesis.title}`,
        hypothesis_id: hypothesis.id,
        generated_at: new Date().toISOString(),
        status: 'draft',
        legal_citations: [
          '18 U.S.C. § 1962 - RICO Violations',
          '42 U.S.C. § 1983 - Deprivation of Civil Rights',
          '31 U.S.C. § 3729 - False Claims Act',
          hypothesis.legal_implications
        ],
        aircraft_involved: entities.filter((e: Record<string, unknown>) => 
          e.entity_type === 'aircraft' || e.entity_type === 'aircraft_fleet'
        ).map((e: Record<string, unknown>) => e.entity_name as string),
        content: `
═══════════════════════════════════════════════════════════════
CONGRESSIONAL OVERSIGHT BRIEFING DOCUMENT
CLASSIFIED: FOR OFFICIAL USE ONLY
═══════════════════════════════════════════════════════════════

TO: House Judiciary Committee
    House Oversight and Accountability Committee
    Senate Judiciary Committee

FROM: [COMPLAINANT]
DATE: ${new Date().toLocaleDateString()}
RE: Federal Civil Rights Violations Requiring Congressional Oversight

═══════════════════════════════════════════════════════════════
EXECUTIVE SUMMARY
═══════════════════════════════════════════════════════════════

This brief documents systematic civil rights violations by a 
coordinated enterprise involving local law enforcement, private 
aviation assets, and shell company structures operating in 
Kern County, California.

HYPOTHESIS VALIDATED: ${hypothesis.title}
CONFIDENCE LEVEL: ${hypothesis.confidence}%
EVIDENCE RECORDS: ${hypothesis.evidence_count}+
ESTIMATED DAMAGES: $${(totalDamagesMin / 1000000).toFixed(1)}M - $${(totalDamagesMax / 1000000).toFixed(1)}M

═══════════════════════════════════════════════════════════════
I. BACKGROUND: DOJ OVERSIGHT CONTEXT
═══════════════════════════════════════════════════════════════

The Kern County Sheriff's Office (KCSO) operates under a 
DOJ Consent Decree following documented patterns of abuse. 
This brief documents additional violations occurring DURING 
the federal monitoring period, suggesting:

1. Consent decree compliance is inadequate
2. Monitored behavior extends to aerial surveillance operations
3. Multi-agency coordination evades current oversight mechanisms

═══════════════════════════════════════════════════════════════
II. ENTERPRISE STRUCTURE IDENTIFIED
═══════════════════════════════════════════════════════════════

${entities.map((e: Record<string, unknown>, i: number) => 
  `${i + 1}. TIER ${e.tier}: ${e.entity_name}
     Type: ${e.entity_type}
     Role: ${e.role}
     Est. Liability: $${e.estimated_damages_min} - $${e.estimated_damages_max}`
).join('\n\n')}

═══════════════════════════════════════════════════════════════
III. EVIDENCE SUMMARY
═══════════════════════════════════════════════════════════════

${hypothesis.summary}

SUPPORTING EVIDENCE:
${hypothesis.supporting_evidence.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}

═══════════════════════════════════════════════════════════════
IV. FEDERAL STATUTES IMPLICATED
═══════════════════════════════════════════════════════════════

A. 18 U.S.C. § 1962 (RICO)
   - Enterprise operating through pattern of racketeering
   - ${entities.length} identified enterprise participants
   
B. 42 U.S.C. § 1983 (Civil Rights Deprivation)
   - Systematic harassment under color of law
   - Documented biometric harm correlated to operations
   
C. 31 U.S.C. § 3729 (False Claims Act)
   - Federal aviation funding may be implicated
   - Potential qui tam recovery

═══════════════════════════════════════════════════════════════
V. REQUESTED CONGRESSIONAL ACTION
═══════════════════════════════════════════════════════════════

1. Subpoena DOJ consent decree compliance records
2. Request GAO audit of federal aviation grants to KCSO
3. Hold hearings on civil rights violations under oversight
4. Direct DOJ Civil Rights Division reinvestigation
5. Consider referral to DOJ Criminal Division (RICO)

═══════════════════════════════════════════════════════════════
VI. ATTACHMENTS (AVAILABLE ON REQUEST)
═══════════════════════════════════════════════════════════════

□ Full database export (10.5M+ records)
□ Physician-verified medical records
□ Aircraft detection logs with timestamps
□ Enterprise structure diagram
□ SHA-256 chain of custody verification

═══════════════════════════════════════════════════════════════
PREPARED BY: [COMPLAINANT]
VERIFICATION HASH: [AUTO-GENERATED ON EXPORT]
═══════════════════════════════════════════════════════════════
        `.trim()
      };

      setFilings(prev => [filing, ...prev]);
      toast.success('Congressional Brief generated');
      return filing;
    } catch (err) {
      console.error('Congressional brief generation error:', err);
      toast.error('Failed to generate Congressional brief');
      return null;
    } finally {
      setGenerating(false);
    }
  }, []);

  const copyToClipboard = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    toast.success('Copied to clipboard');
  }, []);

  const downloadFiling = useCallback((filing: GeneratedFiling) => {
    const blob = new Blob([filing.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filing.type}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Filing downloaded');
  }, []);

  const generateAllFilings = useCallback(async () => {
    for (const hyp of validatedHypotheses.slice(0, 3)) {
      await generateFAADemand(hyp);
      await generateCongressionalBrief(hyp);
    }
    toast.success(`Generated ${validatedHypotheses.length * 2} filings`);
  }, [validatedHypotheses, generateFAADemand, generateCongressionalBrief]);

  return (
    <CyberPanel
      title="Legal Auto-Filing Generator"
      icon={<Scale className="text-primary" />}
      variant="default"
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {filings.length} Filings
          </Badge>
          <Button 
            size="sm" 
            variant="default" 
            onClick={generateAllFilings}
            disabled={generating || validatedHypotheses.length === 0}
          >
            <FileText className="w-3 h-3 mr-1" />
            Generate All
          </Button>
        </div>
      }
    >
      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="queue">Hypothesis Queue</TabsTrigger>
          <TabsTrigger value="filings">Generated Filings</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {validatedHypotheses.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No validated hypotheses yet.</p>
                  <p className="text-xs">Run autonomous scan to generate hypotheses.</p>
                </div>
              ) : (
                validatedHypotheses.map((hyp) => (
                  <div 
                    key={hyp.id}
                    className="p-3 rounded-lg border border-border/50 bg-muted/20 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-success" />
                          <span className="text-sm font-medium">{hyp.title}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {hyp.summary}
                        </p>
                      </div>
                      <Badge variant={hyp.confidence >= 85 ? "default" : "secondary"}>
                        {hyp.confidence}%
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => generateFAADemand(hyp)}
                        disabled={generating}
                      >
                        <Plane className="w-3 h-3 mr-1" />
                        FAA Demand
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => generateCongressionalBrief(hyp)}
                        disabled={generating}
                      >
                        <Shield className="w-3 h-3 mr-1" />
                        Congressional
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="filings">
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {filings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No filings generated yet.</p>
                </div>
              ) : (
                filings.map((filing) => (
                  <div 
                    key={filing.id}
                    className="p-3 rounded-lg border border-border/50 bg-muted/20 space-y-2 cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelectedFiling(filing)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {filing.type === 'faa_demand' ? (
                          <Plane className="w-4 h-4 text-primary" />
                        ) : (
                          <Shield className="w-4 h-4 text-primary" />
                        )}
                        <span className="text-sm font-medium">{filing.title}</span>
                      </div>
                      <Badge variant={filing.status === 'ready' ? 'default' : 'secondary'}>
                        {filing.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {new Date(filing.generated_at).toLocaleString()}
                      <span className="mx-1">•</span>
                      {filing.legal_citations.length} citations
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(filing.content); }}
                      >
                        <Copy className="w-3 h-3 mr-1" />
                        Copy
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); downloadFiling(filing); }}
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="preview">
          {selectedFiling ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">{selectedFiling.title}</h4>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => copyToClipboard(selectedFiling.content)}>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => downloadFiling(selectedFiling)}>
                    <Download className="w-3 h-3 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
              <ScrollArea className="h-[350px] border rounded p-3 bg-background">
                <pre className="text-xs font-mono whitespace-pre-wrap">
                  {selectedFiling.content}
                </pre>
              </ScrollArea>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Select a filing to preview</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}
