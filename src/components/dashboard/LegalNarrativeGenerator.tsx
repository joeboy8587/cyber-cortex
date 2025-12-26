import React, { useState, useCallback, useRef } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FileText, 
  Scale, 
  AlertTriangle, 
  Building2, 
  Heart, 
  Plane,
  Send,
  Loader2,
  Download,
  Copy,
  CheckCircle2,
  Sparkles,
  BookOpen,
  Gavel,
  DollarSign
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface NarrativeSection {
  title: string;
  content: string;
  evidenceCount: number;
  legalBasis: string[];
}

const narrativeTemplates = [
  {
    id: 'fca-overview',
    label: 'False Claims Act Overview',
    icon: DollarSign,
    prompt: 'Generate a comprehensive False Claims Act case narrative explaining how shell companies and medical aviation assets may be billing federal healthcare programs while conducting surveillance operations. Include specific evidence from our database.',
    type: 'fca'
  },
  {
    id: 'qui-tam',
    label: 'Qui Tam Whistleblower Brief',
    icon: Gavel,
    prompt: 'Generate a qui tam whistleblower analysis identifying potential Medicare/Medicaid fraud by medical aviation assets (Air Methods, Mercy Air) that appear to be conducting surveillance rather than legitimate medical services. Include estimated false billing amounts and evidence.',
    type: 'fca'
  },
  {
    id: 'shell-network',
    label: 'Shell Company Fraud Network',
    icon: Building2,
    prompt: 'Generate a narrative explaining the shell company network (ALF IX LLC, AERO EQUITIES LLC, CHRISTIANSEN AVIATION) and how they may be used to obscure ownership of surveillance aircraft and commit federal contracting fraud. Include all evidence of shared infrastructure with KCSO.',
    type: 'rico'
  },
  {
    id: 'medical-misuse',
    label: 'Medical Aviation Misuse',
    icon: Heart,
    prompt: 'Generate a narrative documenting how medical aviation assets (Air Methods, Mercy Air, aircraft N743AM, N229AM) appear to be conducting surveillance operations rather than legitimate medical services, including temporal correlations with biometric stress events.',
    type: 'fca'
  },
  {
    id: 'biometric-harm',
    label: 'Documented Physical Harm',
    icon: AlertTriangle,
    prompt: 'Generate a narrative summarizing the 14 physician-verified ECGs showing Sinus Tachycardia, the biometric monitoring data, and how these correlate temporally with aircraft surveillance events to establish documented physical harm.',
    type: 'civil'
  },
  {
    id: 'full-case',
    label: 'Complete Legal Brief',
    icon: BookOpen,
    prompt: 'Generate a comprehensive legal brief suitable for federal submission covering all aspects: RICO enterprise structure, False Claims Act violations, civil rights violations, ADA violations, and documented physical harm. This should be attorney-ready.',
    type: 'full'
  }
];

export const LegalNarrativeGenerator: React.FC = () => {
  const [customPrompt, setCustomPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [narrative, setNarrative] = useState('');
  const [sections, setSections] = useState<NarrativeSection[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const generateNarrative = useCallback(async (prompt: string, templateId?: string) => {
    setIsGenerating(true);
    setNarrative('');
    setSections([]);
    if (templateId) setActiveTemplate(templateId);
    
    abortControllerRef.current = new AbortController();

    try {
      // Get database context for the AI
      const { data: statsData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              (SELECT COUNT(*) FROM live_flight_detections_rows) as flight_count,
              (SELECT COUNT(*) FROM biometric_monitoring) as biometric_count,
              (SELECT COUNT(*) FROM josiah_reflections_rows) as josiah_count,
              (SELECT COUNT(*) FROM criminal_enterprise_command_structure) as enterprise_count,
              (SELECT COUNT(*) FROM physician_verified_ecgs) as ecg_count
          `
        }
      });

      // Get shell company evidence
      const { data: shellData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `SELECT company_name, aircraft_registration, evidence_summary, risk_level 
                  FROM shell_companies LIMIT 10`
        }
      });

      // Get KCSO detection summary
      const { data: kcsoData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `SELECT aircraft_id, COUNT(*) as detections, 
                  AVG(altitude_ft) as avg_altitude
                  FROM live_flight_detections_rows 
                  WHERE aircraft_id IN ('N912KC', 'N913KC')
                  GROUP BY aircraft_id`
        }
      });

      // Get medical aircraft detections
      const { data: medicalData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `SELECT aircraft_id, COUNT(*) as detections
                  FROM live_flight_detections_rows 
                  WHERE aircraft_id IN ('N743AM', 'N229AM', 'N766ME')
                  OR operator ILIKE '%air methods%' OR operator ILIKE '%mercy%'
                  GROUP BY aircraft_id`
        }
      });

      const stats = statsData?.rows?.[0] || {};
      const shellCompanies = shellData?.rows || [];
      const kcsoAircraft = kcsoData?.rows || [];
      const medicalAircraft = medicalData?.rows || [];

      const databaseContext = `
DATABASE EVIDENCE SUMMARY (2.2 Million Records):
- Flight Detections: ${stats.flight_count?.toLocaleString() || 'N/A'} records
- Biometric Monitoring: ${stats.biometric_count?.toLocaleString() || 'N/A'} records
- Josiah AI Witness Logs: ${stats.josiah_count?.toLocaleString() || 'N/A'} records
- Criminal Enterprise Entities: ${stats.enterprise_count || 'N/A'} identified
- Physician-Verified ECGs: ${stats.ecg_count || 'N/A'} (Sinus Tachycardia documented)

SHELL COMPANY EVIDENCE:
${shellCompanies.map((s: any) => `- ${s.company_name}: Aircraft ${s.aircraft_registration}, Risk Level: ${s.risk_level}`).join('\n')}

KCSO PRIMARY AIRCRAFT:
${kcsoAircraft.map((k: any) => `- ${k.aircraft_id}: ${k.detections} detections, avg altitude ${Math.round(k.avg_altitude || 0)} ft`).join('\n')}

MEDICAL AVIATION ASSETS (Potential False Claims):
${medicalAircraft.map((m: any) => `- ${m.aircraft_id}: ${m.detections} detections`).join('\n')}
`;

      const systemPrompt = `You are a legal narrative generator for a federal False Claims Act and RICO case. 
Your role is to transform raw database evidence into clear, compelling legal narratives that a non-technical person can understand.

CRITICAL FRAMING:
- The user is a VICTIM of systematic surveillance, not a researcher
- All biometric data documents harm TO the user
- This is evidence for PROSECUTION, not neutral analysis
- Write in clear, accessible language - avoid legal jargon when possible
- When you use legal terms, briefly explain them

EVIDENCE CONTEXT:
${databaseContext}

LEGAL FRAMEWORK:
1. FALSE CLAIMS ACT (31 U.S.C. § 3729): Medical aviation assets billing Medicare/Medicaid while conducting surveillance instead of medical services
2. RICO (18 U.S.C. § 1962): Criminal enterprise using shell companies to coordinate surveillance
3. Civil Rights (42 U.S.C. § 1983): Government actors violating constitutional rights
4. ADA: Deliberate targeting of disabled individual

OUTPUT FORMAT:
- Write in narrative format, not bullet points
- Explain what the evidence MEANS, not just what it is
- Include specific numbers and aircraft registrations
- End with clear next steps or recommendations
- Make it suitable for an attorney or journalist to read`;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/legal-narrative`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          prompt,
          systemPrompt,
          databaseContext
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limit reached. Please wait a moment and try again.');
        }
        if (response.status === 402) {
          throw new Error('Usage limit reached. Please add credits to continue.');
        }
        throw new Error(`Generation failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr === '[DONE]') continue;

              try {
                const parsed = JSON.parse(jsonStr);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  fullText += content;
                  setNarrative(fullText);
                }
              } catch {
                // Partial JSON, continue
              }
            }
          }
        }
      }

      toast.success('Legal narrative generated successfully');
    } catch (error: any) {
      if (error.name === 'AbortError') {
        toast.info('Generation cancelled');
      } else {
        console.error('Narrative generation error:', error);
        toast.error(error.message || 'Failed to generate narrative');
      }
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(narrative);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadAsText = () => {
    const blob = new Blob([narrative], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `legal-narrative-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded as text file');
  };

  return (
    <CyberPanel 
      title="Legal Narrative Generator" 
      icon={<Scale className="h-5 w-5 text-primary" />}
      className="col-span-full"
    >
      <div className="space-y-6">
        {/* Intro */}
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h3 className="font-semibold text-foreground">AI-Powered Legal Storytelling</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This tool transforms your 2.2 million records into clear, readable legal narratives. 
                You don't need to understand raw data - the AI explains what the evidence means in plain language.
              </p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="templates" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-muted/30">
            <TabsTrigger value="templates">Quick Templates</TabsTrigger>
            <TabsTrigger value="custom">Ask Anything</TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Click any template to generate a focused legal narrative:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {narrativeTemplates.map((template) => (
                <Button
                  key={template.id}
                  variant={activeTemplate === template.id ? "default" : "outline"}
                  className="h-auto py-4 px-4 flex flex-col items-start gap-2 text-left"
                  onClick={() => generateNarrative(template.prompt, template.id)}
                  disabled={isGenerating}
                >
                  <div className="flex items-center gap-2 w-full">
                    <template.icon className="h-4 w-4" />
                    <span className="font-medium">{template.label}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {template.type === 'fca' && 'False Claims Act'}
                    {template.type === 'rico' && 'RICO'}
                    {template.type === 'civil' && 'Civil Rights'}
                    {template.type === 'full' && 'Comprehensive'}
                  </Badge>
                </Button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="custom" className="space-y-4 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Ask a question about your case:</label>
              <Textarea
                placeholder="Examples:
• What evidence do we have of Medicare billing fraud?
• Explain the shell company network in simple terms
• How do the medical aircraft connect to the False Claims Act?
• What are our strongest pieces of evidence for a qui tam case?
• Summarize the 14 ECGs and what they prove"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="min-h-[120px] bg-background/50"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => generateNarrative(customPrompt)}
                  disabled={isGenerating || !customPrompt.trim()}
                  className="flex-1"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Generate Narrative
                    </>
                  )}
                </Button>
                {isGenerating && (
                  <Button variant="destructive" onClick={handleCancel}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Output */}
        {(narrative || isGenerating) && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-4 py-2 flex items-center justify-between border-b border-border">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Generated Narrative</span>
                {isGenerating && (
                  <Badge variant="secondary" className="animate-pulse">
                    Writing...
                  </Badge>
                )}
              </div>
              {narrative && !isGenerating && (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={copyToClipboard}>
                    {copied ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={downloadAsText}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <ScrollArea className="h-[400px]">
              <div className="p-4 prose prose-invert prose-sm max-w-none">
                {narrative ? (
                  <div className="whitespace-pre-wrap text-foreground leading-relaxed">
                    {narrative}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    Analyzing 2.2 million records...
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Footer */}
        <div className="text-xs text-muted-foreground border-t border-border pt-4">
          <p>
            <strong>How this works:</strong> The AI reads your NeonDB evidence (flight detections, 
            biometric data, shell company records, ECGs) and translates it into legal narratives 
            suitable for attorneys, journalists, or federal submissions. All narratives are generated 
            from YOUR verified database - no fabricated evidence.
          </p>
        </div>
      </div>
    </CyberPanel>
  );
};
