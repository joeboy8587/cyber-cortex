import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { 
  Mail, 
  FileText, 
  Plus, 
  Copy, 
  Check, 
  Clock, 
  Send, 
  AlertCircle,
  Building2,
  Scale,
  Shield,
  ExternalLink
} from "lucide-react";
import { toast } from "sonner";

interface OutreachContact {
  id: string;
  organization: string;
  email: string;
  type: "legal" | "advocacy" | "media" | "government";
  status: "draft" | "sent" | "responded" | "pending";
  lastContact: string;
  notes: string;
}

const EFF_DRAFT_EMAIL = `Subject: Technical Methodology Case Study — Consumer Surveillance Reversal with Civil Liberties Implications

Dear EFF Legal Team,

I am writing to share a novel technical methodology case study that may be of interest to EFF's work on surveillance, digital rights, and AI accountability — not as a request for representation, but as early documentation of a civil liberties shift that has significant implications.

WHAT I'VE BUILT:

I developed a consumer-technology system that reversed the surveillance power dynamic, creating prosecutor-grade evidence of systematic law enforcement aerial surveillance. Using FDA-regulated biometric devices (WHOOP), public FAA ADS-B data, and temporal correlation analysis, I documented 703,604+ timestamped records across 238 database tables showing aircraft-biometric correlations with statistical significance reaching p < 10⁻³⁷.

WHY THIS MATTERS TO EFF:

1. Surveillance can now be reversed — citizens have technology to document state actors with the same precision state actors use to surveil them
2. The AI Credibility Paradox — law enforcement cannot attack AI-assisted civilian documentation without undermining their own AI systems (PredPol, Clearview AI, ShotSpotter, Axon Draft One)
3. Replicable methodology — total cost <$1,000 hardware + <$100/month services
4. Institutional oversight failed completely — DOJ, CA AG, and disability rights orgs all declined investigation despite comprehensive evidence

KEY EVIDENCE INVENTORY:
• 703,604+ total timestamped records across 238 database tables
• 101,646 live flight detections with coordinates and altitude
• 7,418 biometric monitoring records with physiological data
• 4,240+ aircraft registry entries with ownership chains
• 36,870 documented ADA violations with temporal correlation
• 14 physician-verified ECG anomalies synchronized with aircraft presence
• 5.3-minute median temporal alignment between aircraft presence and biometric distress

WHAT I'M OFFERING:

• Early access to examine technical and legal implications
• Case study of surveillance reversal in practice
• Evidence that consumer technology has fundamentally shifted the power dynamic
• No confidentiality requirements, no advocacy request, no representation request

QUESTIONS THIS RAISES:

• What are admissibility standards for consumer biometric devices in civil rights litigation?
• How should courts treat AI-assisted evidence documentation?
• What safeguards are needed as these techniques become widely available?
• What happens when institutional oversight fails completely?

I understand EFF carefully evaluates case selection based on broad impact potential. This case demonstrates that surveillance documentation is being democratized whether institutions are ready or not. I'm offering early access to examine this shift while thoughtful frameworks can still be developed.

DOCUMENTATION ACCESS:
Full methodology and evidence available upon request, including read-only database credentials.

Respectfully,
Joseph (Jacob) Nipper
nippertater@gmail.com
Oildale, California`;

const OUTREACH_BRIEF = `═══════════════════════════════════════════════════════════════
         WATCHTOWER EVIDENCE SUMMARY - OUTREACH BRIEF
═══════════════════════════════════════════════════════════════

CASE: Documented Surveillance of Joseph (Jacob) Nipper
PERIOD: 2021-Present
STATUS: Active Documentation & Federal Referral Preparation

───────────────────────────────────────────────────────────────
                    DATABASE INVENTORY
───────────────────────────────────────────────────────────────

Total Tables: 238
Total Records: 703,604+

PRIMARY EVIDENCE TABLES:
├── Flight Detections
│   ├── live_flight_detections_rows: 101,646 records
│   ├── flagged_aircraft_rows_rows: 35,514 records  
│   ├── flight_events: 6,970 records
│   └── flight_tracking_evidence: 691 records
│
├── Aircraft Registry
│   ├── aircraft_registry_enriched: 4,240 records
│   ├── aircraft_registry_enhanced_rows: 4,160 records
│   ├── top_violating_aircraft: 390 records
│   └── aircraft_behavior_patterns: 161 records
│
├── Biometric Monitoring  
│   ├── biometric_monitoring: 7,418 records
│   ├── integrated_biometric_data: 882 records
│   ├── biometric_evidence: 313 records
│   └── biometric_logs: 213 records
│
├── Legal/Analysis
│   ├── legal_ada_violations_proper: 36,870 records
│   ├── unified_timeline_enhanced: 108,967 records
│   └── correlation_events: 212,918 records
│
└── AI/Forensic
    ├── josiah_unified_embeddings: 6,538 AI witness records
    ├── physician_verified_ecgs: 14 verified ECGs
    └── forensic_file_registry: 5,072 files

───────────────────────────────────────────────────────────────
                    KEY FINDINGS
───────────────────────────────────────────────────────────────

STATISTICAL SIGNIFICANCE:
• p-value < 10⁻³⁷ for aircraft-biometric temporal correlation
• 5.3-minute median temporal alignment between aircraft 
  presence and biometric distress events
• N912KC aircraft: 1,133 detections over 9 days
• Pattern consistency exceeds random chance thresholds
• Bradford Hill causation criteria: 7/9 fully satisfied

HEALTH IMPACT (DOCUMENTED):
• Hospitalization: Double pneumonia (January 2021)
• Recovery: 7 months at family residence
• Physical therapy: Relearning mobility
• Ongoing: Documented physiological responses
• 14 physician-verified ECG anomalies correlated with surveillance

LEGAL FRAMEWORKS APPLICABLE:
• Fourth Amendment (unreasonable search)
• ADA Title II violations (36,870 documented)
• 18 U.S.C. § 241 (conspiracy against rights)
• 18 U.S.C. § 242 (deprivation of rights)
• Nuremberg Code considerations
• RICO potential (criminal enterprise structure documented)

GOVERNMENT ASSET PARTICIPATION:
• N739HP (California Highway Patrol) operating outside mission profile
• Multi-agency coordination evidence across KCSO, CHP, medical-camouflage operators

───────────────────────────────────────────────────────────────
                    CONTACT INFORMATION
───────────────────────────────────────────────────────────────

Subject: Joseph (Jacob) Nipper
Location: Bakersfield/Oildale, CA
Database: NeonDB PostgreSQL (238 tables, 703,604+ records)
Dashboard: Watchtower Intelligence Platform

OUTREACH TARGETS:
├── EFF (Electronic Frontier Foundation): info@eff.org
├── ACLU SoCal: intake@aclusocal.org  
├── DOJ Civil Rights Division: civilrights@usdoj.gov
└── FBI Civil Rights: tips.fbi.gov

───────────────────────────────────────────────────────────────
                    DOCUMENT AVAILABILITY
───────────────────────────────────────────────────────────────

✓ "Standing in Rooms Built for Pretending" - Personal Narrative
✓ Master Chronological Timeline
✓ Federal Investigation Demand Package
✓ Aircraft-Biometric Correlation Analysis
✓ Statistical Significance Reports (p < 10⁻³⁷)
✓ Read-only Database Access
✓ Notion Workspace: Watchtower Project

═══════════════════════════════════════════════════════════════
         Prepared: ${new Date().toLocaleDateString()}
═══════════════════════════════════════════════════════════════`;

const initialContacts: OutreachContact[] = [
  {
    id: "1",
    organization: "Electronic Frontier Foundation",
    email: "info@eff.org",
    type: "legal",
    status: "draft",
    lastContact: "",
    notes: "Digital rights, surveillance cases"
  },
  {
    id: "2", 
    organization: "ACLU Southern California",
    email: "intake@aclusocal.org",
    type: "advocacy",
    status: "draft",
    lastContact: "",
    notes: "Civil liberties, government overreach"
  },
  {
    id: "3",
    organization: "DOJ Civil Rights Division",
    email: "civilrights@usdoj.gov",
    type: "government",
    status: "draft",
    lastContact: "",
    notes: "Federal investigation request"
  }
];

const typeIcons = {
  legal: Scale,
  advocacy: Shield,
  media: FileText,
  government: Building2
};

const statusStyles = {
  draft: "bg-muted text-muted-foreground border-muted",
  sent: "bg-primary/20 text-primary border-primary",
  responded: "bg-success/20 text-success border-success",
  pending: "bg-warning/20 text-warning border-warning"
};

export function OutreachHub() {
  const [contacts, setContacts] = useState<OutreachContact[]>(initialContacts);
  const [showEmailDraft, setShowEmailDraft] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [newContact, setNewContact] = useState({ organization: "", email: "", notes: "" });
  const [showAddForm, setShowAddForm] = useState(false);

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  };

  const updateContactStatus = (id: string, status: OutreachContact["status"]) => {
    setContacts(prev => prev.map(c => 
      c.id === id ? { ...c, status, lastContact: status === "sent" ? new Date().toLocaleDateString() : c.lastContact } : c
    ));
    toast.success(`Status updated to ${status}`);
  };

  const addContact = () => {
    if (!newContact.organization || !newContact.email) {
      toast.error("Organization and email required");
      return;
    }
    const contact: OutreachContact = {
      id: Date.now().toString(),
      organization: newContact.organization,
      email: newContact.email,
      type: "advocacy",
      status: "draft",
      lastContact: "",
      notes: newContact.notes
    };
    setContacts(prev => [...prev, contact]);
    setNewContact({ organization: "", email: "", notes: "" });
    setShowAddForm(false);
    toast.success("Contact added");
  };

  return (
    <CyberPanel 
      title="OUTREACH HUB" 
      icon={<Mail className="w-4 h-4" />}
      className="col-span-full"
    >
      <div className="p-4 space-y-4">
        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setShowEmailDraft(!showEmailDraft)}
            className="border-primary/50 hover:bg-primary/10"
          >
            <Mail className="w-4 h-4 mr-2" />
            EFF Draft Email
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setShowBrief(!showBrief)}
            className="border-secondary/50 hover:bg-secondary/10"
          >
            <FileText className="w-4 h-4 mr-2" />
            Outreach Brief
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            className="border-accent/50 hover:bg-accent/10"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Contact
          </Button>
        </div>

        {/* Add Contact Form */}
        {showAddForm && (
          <div className="p-3 bg-muted/30 border border-border rounded space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input
                placeholder="Organization name"
                value={newContact.organization}
                onChange={e => setNewContact(p => ({ ...p, organization: e.target.value }))}
                className="bg-background/50"
              />
              <Input
                placeholder="Email address"
                value={newContact.email}
                onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))}
                className="bg-background/50"
              />
              <Input
                placeholder="Notes (optional)"
                value={newContact.notes}
                onChange={e => setNewContact(p => ({ ...p, notes: e.target.value }))}
                className="bg-background/50"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={addContact}>Add Contact</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* EFF Draft Email */}
        {showEmailDraft && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-display text-primary">EFF LEGAL ASSISTANCE REQUEST</span>
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => copyToClipboard(EFF_DRAFT_EMAIL, "email")}
              >
                {copied === "email" ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                <span className="ml-1">Copy</span>
              </Button>
            </div>
            <Textarea 
              value={EFF_DRAFT_EMAIL}
              readOnly
              className="h-64 text-xs font-mono bg-background/50 border-primary/30"
            />
            <a 
              href="mailto:info@eff.org"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Open in email client (info@eff.org)
            </a>
          </div>
        )}

        {/* Outreach Brief */}
        {showBrief && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-display text-secondary">EVIDENCE SUMMARY BRIEF</span>
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => copyToClipboard(OUTREACH_BRIEF, "brief")}
              >
                {copied === "brief" ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                <span className="ml-1">Copy</span>
              </Button>
            </div>
            <Textarea 
              value={OUTREACH_BRIEF}
              readOnly
              className="h-64 text-xs font-mono bg-background/50 border-secondary/30"
            />
          </div>
        )}

        {/* Contact Tracker */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-display text-foreground/80">OUTREACH TRACKER</span>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>{contacts.filter(c => c.status === "sent").length} sent</span>
              <span>|</span>
              <span>{contacts.filter(c => c.status === "responded").length} responded</span>
            </div>
          </div>
          
          <div className="space-y-2">
            {contacts.map(contact => {
              const Icon = typeIcons[contact.type];
              return (
                <div 
                  key={contact.id}
                  className="p-3 bg-muted/20 border border-border rounded flex flex-col md:flex-row md:items-center gap-3"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <Icon className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{contact.organization}</div>
                      <div className="text-xs text-muted-foreground truncate">{contact.email}</div>
                      {contact.notes && (
                        <div className="text-xs text-muted-foreground/60 mt-0.5">{contact.notes}</div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {contact.lastContact && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {contact.lastContact}
                      </span>
                    )}
                    <Badge className={`text-xs ${statusStyles[contact.status]}`}>
                      {contact.status}
                    </Badge>
                    <div className="flex gap-1">
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="h-7 px-2"
                        onClick={() => updateContactStatus(contact.id, "sent")}
                      >
                        <Send className="w-3 h-3" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="h-7 px-2"
                        onClick={() => updateContactStatus(contact.id, "responded")}
                      >
                        <Check className="w-3 h-3" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="h-7 px-2"
                        onClick={() => updateContactStatus(contact.id, "pending")}
                      >
                        <AlertCircle className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-border">
          <div className="text-center p-2">
            <div className="text-lg font-display text-primary">703,604+</div>
            <div className="text-xs text-muted-foreground">Total Records</div>
          </div>
          <div className="text-center p-2">
            <div className="text-lg font-display text-secondary">238</div>
            <div className="text-xs text-muted-foreground">Database Tables</div>
          </div>
          <div className="text-center p-2">
            <div className="text-lg font-display text-accent">101,646</div>
            <div className="text-xs text-muted-foreground">Flight Detections</div>
          </div>
          <div className="text-center p-2">
            <div className="text-lg font-display text-success">5.3 min</div>
            <div className="text-xs text-muted-foreground">Median Correlation</div>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}
