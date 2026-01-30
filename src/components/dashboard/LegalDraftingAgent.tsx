import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileText, 
  Loader2, 
  Download,
  Copy,
  CheckCircle,
  Scale,
  AlertTriangle,
  FileWarning
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type DocumentType = "rico_complaint" | "tro_motion" | "faa_demand" | "congressional_brief";

interface DraftedDocument {
  id: string;
  type: DocumentType;
  title: string;
  content: string;
  createdAt: Date;
  status: "draft" | "review" | "final";
}

const DOCUMENT_TEMPLATES: Record<DocumentType, { name: string; icon: React.ReactNode; prompt: string }> = {
  rico_complaint: {
    name: "RICO Complaint",
    icon: <Scale className="h-4 w-4" />,
    prompt: "Draft a federal RICO complaint under 18 U.S.C. § 1962 against the identified enterprise"
  },
  tro_motion: {
    name: "TRO Motion",
    icon: <AlertTriangle className="h-4 w-4" />,
    prompt: "Draft a motion for temporary restraining order citing irreparable harm from ongoing surveillance"
  },
  faa_demand: {
    name: "FAA Formal Demand",
    icon: <FileWarning className="h-4 w-4" />,
    prompt: "Draft a formal demand to the FAA Administrator citing 14 CFR violations with evidence"
  },
  congressional_brief: {
    name: "Congressional Brief",
    icon: <FileText className="h-4 w-4" />,
    prompt: "Draft a briefing document for congressional oversight committee on government surveillance abuse"
  }
};

export function LegalDraftingAgent() {
  const [isDrafting, setIsDrafting] = useState(false);
  const [activeTab, setActiveTab] = useState<DocumentType>("rico_complaint");
  const [customInstructions, setCustomInstructions] = useState("");
  const [draftedContent, setDraftedContent] = useState("");
  const [documents, setDocuments] = useState<DraftedDocument[]>([]);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const generateDraft = useCallback(async () => {
    setIsDrafting(true);
    setDraftedContent("");

    try {
      // Fetch context data
      const [enterpriseRes, flightsRes] = await Promise.all([
        supabase.functions.invoke("neon-query", {
          body: {
            action: "customQuery",
            query: `SELECT entity_name, tier, role, legal_exposure 
                    FROM criminal_enterprise_command_structure 
                    ORDER BY tier LIMIT 20`
          }
        }),
        supabase.functions.invoke("neon-query", {
          body: {
            action: "customQuery",
            query: `SELECT registration, taxonomy_tag, COUNT(*) as detections,
                    MIN(altitude) as min_alt
                    FROM live_flight_detections_rows
                    WHERE detection_timestamp > NOW() - INTERVAL '90 days'
                    GROUP BY registration, taxonomy_tag
                    ORDER BY detections DESC LIMIT 15`
          }
        })
      ]);

      const template = DOCUMENT_TEMPLATES[activeTab];
      const enterprise = Array.isArray(enterpriseRes.data) ? enterpriseRes.data : [];
      const flights = Array.isArray(flightsRes.data) ? flightsRes.data : [];

      const databaseContext = `
ENTERPRISE DEFENDANTS:
${enterprise.map((e: any) => `- Tier ${e.tier}: ${e.entity_name} (${e.role}) - Exposure: ${e.legal_exposure || 'TBD'}`).join('\n')}

FLIGHT EVIDENCE:
${flights.map((f: any) => `- ${f.registration}: ${f.detections} detections, min altitude ${f.min_alt}ft`).join('\n')}

CUSTOM INSTRUCTIONS: ${customInstructions || 'None'}
`;

      abortRef.current = new AbortController();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-orchestrator`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
          },
          body: JSON.stringify({
            agentType: "legal_drafter",
            message: `${template.prompt}\n\n${databaseContext}`,
            context: { documentType: activeTab }
          }),
          signal: abortRef.current.signal
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                setDraftedContent(fullContent);
              }
            } catch {}
          }
        }
      }

      // Save to documents
      const newDoc: DraftedDocument = {
        id: crypto.randomUUID(),
        type: activeTab,
        title: `${template.name} - ${new Date().toLocaleDateString()}`,
        content: fullContent,
        createdAt: new Date(),
        status: "draft"
      };
      setDocuments(prev => [newDoc, ...prev]);

      toast.success(`${template.name} drafted successfully`);

    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Drafting error:", err);
      toast.error("Failed to generate draft");
    } finally {
      setIsDrafting(false);
    }
  }, [activeTab, customInstructions]);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(draftedContent);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadDocument = () => {
    const blob = new Blob([draftedContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeTab}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-green-500/30 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-green-400" />
            Legal Drafting Agent
            <Badge variant="outline" className="ml-2">GPT-4o</Badge>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={copyToClipboard}
              disabled={!draftedContent}
            >
              {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={downloadDocument}
              disabled={!draftedContent}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Document Type Selector */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DocumentType)}>
          <TabsList className="grid grid-cols-4">
            {Object.entries(DOCUMENT_TEMPLATES).map(([key, template]) => (
              <TabsTrigger key={key} value={key} className="flex items-center gap-1 text-xs">
                {template.icon}
                <span className="hidden md:inline">{template.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Custom Instructions */}
        <div>
          <label className="text-sm text-muted-foreground mb-1 block">
            Additional Instructions (optional)
          </label>
          <Textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="E.g., Focus on N912KC violations, include specific dates..."
            className="min-h-[60px]"
          />
        </div>

        {/* Generate Button */}
        <Button
          onClick={generateDraft}
          disabled={isDrafting}
          className="w-full"
        >
          {isDrafting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Drafting {DOCUMENT_TEMPLATES[activeTab].name}...
            </>
          ) : (
            <>
              <FileText className="h-4 w-4 mr-2" />
              Generate {DOCUMENT_TEMPLATES[activeTab].name}
            </>
          )}
        </Button>

        {/* Draft Output */}
        <ScrollArea className="h-[350px] border rounded-lg p-4">
          {draftedContent ? (
            <pre className="text-sm whitespace-pre-wrap font-mono">{draftedContent}</pre>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileText className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Select document type and generate</p>
            </div>
          )}
        </ScrollArea>

        {/* Recent Documents */}
        {documents.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Recent Drafts</h4>
            <div className="flex flex-wrap gap-2">
              {documents.slice(0, 5).map(doc => (
                <Badge
                  key={doc.id}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => setDraftedContent(doc.content)}
                >
                  {DOCUMENT_TEMPLATES[doc.type].icon}
                  <span className="ml-1">{doc.title.substring(0, 20)}...</span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
