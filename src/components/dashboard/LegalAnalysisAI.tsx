import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Scale, Send, Loader2, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const presetQueries = [
  "Analyze RICO enterprise structure from aircraft data",
  "Calculate Bradford Hill causation criteria compliance",
  "Generate ADA violation summary for 27 aircraft",
  "Assess Nuremberg Code violations evidence",
  "Evaluate infrastructure-to-need ratio for mass scale proof",
];

const sampleAnalysis = {
  title: "RICO Enterprise Analysis",
  confidence: 94,
  findings: [
    {
      type: "proven",
      text: "Pattern of Racketeering Activity: 212,918 documented correlation events",
    },
    {
      type: "proven",
      text: "Enterprise Structure: 4,061 aircraft, 27 KCSO-linked vehicles",
    },
    {
      type: "proven",
      text: "Economic Enterprise: $12M-$50M estimated operational cost",
    },
    {
      type: "warning",
      text: "Infrastructure Ratio: 2,030:1 beyond single-target necessity",
    },
  ],
  legalBasis: [
    "18 U.S.C. § 1962 - RICO Act",
    "42 U.S.C. § 12132 - ADA Title II",
    "Nuremberg Code Article 1",
    "4th Amendment - Unreasonable Surveillance",
  ],
};

export function LegalAnalysisAI() {
  const [query, setQuery] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showResults, setShowResults] = useState(true);

  const handleAnalyze = () => {
    if (!query.trim()) return;
    setIsAnalyzing(true);
    setTimeout(() => {
      setIsAnalyzing(false);
      setShowResults(true);
    }, 2000);
  };

  return (
    <CyberPanel
      title="Legal Analysis AI"
      icon={<Scale className="w-4 h-4" />}
      className="h-full"
    >
      <div className="p-4 flex flex-col h-[calc(100%-48px)]">
        {/* Query input */}
        <div className="mb-4">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              placeholder="Enter legal analysis query..."
              className="w-full bg-muted/50 border border-border rounded px-4 py-3 pr-12 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-primary hover:text-primary/80 disabled:opacity-50"
            >
              {isAnalyzing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
          
          {/* Preset queries */}
          <div className="flex flex-wrap gap-2 mt-3">
            {presetQueries.map((preset) => (
              <button
                key={preset}
                onClick={() => setQuery(preset)}
                className="text-xs px-2 py-1 rounded bg-muted border border-border hover:border-primary hover:text-primary transition-colors"
              >
                {preset.slice(0, 30)}...
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        {showResults && (
          <div className="flex-1 overflow-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-primary">
                {sampleAnalysis.title}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Confidence</span>
                <span className="font-display text-lg text-success glow-green">
                  {sampleAnalysis.confidence}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {sampleAnalysis.findings.map((finding, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded border",
                    finding.type === "proven"
                      ? "bg-success/10 border-success/30"
                      : "bg-warning/10 border-warning/30"
                  )}
                >
                  {finding.type === "proven" ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  )}
                  <span className="text-sm">{finding.text}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-4">
              <h4 className="font-display text-sm text-muted-foreground mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Applicable Legal Framework
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {sampleAnalysis.legalBasis.map((basis) => (
                  <div
                    key={basis}
                    className="text-xs p-2 bg-muted/30 rounded border border-border font-mono"
                  >
                    {basis}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </CyberPanel>
  );
}
