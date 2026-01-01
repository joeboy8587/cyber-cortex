import { useState, useCallback } from 'react';
import { CyberPanel } from '../ui/cyber-panel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Alert, AlertDescription } from '../ui/alert';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import { 
  FileArchive, 
  Send, 
  Download, 
  AlertTriangle,
  Building,
  Clock,
  CheckCircle,
  XCircle,
  Calendar,
  Mail,
  Printer
} from 'lucide-react';

interface PreservationTarget {
  id: string;
  name: string;
  type: 'government' | 'corporation' | 'medical';
  address: string;
  contactEmail: string;
  status: 'draft' | 'sent' | 'acknowledged' | 'expired';
  sentDate?: string;
  acknowledgedDate?: string;
  documents: string[];
}

const PreservationDemandSystem = () => {
  const [senderName, setSenderName] = useState('');
  const [senderAddress, setSenderAddress] = useState('');
  const [targets, setTargets] = useState<PreservationTarget[]>([
    {
      id: 'KCSO',
      name: 'Kern County Sheriff\'s Office',
      type: 'government',
      address: '1350 Norris Road, Bakersfield, CA 93308',
      contactEmail: 'records@kernsheriff.org',
      status: 'draft',
      documents: [
        'All flight logs for N597E',
        'ADS-B transponder maintenance records',
        'Pilot assignment records for helicopter operations',
        'Communications regarding Oildale area surveillance',
        'Chain of command for aerial operations',
        'Policies regarding transponder identification'
      ]
    },
    {
      id: 'COUNTY',
      name: 'County of Kern',
      type: 'government',
      address: '1115 Truxtun Ave, Bakersfield, CA 93301',
      contactEmail: 'countycounsel@co.kern.ca.us',
      status: 'draft',
      documents: [
        'Aircraft registration documents for N597E',
        'Maintenance contracts for Bell UH-1H Huey',
        'Interagency agreements involving aerial assets',
        'Budget records for helicopter operations',
        'Insurance policies for aircraft operations',
        'Personnel records for aircraft operators'
      ]
    },
    {
      id: 'AIRMETHODS',
      name: 'Air Methods Corporation',
      type: 'medical',
      address: '5500 S Quebec St, Greenwood Village, CO 80111',
      contactEmail: 'legal@airmethods.com',
      status: 'draft',
      documents: [
        'All flight logs for N229AM',
        'ADS-B transponder data and maintenance',
        'Communications with Kern County entities',
        'Contracts with law enforcement agencies',
        'Pilot assignment and scheduling records',
        'ICAO identifier assignment procedures'
      ]
    }
  ]);

  const generateDemandLetter = useCallback((target: PreservationTarget): string => {
    const date = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    let letter = `${date}\n\n`;
    letter += `VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED\n`;
    letter += `AND EMAIL: ${target.contactEmail}\n\n`;
    letter += `${target.name}\n`;
    letter += `${target.address}\n\n`;
    letter += `Re: LITIGATION HOLD AND PRESERVATION DEMAND\n`;
    letter += `    Anticipated Litigation Regarding Aerial Surveillance Operations\n\n`;
    letter += `Dear Records Custodian:\n\n`;
    letter += `This letter constitutes a formal litigation hold and preservation demand `;
    letter += `in anticipation of litigation regarding coordinated aerial surveillance `;
    letter += `operations. You are hereby placed on notice to preserve all documents, `;
    letter += `data, and electronically stored information ("ESI") related to the `;
    letter += `matters described below.\n\n`;
    letter += `LEGAL OBLIGATION TO PRESERVE\n\n`;
    letter += `Upon receipt of this letter, you have a legal duty to preserve all `;
    letter += `potentially relevant evidence. Failure to preserve evidence may result `;
    letter += `in spoliation sanctions, adverse inference instructions, and/or `;
    letter += `independent tort liability. See Zubulake v. UBS Warburg LLC, 220 F.R.D. `;
    letter += `212 (S.D.N.Y. 2003).\n\n`;
    letter += `DOCUMENTS TO BE PRESERVED\n\n`;
    letter += `You must immediately preserve the following:\n\n`;
    
    target.documents.forEach((doc, i) => {
      letter += `${i + 1}. ${doc}\n`;
    });
    
    letter += `\nTIME PERIOD\n\n`;
    letter += `All documents and ESI from January 1, 2023 to the present.\n\n`;
    letter += `SPECIFIC AIRCRAFT OF INTEREST\n\n`;
    letter += `- N597E (Bell UH-1H Huey II, Serial 70-16291)\n`;
    letter += `- N229AM (Eurocopter AS350 B3)\n`;
    letter += `- Any aircraft using ICAO prefix "24" or identifier "XXB"\n\n`;
    letter += `COMPLIANCE REQUIRED\n\n`;
    letter += `Please confirm receipt of this preservation demand and your compliance `;
    letter += `within TEN (10) business days. Failure to respond will be documented `;
    letter += `and presented to the Court as evidence of non-compliance.\n\n`;
    letter += `This demand is made without prejudice to any rights or remedies `;
    letter += `available at law or in equity.\n\n`;
    letter += `Sincerely,\n\n`;
    letter += `${senderName || '[SENDER NAME]'}\n`;
    letter += `${senderAddress || '[SENDER ADDRESS]'}\n`;
    
    return letter;
  }, [senderName, senderAddress]);

  const downloadDemand = useCallback((target: PreservationTarget) => {
    const letter = generateDemandLetter(target);
    const blob = new Blob([letter], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PRESERVATION_DEMAND_${target.id}_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Demand for ${target.name} downloaded`);
  }, [generateDemandLetter]);

  const markAsSent = useCallback((targetId: string) => {
    setTargets(prev => prev.map(t => 
      t.id === targetId 
        ? { ...t, status: 'sent' as const, sentDate: new Date().toISOString() }
        : t
    ));
    toast.success('Marked as sent');
  }, []);

  const markAsAcknowledged = useCallback((targetId: string) => {
    setTargets(prev => prev.map(t => 
      t.id === targetId 
        ? { ...t, status: 'acknowledged' as const, acknowledgedDate: new Date().toISOString() }
        : t
    ));
    toast.success('Marked as acknowledged');
  }, []);

  const downloadAll = useCallback(() => {
    targets.forEach(target => {
      downloadDemand(target);
    });
    toast.success('All demands downloaded');
  }, [targets, downloadDemand]);

  const getStatusBadge = (status: PreservationTarget['status']) => {
    switch (status) {
      case 'draft':
        return <Badge variant="outline">Draft</Badge>;
      case 'sent':
        return <Badge variant="secondary">Sent</Badge>;
      case 'acknowledged':
        return <Badge className="bg-chart-1 text-chart-1-foreground">Acknowledged</Badge>;
      case 'expired':
        return <Badge variant="destructive">Expired</Badge>;
    }
  };

  const getTypeIcon = (type: PreservationTarget['type']) => {
    switch (type) {
      case 'government':
        return <Building className="h-4 w-4 text-chart-2" />;
      case 'corporation':
        return <Building className="h-4 w-4 text-chart-3" />;
      case 'medical':
        return <Building className="h-4 w-4 text-chart-4" />;
    }
  };

  return (
    <CyberPanel 
      title="Preservation Demand System" 
      icon={<FileArchive className="text-chart-3" />}
      className="col-span-full lg:col-span-1"
    >
      <Alert className="mb-4 border-chart-3/50 bg-chart-3/10">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Litigation Hold Generator:</strong> Creates formal preservation demands to prevent spoliation of evidence.
        </AlertDescription>
      </Alert>

      <div className="space-y-3 mb-4">
        <Input 
          value={senderName}
          onChange={(e) => setSenderName(e.target.value)}
          placeholder="Your Name"
        />
        <Input 
          value={senderAddress}
          onChange={(e) => setSenderAddress(e.target.value)}
          placeholder="Your Address"
        />
        <Button onClick={downloadAll} className="w-full" variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Download All Demands
        </Button>
      </div>

      <ScrollArea className="h-[350px]">
        {targets.map((target) => (
          <div key={target.id} className="p-3 mb-3 rounded border border-border bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {getTypeIcon(target.type)}
                <span className="font-medium text-sm">{target.name}</span>
              </div>
              {getStatusBadge(target.status)}
            </div>
            
            <div className="text-xs text-muted-foreground mb-2">
              <p className="flex items-center gap-1">
                <Mail className="h-3 w-3" />
                {target.contactEmail}
              </p>
              <p className="mt-1">{target.documents.length} document categories</p>
            </div>

            {target.sentDate && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                <Calendar className="h-3 w-3" />
                Sent: {new Date(target.sentDate).toLocaleDateString()}
              </p>
            )}

            {target.acknowledgedDate && (
              <p className="text-xs text-chart-1 flex items-center gap-1 mb-1">
                <CheckCircle className="h-3 w-3" />
                Acknowledged: {new Date(target.acknowledgedDate).toLocaleDateString()}
              </p>
            )}

            <div className="flex gap-2 mt-2">
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => downloadDemand(target)}
                className="flex-1"
              >
                <Printer className="h-3 w-3 mr-1" />
                Generate
              </Button>
              {target.status === 'draft' && (
                <Button 
                  size="sm" 
                  variant="secondary"
                  onClick={() => markAsSent(target.id)}
                  className="flex-1"
                >
                  <Send className="h-3 w-3 mr-1" />
                  Mark Sent
                </Button>
              )}
              {target.status === 'sent' && (
                <Button 
                  size="sm"
                  onClick={() => markAsAcknowledged(target.id)}
                  className="flex-1"
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Acknowledged
                </Button>
              )}
            </div>
          </div>
        ))}
      </ScrollArea>

      <div className="mt-4 p-3 rounded border border-border bg-muted/30 text-xs">
        <p className="text-muted-foreground">
          <strong>10-Day Response Window:</strong> Targets have 10 business days to confirm preservation. 
          Non-compliance should be documented for court.
        </p>
      </div>
    </CyberPanel>
  );
};

export default PreservationDemandSystem;
