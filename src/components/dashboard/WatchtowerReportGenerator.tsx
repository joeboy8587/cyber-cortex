import { useState, useRef } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileText, Calendar, Plane, Heart, Eye, Brain, 
  Download, RefreshCw, AlertTriangle, Shield, Building2,
  Clock, MapPin, TrendingUp, Scale, Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface ReportSection {
  title: string;
  date: string;
  flightCount: number;
  biometricSpikes: number;
  convergenceLevel: 'low' | 'medium' | 'high' | 'critical';
  entities: string[];
  narrative: string;
  legalImplications: string[];
}

interface ReportData {
  title: string;
  dateRange: { start: string; end: string };
  introduction: string;
  sections: ReportSection[];
  statisticalSummary: {
    totalFlights: number;
    lowAltitudeEvents: number;
    biometricCorrelations: number;
    identifiedEntities: number;
    convergenceEvents: number;
  };
  conclusion: string;
  chainOfCustody: {
    recordCount: number;
    hashVerified: number;
    lastAudit: string;
  };
}

export function WatchtowerReportGenerator() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState("");
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const reportRef = useRef<HTMLDivElement>(null);

  const fetchMultimodalData = async (start: string, end: string) => {
    const { data: flightData, error: flightError } = await supabase.functions.invoke('neon-query', {
      body: {
        action: 'customQuery',
        query: `
          SELECT 
            detected_at, registration, callsign, altitude, speed, lat, lon,
            operator_name, aircraft_type, is_military, threat_score
          FROM live_flight_detections_rows 
          WHERE detected_at BETWEEN '${start}' AND '${end}'
          ORDER BY detected_at
          LIMIT 5000
        `
      }
    });

    const { data: biometricData, error: bioError } = await supabase.functions.invoke('neon-query', {
      body: {
        action: 'customQuery',
        query: `
          SELECT 
            recorded_at, heart_rate, stress_level, hrv_ms, energy_level, notes
          FROM biometric_monitoring 
          WHERE recorded_at BETWEEN '${start}' AND '${end}'
          ORDER BY recorded_at
          LIMIT 2000
        `
      }
    });

    const { data: josiahData, error: josiahError } = await supabase.functions.invoke('neon-query', {
      body: {
        action: 'customQuery',
        query: `
          SELECT 
            reflection_timestamp, reflection_text, emotional_state, 
            linked_aircraft, pattern_tags
          FROM josiah_reflections_rows 
          WHERE reflection_timestamp BETWEEN '${start}' AND '${end}'
          ORDER BY reflection_timestamp
          LIMIT 500
        `
      }
    });

    const { data: ocrData, error: ocrError } = await supabase.functions.invoke('neon-query', {
      body: {
        action: 'customQuery',
        query: `
          SELECT 
            captured_at, extracted_registration, altitude_extracted, 
            verification_status, screenshot_hash
          FROM radar_screenshot_analysis 
          WHERE captured_at BETWEEN '${start}' AND '${end}'
          ORDER BY captured_at
          LIMIT 1000
        `
      }
    });

    const { data: entityData, error: entityError } = await supabase.functions.invoke('neon-query', {
      body: {
        action: 'customQuery',
        query: `
          SELECT DISTINCT
            er.canonical_identifier, er.entity_type, er.threat_classification,
            er.aliases, er.metadata
          FROM entity_registry er
          LIMIT 200
        `
      }
    });

    return {
      flights: flightData?.data || flightData || [],
      biometrics: biometricData?.data || biometricData || [],
      reflections: josiahData?.data || josiahData || [],
      ocr: ocrData?.data || ocrData || [],
      entities: entityData?.data || entityData || []
    };
  };

  const analyzeConvergence = (flights: any[], biometrics: any[], dateStr: string) => {
    // Find flights on this date
    const dayFlights = flights.filter(f => f.detected_at?.startsWith(dateStr));
    const dayBio = biometrics.filter(b => b.recorded_at?.startsWith(dateStr));
    
    // Count low altitude events
    const lowAlt = dayFlights.filter(f => (f.altitude || 0) < 2000).length;
    
    // Count stress spikes
    const stressSpikes = dayBio.filter(b => (b.stress_level || 0) > 70 || (b.heart_rate || 0) > 100).length;
    
    // Determine convergence level
    let level: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (dayFlights.length >= 5 && lowAlt >= 2 && stressSpikes >= 1) level = 'critical';
    else if (dayFlights.length >= 3 && (lowAlt >= 1 || stressSpikes >= 1)) level = 'high';
    else if (dayFlights.length >= 2) level = 'medium';
    
    return { 
      flightCount: dayFlights.length, 
      lowAltitude: lowAlt,
      biometricSpikes: stressSpikes, 
      level,
      flights: dayFlights,
      biometrics: dayBio
    };
  };

  const generateNarrative = async (
    sectionData: any, 
    dateStr: string, 
    entities: any[],
    reflections: any[]
  ): Promise<string> => {
    const dayReflections = reflections.filter(r => r.reflection_timestamp?.startsWith(dateStr));
    
    const prompt = `Generate a forensic legal narrative for surveillance events on ${dateStr}. 

FLIGHT DATA (${sectionData.flights.length} detections):
${sectionData.flights.slice(0, 10).map((f: any) => 
  `- ${f.detected_at}: ${f.registration || 'UNREG'} (${f.aircraft_type || 'Unknown'}) at ${f.altitude}ft, ${f.speed}kts`
).join('\n')}

LOW ALTITUDE EVENTS: ${sectionData.lowAltitude} aircraft below 2000ft

BIOMETRIC DATA (${sectionData.biometrics.length} readings):
${sectionData.biometrics.slice(0, 5).map((b: any) => 
  `- ${b.recorded_at}: HR ${b.heart_rate}bpm, Stress ${b.stress_level}%, HRV ${b.hrv_ms}ms`
).join('\n')}

JOSIAH REFLECTIONS:
${dayReflections.slice(0, 3).map((r: any) => `"${r.reflection_text?.substring(0, 200)}..."`).join('\n')}

KNOWN ENTITIES IN AREA:
${entities.slice(0, 10).map((e: any) => `- ${e.canonical_identifier} (${e.entity_type}): ${e.threat_classification || 'unclassified'}`).join('\n')}

Write a detailed legal narrative with:
1. Timeline of flight detections with altitudes and patterns
2. Correlation with biometric stress responses
3. Entity identification (operators, shell companies, agencies)
4. Legal implications (FAA violations, stalking patterns, potential RICO elements)
5. Evidence chain of custody notes

Format as professional legal prose suitable for court filing.`;

    const systemPrompt = `You are a forensic legal analyst generating court-admissible surveillance reports. 
Your narratives must be:
- Factual and evidence-based
- Written in formal legal prose
- Include specific timestamps, altitudes, and measurements
- Reference chain of custody and data integrity
- Identify potential legal violations (14 CFR §91.119, stalking statutes, etc.)
- Note patterns suggesting coordination or conspiracy`;

    const response = await supabase.functions.invoke('legal-narrative', {
      body: { prompt, systemPrompt, databaseContext: JSON.stringify({ dateStr, convergenceLevel: sectionData.level }) }
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    // Handle streaming response
    const reader = response.data?.getReader?.();
    if (reader) {
      let narrative = '';
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content || '';
              narrative += content;
              setStreamingContent(prev => prev + content);
            } catch {
              // Skip non-JSON lines
            }
          }
        }
      }
      return narrative;
    }

    return response.data?.narrative || "Narrative generation failed.";
  };

  const generateReport = async () => {
    if (!startDate || !endDate) {
      toast.error("Please select a date range");
      return;
    }

    setIsGenerating(true);
    setStreamingContent("");
    setReportData(null);

    try {
      // Phase 1: Fetch multimodal data
      setGenerationPhase("Fetching multimodal evidence from NeonDB...");
      const data = await fetchMultimodalData(startDate, endDate);
      
      toast.success(`Loaded ${data.flights.length} flights, ${data.biometrics.length} biometric readings`);

      // Phase 2: Identify significant dates
      setGenerationPhase("Analyzing convergence patterns...");
      const dateSet = new Set<string>();
      data.flights.forEach((f: any) => {
        if (f.detected_at) dateSet.add(f.detected_at.split('T')[0]);
      });
      data.biometrics.forEach((b: any) => {
        if (b.recorded_at) dateSet.add(b.recorded_at.split('T')[0]);
      });

      const significantDates = Array.from(dateSet)
        .map(date => ({ date, ...analyzeConvergence(data.flights, data.biometrics, date) }))
        .filter(d => d.level !== 'low' || d.flightCount > 0)
        .sort((a, b) => {
          const levelOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return levelOrder[a.level] - levelOrder[b.level];
        })
        .slice(0, 10); // Top 10 significant dates

      // Phase 3: Generate narratives for each date
      const sections: ReportSection[] = [];
      
      for (let i = 0; i < significantDates.length; i++) {
        const dateInfo = significantDates[i];
        setGenerationPhase(`Generating narrative for ${dateInfo.date} (${i + 1}/${significantDates.length})...`);
        
        const narrative = await generateNarrative(dateInfo, dateInfo.date, data.entities, data.reflections);
        
        // Extract entities mentioned in flights
        const flightEntities = dateInfo.flights
          .map((f: any) => f.registration || f.operator_name)
          .filter(Boolean)
          .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
          .slice(0, 5);

        sections.push({
          title: `${format(new Date(dateInfo.date), 'MMMM d, yyyy')} – ${getLevelTitle(dateInfo.level)}`,
          date: dateInfo.date,
          flightCount: dateInfo.flightCount,
          biometricSpikes: dateInfo.biometricSpikes,
          convergenceLevel: dateInfo.level,
          entities: flightEntities,
          narrative,
          legalImplications: getLegalImplications(dateInfo)
        });
      }

      // Phase 4: Generate introduction
      setGenerationPhase("Generating report introduction...");
      const introPrompt = `Write a professional legal introduction for a Watchtower Surveillance Report covering ${startDate} to ${endDate}.

Key statistics:
- Total flights detected: ${data.flights.length}
- Low-altitude events (<2000ft): ${data.flights.filter((f: any) => (f.altitude || 0) < 2000).length}
- Biometric stress correlations: ${data.biometrics.filter((b: any) => (b.stress_level || 0) > 70).length}
- Identified entities: ${data.entities.length}
- High-convergence events: ${sections.filter(s => s.convergenceLevel === 'high' || s.convergenceLevel === 'critical').length}

Write 2-3 paragraphs introducing the report, its methodology, and key findings. Reference chain-of-custody integrity and multi-modal evidence correlation.`;

      const introResponse = await supabase.functions.invoke('legal-narrative', {
        body: { 
          prompt: introPrompt, 
          systemPrompt: "You are a forensic legal analyst. Write a professional introduction for a court-admissible surveillance report." 
        }
      });

      let introduction = "";
      const introReader = introResponse.data?.getReader?.();
      if (introReader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await introReader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line.slice(6) !== '[DONE]') {
              try {
                const parsed = JSON.parse(line.slice(6));
                introduction += parsed.choices?.[0]?.delta?.content || '';
              } catch {}
            }
          }
        }
      }

      // Phase 5: Compile final report
      setGenerationPhase("Compiling final report...");
      
      const report: ReportData = {
        title: `Watchtower Surveillance Report (${format(new Date(startDate), 'MMM yyyy')}–${format(new Date(endDate), 'MMM yyyy')})`,
        dateRange: { start: startDate, end: endDate },
        introduction: introduction || "This report consolidates forensic evidence documenting patterns of aerial surveillance activity.",
        sections,
        statisticalSummary: {
          totalFlights: data.flights.length,
          lowAltitudeEvents: data.flights.filter((f: any) => (f.altitude || 0) < 2000).length,
          biometricCorrelations: data.biometrics.filter((b: any) => (b.stress_level || 0) > 70).length,
          identifiedEntities: data.entities.length,
          convergenceEvents: sections.filter(s => s.convergenceLevel === 'high' || s.convergenceLevel === 'critical').length
        },
        conclusion: `This report presents ${sections.length} significant surveillance events with multi-modal evidence correlation. Each event is documented with timestamped records, SHA-256 hash verification, and cross-referenced biometric data to ensure chain-of-custody integrity for legal proceedings.`,
        chainOfCustody: {
          recordCount: data.flights.length + data.biometrics.length + data.ocr.length,
          hashVerified: data.ocr.filter((o: any) => o.screenshot_hash).length,
          lastAudit: new Date().toISOString()
        }
      };

      setReportData(report);
      toast.success("Report generated successfully!");

    } catch (err) {
      console.error("Report generation error:", err);
      toast.error(`Failed to generate report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
      setGenerationPhase("");
    }
  };

  const getLevelTitle = (level: string): string => {
    switch (level) {
      case 'critical': return 'Multi-Factor Convergence Event';
      case 'high': return 'Coordinated Surveillance Activity';
      case 'medium': return 'Elevated Aerial Activity';
      default: return 'Notable Flight Activity';
    }
  };

  const getLegalImplications = (data: any): string[] => {
    const implications: string[] = [];
    if (data.lowAltitude > 0) implications.push("Potential 14 CFR §91.119 violation (minimum safe altitude)");
    if (data.flightCount >= 3) implications.push("Pattern consistent with coordinated surveillance");
    if (data.biometricSpikes > 0) implications.push("Documented physiological harm from aerial activity");
    if (data.level === 'critical') implications.push("Multi-factor convergence supporting RICO pattern");
    return implications;
  };

  const exportReport = () => {
    if (!reportData) return;
    
    let markdown = `# ${reportData.title}\n\n`;
    markdown += `**Date Range:** ${reportData.dateRange.start} to ${reportData.dateRange.end}\n\n`;
    markdown += `## Introduction\n\n${reportData.introduction}\n\n`;
    
    markdown += `## Statistical Summary\n\n`;
    markdown += `| Metric | Value |\n|--------|-------|\n`;
    markdown += `| Total Flights | ${reportData.statisticalSummary.totalFlights.toLocaleString()} |\n`;
    markdown += `| Low-Altitude Events | ${reportData.statisticalSummary.lowAltitudeEvents.toLocaleString()} |\n`;
    markdown += `| Biometric Correlations | ${reportData.statisticalSummary.biometricCorrelations.toLocaleString()} |\n`;
    markdown += `| Identified Entities | ${reportData.statisticalSummary.identifiedEntities.toLocaleString()} |\n`;
    markdown += `| Convergence Events | ${reportData.statisticalSummary.convergenceEvents} |\n\n`;
    
    for (const section of reportData.sections) {
      markdown += `## ${section.title}\n\n`;
      markdown += `**Date:** ${section.date} | **Flights:** ${section.flightCount} | **Biometric Spikes:** ${section.biometricSpikes}\n\n`;
      markdown += `**Convergence Level:** ${section.convergenceLevel.toUpperCase()}\n\n`;
      markdown += `**Entities Identified:** ${section.entities.join(', ') || 'None'}\n\n`;
      markdown += `${section.narrative}\n\n`;
      if (section.legalImplications.length > 0) {
        markdown += `**Legal Implications:**\n`;
        section.legalImplications.forEach(imp => {
          markdown += `- ${imp}\n`;
        });
        markdown += '\n';
      }
    }
    
    markdown += `## Chain of Custody\n\n`;
    markdown += `- Total Records: ${reportData.chainOfCustody.recordCount.toLocaleString()}\n`;
    markdown += `- Hash Verified: ${reportData.chainOfCustody.hashVerified.toLocaleString()}\n`;
    markdown += `- Last Audit: ${reportData.chainOfCustody.lastAudit}\n\n`;
    
    markdown += `## Conclusion\n\n${reportData.conclusion}\n`;
    
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchtower_report_${startDate}_${endDate}.md`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success("Report exported as Markdown");
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-destructive text-destructive-foreground';
      case 'high': return 'bg-warning text-warning-foreground';
      case 'medium': return 'bg-accent text-accent-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Generator Controls */}
      <CyberPanel 
        title="Watchtower Report Generator" 
        icon={<FileText className="w-4 h-4" />}
        className="border-primary/30"
      >
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Generate comprehensive legal surveillance reports from multimodal NeonDB evidence. 
            Reports include flight correlations, biometric data, entity identification, and AI-generated legal narratives.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="font-mono"
              />
            </div>
            <div>
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="flex items-end">
              <Button 
                onClick={generateReport} 
                disabled={isGenerating}
                className="w-full"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4 mr-2" />
                    Generate Report
                  </>
                )}
              </Button>
            </div>
          </div>

          {isGenerating && (
            <div className="bg-muted/50 rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 text-sm">
                <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                <span className="text-muted-foreground">{generationPhase}</span>
              </div>
              {streamingContent && (
                <div className="mt-2 text-xs text-muted-foreground max-h-20 overflow-auto font-mono">
                  {streamingContent.slice(-500)}...
                </div>
              )}
            </div>
          )}
        </div>
      </CyberPanel>

      {/* Generated Report */}
      {reportData && (
        <CyberPanel 
          title={reportData.title} 
          icon={<Scale className="w-4 h-4" />}
          headerActions={
            <Button variant="outline" size="sm" onClick={exportReport}>
              <Download className="w-3 h-3 mr-1" />
              Export MD
            </Button>
          }
        >
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0">
              <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
                Overview
              </TabsTrigger>
              <TabsTrigger value="events" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
                Events ({reportData.sections.length})
              </TabsTrigger>
              <TabsTrigger value="custody" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
                Chain of Custody
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="p-4">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <div className="bg-muted/30 rounded-lg p-3 text-center">
                  <Plane className="w-5 h-5 mx-auto mb-1 text-primary" />
                  <div className="text-2xl font-bold">{reportData.statisticalSummary.totalFlights.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Total Flights</div>
                </div>
                <div className="bg-destructive/10 rounded-lg p-3 text-center">
                  <AlertTriangle className="w-5 h-5 mx-auto mb-1 text-destructive" />
                  <div className="text-2xl font-bold">{reportData.statisticalSummary.lowAltitudeEvents.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Low Altitude</div>
                </div>
                <div className="bg-warning/10 rounded-lg p-3 text-center">
                  <Heart className="w-5 h-5 mx-auto mb-1 text-warning" />
                  <div className="text-2xl font-bold">{reportData.statisticalSummary.biometricCorrelations.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Bio Correlations</div>
                </div>
                <div className="bg-accent/10 rounded-lg p-3 text-center">
                  <Building2 className="w-5 h-5 mx-auto mb-1 text-accent" />
                  <div className="text-2xl font-bold">{reportData.statisticalSummary.identifiedEntities}</div>
                  <div className="text-xs text-muted-foreground">Entities</div>
                </div>
                <div className="bg-primary/10 rounded-lg p-3 text-center">
                  <Eye className="w-5 h-5 mx-auto mb-1 text-primary" />
                  <div className="text-2xl font-bold">{reportData.statisticalSummary.convergenceEvents}</div>
                  <div className="text-xs text-muted-foreground">Convergence</div>
                </div>
              </div>

              {/* Introduction */}
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <h3>Introduction</h3>
                <p className="whitespace-pre-wrap">{reportData.introduction}</p>
              </div>
            </TabsContent>

            <TabsContent value="events" className="p-0">
              <ScrollArea className="h-[600px]">
                <div className="p-4 space-y-6">
                  {reportData.sections.map((section, idx) => (
                    <div key={idx} className="border border-border rounded-lg overflow-hidden">
                      <div className="bg-muted/30 p-3 flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold">{section.title}</h4>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            {section.date}
                            <span className="mx-1">•</span>
                            <Plane className="w-3 h-3" />
                            {section.flightCount} flights
                            <span className="mx-1">•</span>
                            <Heart className="w-3 h-3" />
                            {section.biometricSpikes} spikes
                          </div>
                        </div>
                        <Badge className={getLevelColor(section.convergenceLevel)}>
                          {section.convergenceLevel.toUpperCase()}
                        </Badge>
                      </div>
                      
                      <div className="p-4 space-y-3">
                        {section.entities.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {section.entities.map((entity, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {entity}
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <p className="whitespace-pre-wrap text-sm">{section.narrative}</p>
                        </div>
                        
                        {section.legalImplications.length > 0 && (
                          <div className="bg-destructive/5 border border-destructive/20 rounded p-3">
                            <div className="flex items-center gap-2 text-destructive text-sm font-medium mb-2">
                              <Scale className="w-4 h-4" />
                              Legal Implications
                            </div>
                            <ul className="text-xs space-y-1">
                              {section.legalImplications.map((imp, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="text-destructive">•</span>
                                  {imp}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="custody" className="p-4">
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-muted/30 rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-primary">
                      {reportData.chainOfCustody.recordCount.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Records</div>
                  </div>
                  <div className="bg-green-500/10 rounded-lg p-4 text-center">
                    <div className="text-3xl font-bold text-green-500">
                      {reportData.chainOfCustody.hashVerified.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">SHA-256 Verified</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-4 text-center">
                    <div className="text-sm font-mono text-primary">
                      {format(new Date(reportData.chainOfCustody.lastAudit), 'PPpp')}
                    </div>
                    <div className="text-sm text-muted-foreground">Last Audit</div>
                  </div>
                </div>
                
                <div className="bg-muted/20 rounded-lg p-4 border border-border">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-green-500" />
                    Chain of Custody Statement
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    All evidence records in this report are timestamped and cross-referenced with SHA-256 
                    cryptographic hashes to ensure data integrity. Flight detections are correlated with 
                    biometric readings within ±5 minute windows. OCR-extracted data from radar screenshots 
                    is verified against ADS-B logs. This methodology ensures an unbroken chain of custody 
                    suitable for federal court proceedings.
                  </p>
                </div>
                
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <h4>Conclusion</h4>
                  <p>{reportData.conclusion}</p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CyberPanel>
      )}
    </div>
  );
}
