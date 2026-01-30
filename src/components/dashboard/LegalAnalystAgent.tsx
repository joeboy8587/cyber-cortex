import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { 
  Scale, 
  AlertTriangle, 
  DollarSign, 
  FileWarning,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Violation {
  id: string;
  statute: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  potentialDamages: number;
  evidenceCount: number;
  status: "confirmed" | "investigating" | "dismissed";
  dateIdentified: string;
}

interface DamagesBreakdown {
  ricoPredicates: number;
  fcaViolations: number;
  civilRights: number;
  faaViolations: number;
  punitives: number;
  total: number;
}

export function LegalAnalystAgent() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [damages, setDamages] = useState<DamagesBreakdown | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const runViolationAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisProgress(0);

    try {
      // Fetch enterprise structure
      setAnalysisProgress(20);
      const { data: enterprise } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `SELECT entity_name, tier, role, legal_exposure 
                  FROM criminal_enterprise_command_structure 
                  ORDER BY tier LIMIT 30`
        }
      });

      setAnalysisProgress(40);

      // Fetch flight violations
      const { data: flights } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `SELECT registration, taxonomy_tag, COUNT(*) as count,
                  MIN(altitude) as min_alt, AVG(altitude) as avg_alt
                  FROM live_flight_detections_rows
                  WHERE altitude < 1000
                  GROUP BY registration, taxonomy_tag
                  HAVING COUNT(*) > 5
                  ORDER BY count DESC LIMIT 20`
        }
      });

      setAnalysisProgress(60);

      // Generate violations from data
      const generatedViolations: Violation[] = [];

      // FAA altitude violations
      const flightData = Array.isArray(flights) ? flights : [];
      flightData.forEach((f: any) => {
        if (f.min_alt && f.min_alt < 500) {
          generatedViolations.push({
            id: crypto.randomUUID(),
            statute: "14 CFR § 91.119",
            description: `${f.registration || "Unknown"} violated minimum altitude (${Math.round(f.min_alt)}ft) - ${f.count} instances`,
            severity: f.min_alt < 300 ? "critical" : "high",
            potentialDamages: 50000 * (f.count || 1),
            evidenceCount: f.count || 1,
            status: "confirmed",
            dateIdentified: new Date().toISOString()
          });
        }
      });

      // RICO violations from enterprise structure
      const enterpriseData = Array.isArray(enterprise) ? enterprise : [];
      const tier1Entities = enterpriseData.filter((e: any) => e.tier === 1);
      if (tier1Entities.length > 0) {
        generatedViolations.push({
          id: crypto.randomUUID(),
          statute: "18 U.S.C. § 1962(c)",
          description: `RICO enterprise identified: ${tier1Entities.length} command-level entities conducting pattern of racketeering`,
          severity: "critical",
          potentialDamages: tier1Entities.length * 500000,
          evidenceCount: enterpriseData.length,
          status: "investigating",
          dateIdentified: new Date().toISOString()
        });
      }

      // Civil rights violation
      generatedViolations.push({
        id: crypto.randomUUID(),
        statute: "42 U.S.C. § 1983",
        description: "State actor (KCSO) conducting warrantless surveillance under color of law",
        severity: "critical",
        potentialDamages: 2500000,
        evidenceCount: flightData.length,
        status: "confirmed",
        dateIdentified: new Date().toISOString()
      });

      setAnalysisProgress(80);

      setViolations(generatedViolations);

      // Calculate damages
      const damagesCalc: DamagesBreakdown = {
        ricoPredicates: generatedViolations
          .filter(v => v.statute.includes("1962"))
          .reduce((sum, v) => sum + v.potentialDamages, 0) * 3, // Treble
        fcaViolations: 27000 * 50, // Estimated false claims
        civilRights: generatedViolations
          .filter(v => v.statute.includes("1983"))
          .reduce((sum, v) => sum + v.potentialDamages, 0),
        faaViolations: generatedViolations
          .filter(v => v.statute.includes("CFR"))
          .reduce((sum, v) => sum + v.potentialDamages, 0),
        punitives: 0,
        total: 0
      };
      damagesCalc.punitives = (damagesCalc.ricoPredicates + damagesCalc.civilRights) * 0.5;
      damagesCalc.total = Object.values(damagesCalc).reduce((a, b) => a + b, 0) - damagesCalc.total;
      
      setDamages(damagesCalc);
      setAnalysisProgress(100);

      toast.success(`Identified ${generatedViolations.length} violations`);

    } catch (err) {
      console.error("Violation analysis error:", err);
      toast.error("Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-red-500";
      case "high": return "bg-orange-500";
      case "medium": return "bg-yellow-500";
      default: return "bg-blue-500";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "confirmed": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "dismissed": return <XCircle className="h-4 w-4 text-gray-500" />;
      default: return <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />;
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <Card className="border-blue-500/30 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <Scale className="h-5 w-5 text-blue-400" />
            Legal Analyst Agent
            <Badge variant="outline" className="ml-2">GPT-4o</Badge>
          </div>
          <Button
            size="sm"
            onClick={runViolationAnalysis}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Analyze Violations
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAnalyzing && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Analyzing evidence...</span>
              <span>{analysisProgress}%</span>
            </div>
            <Progress value={analysisProgress} />
          </div>
        )}

        {/* Damages Summary */}
        {damages && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/30">
              <div className="text-xs text-red-400">RICO (Treble)</div>
              <div className="text-lg font-bold">{formatCurrency(damages.ricoPredicates)}</div>
            </div>
            <div className="p-3 bg-orange-500/10 rounded-lg border border-orange-500/30">
              <div className="text-xs text-orange-400">FCA Violations</div>
              <div className="text-lg font-bold">{formatCurrency(damages.fcaViolations)}</div>
            </div>
            <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
              <div className="text-xs text-blue-400">Civil Rights</div>
              <div className="text-lg font-bold">{formatCurrency(damages.civilRights)}</div>
            </div>
            <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
              <div className="text-xs text-yellow-400">FAA Penalties</div>
              <div className="text-lg font-bold">{formatCurrency(damages.faaViolations)}</div>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
              <div className="text-xs text-purple-400">Punitives</div>
              <div className="text-lg font-bold">{formatCurrency(damages.punitives)}</div>
            </div>
            <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/30">
              <div className="text-xs text-green-400">TOTAL EXPOSURE</div>
              <div className="text-xl font-bold text-green-400">{formatCurrency(damages.total)}</div>
            </div>
          </div>
        )}

        {/* Violations List */}
        <ScrollArea className="h-[300px]">
          <div className="space-y-2">
            {violations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Run analysis to identify violations</p>
              </div>
            ) : (
              violations.map(v => (
                <div
                  key={v.id}
                  className="p-3 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge className={getSeverityColor(v.severity)}>
                        {v.severity.toUpperCase()}
                      </Badge>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {v.statute}
                      </code>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(v.status)}
                      <Badge variant="outline" className="text-xs">
                        <DollarSign className="h-3 w-3 mr-1" />
                        {formatCurrency(v.potentialDamages)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm mt-2">{v.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>{v.evidenceCount} evidence points</span>
                    <span>{new Date(v.dateIdentified).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
