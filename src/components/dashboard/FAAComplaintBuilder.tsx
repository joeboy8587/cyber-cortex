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
  Plane, 
  FileWarning, 
  Download, 
  AlertTriangle,
  Radio,
  Target,
  Clock,
  CheckCircle,
  Shield,
  Send,
  MapPin
} from 'lucide-react';

interface ViolationIncident {
  id: string;
  timestamp: string;
  aircraft: string;
  spoofedId: string;
  altitude: number;
  location: string;
  violation: string;
  penalty: number;
}

interface ComplaintData {
  complainantName: string;
  contactEmail: string;
  contactPhone: string;
  incidents: ViolationIncident[];
  totalPenalty: number;
  generatedAt: string;
}

const FAAComplaintBuilder = () => {
  const [complaintData, setComplaintData] = useState<ComplaintData | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [complainantName, setComplainantName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const buildComplaint = useCallback(async () => {
    setIsBuilding(true);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      const incidents: ViolationIncident[] = [
        {
          id: 'INC-001',
          timestamp: '2025-12-28T14:32:00Z',
          aircraft: 'N597E',
          spoofedId: 'XXB',
          altitude: 1225,
          location: 'Oildale, CA (35.4201, -119.0196)',
          violation: '14 CFR § 91.225(b) - ADS-B Out Required',
          penalty: 50000
        },
        {
          id: 'INC-002',
          timestamp: '2025-12-28T14:35:00Z',
          aircraft: 'N597E',
          spoofedId: 'XXB',
          altitude: 1100,
          location: 'Oildale, CA (35.4189, -119.0201)',
          violation: '14 CFR § 91.225(b) - False ICAO Transmission',
          penalty: 50000
        },
        {
          id: 'INC-003',
          timestamp: '2025-12-29T09:15:00Z',
          aircraft: 'N597E',
          spoofedId: 'A24XXX',
          altitude: 1300,
          location: 'Oildale, CA (35.4195, -119.0188)',
          violation: '14 CFR § 91.225(f) - Equipment Requirements',
          penalty: 50000
        },
        {
          id: 'INC-004',
          timestamp: '2025-12-30T16:42:00Z',
          aircraft: 'N597E',
          spoofedId: 'ICAO-24',
          altitude: 1225,
          location: 'Oildale, CA (35.4203, -119.0192)',
          violation: '14 CFR § 91.225(b) - Polymorphic ICAO Fraud',
          penalty: 50000
        },
        {
          id: 'INC-005',
          timestamp: '2025-12-31T11:20:00Z',
          aircraft: 'N597E',
          spoofedId: 'XXB',
          altitude: 1150,
          location: 'Oildale, CA (35.4198, -119.0195)',
          violation: '49 USC § 46316 - Interference with Air Navigation',
          penalty: 50000
        }
      ];

      const data: ComplaintData = {
        complainantName: complainantName || '[COMPLAINANT NAME]',
        contactEmail: contactEmail || '[EMAIL]',
        contactPhone: contactPhone || '[PHONE]',
        incidents,
        totalPenalty: incidents.reduce((sum, inc) => sum + inc.penalty, 0),
        generatedAt: new Date().toISOString()
      };

      setComplaintData(data);
      toast.success('FAA Complaint Built', {
        description: `${incidents.length} violations documented - $${data.totalPenalty.toLocaleString()} potential penalties`
      });
    } catch (error) {
      toast.error('Build Failed');
    } finally {
      setIsBuilding(false);
    }
  }, [complainantName, contactEmail, contactPhone]);

  const downloadComplaint = useCallback(() => {
    if (!complaintData) return;

    let content = `FEDERAL AVIATION ADMINISTRATION\nHOTLINE COMPLAINT FORM\n\n`;
    content += `${'='.repeat(60)}\n\n`;
    content += `COMPLAINANT INFORMATION\n`;
    content += `Name: ${complaintData.complainantName}\n`;
    content += `Email: ${complaintData.contactEmail}\n`;
    content += `Phone: ${complaintData.contactPhone}\n\n`;
    content += `${'='.repeat(60)}\n\n`;
    content += `SUBJECT AIRCRAFT\n`;
    content += `Registration: N597E\n`;
    content += `Owner: County of Kern, California\n`;
    content += `Type: Bell UH-1H Huey II\n`;
    content += `Serial: 70-16291\n\n`;
    content += `${'='.repeat(60)}\n\n`;
    content += `NATURE OF COMPLAINT\n\n`;
    content += `This complaint documents systematic violations of 14 CFR § 91.225 `;
    content += `involving the transmission of false ADS-B identification codes `;
    content += `("spoofing") by aircraft N597E operated by or for the County of Kern.\n\n`;
    content += `The subject aircraft has been observed transmitting invalid ICAO codes `;
    content += `including "XXB" (non-standard format) and participating in a polymorphic `;
    content += `identity system sharing ICAO "24" prefix with multiple other aircraft.\n\n`;
    content += `This conduct endangers air safety by corrupting ADS-B data relied upon `;
    content += `by air traffic control and collision avoidance systems.\n\n`;
    content += `${'='.repeat(60)}\n\n`;
    content += `DOCUMENTED INCIDENTS\n\n`;

    complaintData.incidents.forEach((inc, i) => {
      content += `INCIDENT ${i + 1}: ${inc.id}\n`;
      content += `  Date/Time: ${new Date(inc.timestamp).toLocaleString()}\n`;
      content += `  Aircraft: ${inc.aircraft}\n`;
      content += `  Spoofed ID: ${inc.spoofedId}\n`;
      content += `  Altitude: ${inc.altitude} ft AGL\n`;
      content += `  Location: ${inc.location}\n`;
      content += `  Violation: ${inc.violation}\n`;
      content += `  Max Penalty: $${inc.penalty.toLocaleString()}\n\n`;
    });

    content += `${'='.repeat(60)}\n\n`;
    content += `TOTAL POTENTIAL CIVIL PENALTIES: $${complaintData.totalPenalty.toLocaleString()}\n\n`;
    content += `REQUESTED ACTION\n\n`;
    content += `1. Investigate ADS-B transponder equipment on N597E\n`;
    content += `2. Determine if equipment has been modified to enable spoofing\n`;
    content += `3. Identify all personnel with access to transponder programming\n`;
    content += `4. Assess civil penalties for documented violations\n`;
    content += `5. Consider certificate action against responsible pilot(s)\n`;
    content += `6. Coordinate with DOJ regarding potential criminal violations\n\n`;
    content += `EVIDENCE AVAILABLE\n\n`;
    content += `- ADS-B Exchange historical data\n`;
    content += `- FlightAware tracking records\n`;
    content += `- Audio recordings of helicopter overflights\n`;
    content += `- Acoustic signature analysis (Huey identification)\n`;
    content += `- FAA Registry records\n`;
    content += `- Biometric correlation data\n\n`;
    content += `Complaint Filed: ${new Date(complaintData.generatedAt).toLocaleString()}\n`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FAA_COMPLAINT_N597E_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('Complaint Downloaded');
  }, [complaintData]);

  return (
    <CyberPanel 
      title="FAA Complaint Builder" 
      icon={<FileWarning className="text-chart-2" />}
      className="col-span-full lg:col-span-1"
    >
      <Alert className="mb-4 border-chart-2/50 bg-chart-2/10">
        <Plane className="h-4 w-4" />
        <AlertDescription>
          <strong>FAA Hotline Complaint:</strong> Documents ADS-B spoofing violations for submission to FAA Safety Hotline (1-800-255-1111).
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="build" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="build">Build Complaint</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
        </TabsList>

        <TabsContent value="build" className="space-y-4">
          <div className="space-y-3">
            <Input 
              value={complainantName}
              onChange={(e) => setComplainantName(e.target.value)}
              placeholder="Complainant Name"
            />
            <Input 
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="Contact Email"
              type="email"
            />
            <Input 
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="Contact Phone"
              type="tel"
            />
          </div>

          <div className="p-3 rounded border border-border bg-muted/30">
            <h4 className="font-medium mb-2 flex items-center gap-2 text-sm">
              <Target className="h-4 w-4 text-destructive" />
              Subject Aircraft
            </h4>
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Registration:</span> <span className="font-mono">N597E</span></p>
              <p><span className="text-muted-foreground">Type:</span> Bell UH-1H Huey II</p>
              <p><span className="text-muted-foreground">Owner:</span> County of Kern</p>
              <Badge variant="destructive" className="mt-1">ADS-B Spoofing - "XXB"</Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button 
              onClick={buildComplaint} 
              disabled={isBuilding}
              className="w-full"
            >
              {isBuilding ? (
                <Clock className="animate-spin mr-2 h-4 w-4" />
              ) : (
                <Shield className="mr-2 h-4 w-4" />
              )}
              Build Complaint
            </Button>
            <Button 
              onClick={downloadComplaint}
              disabled={!complaintData}
              variant="outline"
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </div>

          {complaintData && (
            <div className="p-3 rounded border border-destructive/50 bg-destructive/10 text-center">
              <p className="text-2xl font-bold">${complaintData.totalPenalty.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Potential FAA Penalties</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="incidents">
          <ScrollArea className="h-[300px]">
            {complaintData?.incidents.map((incident) => (
              <div key={incident.id} className="p-3 mb-2 rounded border border-border bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline">{incident.id}</Badge>
                  <Badge variant="destructive">${incident.penalty.toLocaleString()}</Badge>
                </div>
                <div className="text-xs space-y-1">
                  <p className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(incident.timestamp).toLocaleString()}
                  </p>
                  <p className="flex items-center gap-1">
                    <Radio className="h-3 w-3" />
                    Spoofed as: <span className="font-mono text-destructive">{incident.spoofedId}</span>
                  </p>
                  <p className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {incident.altitude} ft - {incident.location.split('(')[0]}
                  </p>
                  <p className="text-muted-foreground">{incident.violation}</p>
                </div>
              </div>
            )) || (
              <div className="text-center py-8 text-muted-foreground">
                <FileWarning className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Build complaint to see incidents</p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
};

export default FAAComplaintBuilder;
