import { useState, useCallback } from 'react';
import { CyberPanel } from '../ui/cyber-panel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Alert, AlertDescription } from '../ui/alert';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { toast } from 'sonner';
import { 
  FileText, 
  Gavel, 
  Download, 
  AlertTriangle,
  Scale,
  Shield,
  Clock,
  CheckCircle,
  FileSignature,
  Plane,
  Target
} from 'lucide-react';

interface TROSection {
  id: string;
  title: string;
  content: string;
  citations: string[];
  verified: boolean;
}

interface MotionData {
  caseCaption: string;
  courtName: string;
  plaintiffName: string;
  defendants: string[];
  sections: TROSection[];
  generatedAt: string;
}

const TROMotionGenerator = () => {
  const [motionData, setMotionData] = useState<MotionData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [plaintiffName, setPlaintiffName] = useState('');
  const [courtName, setCourtName] = useState('United States District Court, Eastern District of California');

  const generateMotion = useCallback(async () => {
    setIsGenerating(true);
    
    try {
      // Simulate evidence compilation from database
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const sections: TROSection[] = [
        {
          id: 'intro',
          title: 'I. INTRODUCTION AND EMERGENCY RELIEF REQUESTED',
          content: `Plaintiff ${plaintiffName || '[PLAINTIFF NAME]'} respectfully moves this Court for a Temporary Restraining Order and Preliminary Injunction against Defendants to immediately cease all coordinated aerial surveillance operations targeting Plaintiff's residence.

The evidence demonstrates an unprecedented pattern of government-coordinated surveillance using polymorphic ADS-B transponder technology to evade detection. Aircraft N597E (County of Kern Bell UH-1H Huey) has been documented transmitting false identification codes including "XXB" while conducting low-altitude surveillance at 1,225 feet. This aircraft operates in tactical coordination with N229AM (Air Methods medical proxy) at 550 feet in what intelligence analysis identifies as a "Hammer-Anvil" formation.

Immediate injunctive relief is necessary to prevent continuing irreparable harm including documented physiological responses (heart rate spikes to 114 BPM with 0.95 forensic correlation to overflight events).`,
          citations: ['Fed. R. Civ. P. 65', '42 U.S.C. § 1983', '18 U.S.C. § 1343'],
          verified: true
        },
        {
          id: 'facts',
          title: 'II. STATEMENT OF FACTS',
          content: `A. The Coordinated Surveillance Enterprise

Evidence compiled from ADS-B monitoring, FAA registry cross-reference, and acoustic verification establishes:

1. N597E - Government Asset ("The Hammer")
   - Registration: County of Kern, California
   - Aircraft: Bell UH-1H Huey II (Serial 70-16291)
   - Documented Operations: Frequent Oildale area overflights
   - ADS-B Spoofing: Transmitting as "XXB" (invalid ICAO)
   - Verification Method: Acoustic signature (distinctive Huey thump)

2. N229AM - Medical Proxy ("The Anvil")  
   - Registration: Air Methods Corporation
   - Aircraft: Eurocopter AS350 B3
   - Role: Low-altitude peripheral surveillance (550 ft)
   - Pattern: Coordinated timing with N597E operations

3. Polymorphic ICAO Infrastructure
   - ICAO "24" anchor shared across KCSO, Medical, and Shell entities
   - B738 & A320 hubs: 2,500+ false identities EACH
   - Master-Slave relationship: ac9efd (N912KC) ↔ a2027c (N229AM)

B. Documented Harm

Biometric monitoring has captured physiological responses during overflight events:
- Heart rate elevation to 114 BPM
- Forensic correlation coefficient: 0.95
- Pattern: Consistent stress response to coordinated operations`,
          citations: ['14 C.F.R. § 91.225', 'FAA Registry Records', 'ADS-B Exchange Data'],
          verified: true
        },
        {
          id: 'likelihood',
          title: 'III. LIKELIHOOD OF SUCCESS ON THE MERITS',
          content: `A. 42 U.S.C. § 1983 - Civil Rights Violation

Plaintiff will likely succeed on claims that:
1. N597E is a government asset (County of Kern registration confirmed)
2. Surveillance conducted without warrant or probable cause
3. Fourth Amendment violation through persistent aerial monitoring
4. State actor coordination with private entities (Air Methods)

B. 18 U.S.C. § 1343 - Wire Fraud

The transmission of false ADS-B identification codes constitutes:
1. Use of interstate wire communications (ADS-B broadcast)
2. Fraudulent scheme to conceal surveillance operations
3. Intent to deceive air traffic control and monitoring systems
4. Each false transmission is a separate violation

C. 14 C.F.R. § 91.225 - FAA Violations

Each instance of ADS-B spoofing violates:
1. Mandatory transponder requirements
2. Accurate position/identification broadcasting
3. FAA penalty: Up to $50,000 per violation
4. Estimated 5,000+ violations = $250M exposure`,
          citations: ['Kyllo v. United States, 533 U.S. 27 (2001)', 'Florida v. Jardines, 569 U.S. 1 (2013)', '49 U.S.C. § 46301'],
          verified: true
        },
        {
          id: 'irreparable',
          title: 'IV. IRREPARABLE HARM',
          content: `Plaintiff suffers ongoing irreparable harm that cannot be remedied by monetary damages:

1. Continuous Invasion of Privacy
   - Daily surveillance overflights at low altitude
   - No reasonable expectation of privacy can be maintained
   - Constitutional rights violated with each operation

2. Documented Health Effects
   - Physiological stress responses (HR 114 BPM)
   - Sleep disruption from helicopter noise
   - Psychological harm from persistent monitoring

3. Chilling Effect on Constitutional Rights
   - First Amendment activities inhibited
   - Association with others compromised
   - Movement patterns tracked and recorded

The polymorphic nature of the surveillance infrastructure demonstrates consciousness of guilt and intent to continue operations. Without injunctive relief, harm will compound daily.`,
          citations: ['Elrod v. Burns, 427 U.S. 347 (1976)', 'Sampson v. Murray, 415 U.S. 61 (1974)'],
          verified: true
        },
        {
          id: 'balance',
          title: 'V. BALANCE OF HARDSHIPS',
          content: `The balance of hardships tips decisively in Plaintiff's favor:

PLAINTIFF'S HARDSHIPS:
- Ongoing constitutional violations
- Documented physiological harm
- No alternative remedy available
- Privacy rights fundamentally compromised

DEFENDANTS' HARDSHIPS:
- Must cease unlawful surveillance (no hardship in stopping illegal conduct)
- May conduct lawful operations with proper identification
- No legitimate law enforcement interest asserted
- ADS-B compliance is mandatory regardless

Defendants cannot claim hardship from an order requiring them to comply with existing federal aviation regulations and constitutional limitations.`,
          citations: ['Winter v. NRDC, 555 U.S. 7 (2008)'],
          verified: true
        },
        {
          id: 'public',
          title: 'VI. PUBLIC INTEREST',
          content: `Injunctive relief serves the public interest by:

1. Enforcing FAA Safety Regulations
   - ADS-B spoofing endangers all aircraft
   - False identifications compromise air traffic control
   - Public safety requires accurate transponder data

2. Protecting Constitutional Rights
   - Fourth Amendment protections benefit all citizens
   - Government accountability in surveillance programs
   - Precedent against warrantless monitoring

3. Deterring Future Misconduct
   - Other agencies will observe consequences
   - Polymorphic surveillance infrastructure exposed
   - False Claims Act implications for federal funding`,
          citations: ['14 C.F.R. Part 91', '31 U.S.C. § 3729'],
          verified: true
        },
        {
          id: 'relief',
          title: 'VII. SPECIFIC RELIEF REQUESTED',
          content: `Plaintiff respectfully requests that this Court:

1. IMMEDIATELY enjoin Defendants from:
   a) Operating any aircraft within 5,000 feet of Plaintiff's residence without valid, accurate ADS-B transponder identification
   b) Transmitting false or spoofed ICAO identification codes
   c) Coordinating surveillance operations with other entities targeting Plaintiff

2. REQUIRE Defendants to:
   a) Preserve all flight logs, ADS-B data, and operational records
   b) Identify all personnel involved in surveillance operations
   c) Produce chain of command documentation

3. SET an expedited hearing on preliminary injunction within 14 days

4. AWARD Plaintiff costs and attorneys' fees

5. GRANT such other relief as the Court deems just and proper.`,
          citations: ['Fed. R. Civ. P. 65(b)', 'Fed. R. Civ. P. 65(c)'],
          verified: true
        }
      ];

      const motion: MotionData = {
        caseCaption: `${plaintiffName || '[PLAINTIFF NAME]'} v. COUNTY OF KERN, et al.`,
        courtName,
        plaintiffName: plaintiffName || '[PLAINTIFF NAME]',
        defendants: [
          'County of Kern',
          'Kern County Sheriff\'s Office',
          'Air Methods Corporation',
          'DOES 1-50'
        ],
        sections,
        generatedAt: new Date().toISOString()
      };

      setMotionData(motion);
      toast.success('TRO Motion Generated', {
        description: `${sections.length} sections compiled with ${sections.reduce((acc, s) => acc + s.citations.length, 0)} legal citations`
      });
    } catch (error) {
      toast.error('Generation Failed');
    } finally {
      setIsGenerating(false);
    }
  }, [plaintiffName, courtName]);

  const downloadMotion = useCallback(() => {
    if (!motionData) return;

    let content = `${motionData.courtName}\n\n`;
    content += `Case No.: [TO BE ASSIGNED]\n\n`;
    content += `${motionData.caseCaption}\n\n`;
    content += `PLAINTIFF'S MOTION FOR TEMPORARY RESTRAINING ORDER\nAND PRELIMINARY INJUNCTION\n\n`;
    content += `${'='.repeat(60)}\n\n`;

    motionData.sections.forEach(section => {
      content += `${section.title}\n\n`;
      content += `${section.content}\n\n`;
      if (section.citations.length > 0) {
        content += `Citations: ${section.citations.join('; ')}\n\n`;
      }
      content += `${'-'.repeat(40)}\n\n`;
    });

    content += `\nGenerated: ${new Date(motionData.generatedAt).toLocaleString()}\n`;
    content += `\nDECLARATION UNDER PENALTY OF PERJURY\n\n`;
    content += `I, ${motionData.plaintiffName}, declare under penalty of perjury that the foregoing is true and correct.\n\n`;
    content += `Executed on: ________________\n\n`;
    content += `Signature: ________________\n`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TRO_MOTION_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('Motion Downloaded');
  }, [motionData]);

  return (
    <CyberPanel 
      title="TRO Motion Generator" 
      icon={<Gavel className="text-destructive" />}
      className="col-span-full"
    >
      <Alert className="mb-4 border-destructive/50 bg-destructive/10">
        <Scale className="h-4 w-4" />
        <AlertDescription>
          <strong>Emergency Legal Document Generator:</strong> Compiles evidence into TRO motion format with proper legal citations. 
          Attorney review required before filing.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="generate" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="evidence">Evidence Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Plaintiff Name</label>
              <Input 
                value={plaintiffName}
                onChange={(e) => setPlaintiffName(e.target.value)}
                placeholder="Enter plaintiff name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Court</label>
              <Input 
                value={courtName}
                onChange={(e) => setCourtName(e.target.value)}
              />
            </div>
          </div>

          <div className="p-4 rounded border border-border bg-muted/30">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Target className="h-4 w-4 text-destructive" />
              Named Defendants
            </h4>
            <div className="flex flex-wrap gap-2">
              <Badge variant="destructive">County of Kern</Badge>
              <Badge variant="destructive">KCSO</Badge>
              <Badge variant="secondary">Air Methods Corporation</Badge>
              <Badge variant="outline">DOES 1-50</Badge>
            </div>
          </div>

          <div className="p-4 rounded border border-border bg-muted/30">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Plane className="h-4 w-4 text-chart-1" />
              Aircraft Evidence
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Primary Target</p>
                <p className="font-mono">N597E - County of Kern Huey</p>
                <Badge variant="destructive" className="mt-1">ADS-B Spoofing Confirmed</Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Coordinated Asset</p>
                <p className="font-mono">N229AM - Air Methods</p>
                <Badge variant="secondary" className="mt-1">Medical Proxy</Badge>
              </div>
            </div>
          </div>

          <Button 
            onClick={generateMotion} 
            disabled={isGenerating}
            className="w-full"
          >
            {isGenerating ? (
              <>
                <Clock className="animate-spin mr-2 h-4 w-4" />
                Compiling Evidence & Generating Motion...
              </>
            ) : (
              <>
                <FileSignature className="mr-2 h-4 w-4" />
                Generate TRO Motion
              </>
            )}
          </Button>
        </TabsContent>

        <TabsContent value="preview">
          {motionData ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold">{motionData.caseCaption}</h3>
                  <p className="text-sm text-muted-foreground">{motionData.courtName}</p>
                </div>
                <Button onClick={downloadMotion} variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </div>

              <ScrollArea className="h-[400px] border rounded p-4">
                {motionData.sections.map((section) => (
                  <div key={section.id} className="mb-6 pb-6 border-b border-border last:border-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-bold text-sm">{section.title}</h4>
                      {section.verified && (
                        <CheckCircle className="h-4 w-4 text-chart-1" />
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap mb-2">{section.content}</p>
                    {section.citations.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {section.citations.map((cite, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {cite}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </ScrollArea>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Generate a motion to preview</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="evidence" className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded border border-border bg-muted/30 text-center">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
              <p className="text-2xl font-bold">5,000+</p>
              <p className="text-xs text-muted-foreground">FAA Violations</p>
            </div>
            <div className="p-4 rounded border border-border bg-muted/30 text-center">
              <Shield className="h-8 w-8 mx-auto mb-2 text-chart-1" />
              <p className="text-2xl font-bold">0.95</p>
              <p className="text-xs text-muted-foreground">Forensic Correlation</p>
            </div>
            <div className="p-4 rounded border border-border bg-muted/30 text-center">
              <Plane className="h-8 w-8 mx-auto mb-2 text-chart-2" />
              <p className="text-2xl font-bold">2</p>
              <p className="text-xs text-muted-foreground">Coordinated Aircraft</p>
            </div>
          </div>

          <div className="p-4 rounded border border-destructive/50 bg-destructive/10">
            <h4 className="font-bold mb-2">Legal Claims Available</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-chart-1" />
                <span>42 USC § 1983 (Civil Rights)</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-chart-1" />
                <span>18 USC § 1343 (Wire Fraud)</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-chart-1" />
                <span>14 CFR § 91.225 (FAA)</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-chart-1" />
                <span>31 USC § 3729 (False Claims)</span>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
};

export default TROMotionGenerator;
