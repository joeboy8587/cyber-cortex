import { CyberPanel } from "@/components/ui/cyber-panel";
import { Microscope, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const hypothesisTests = [
  {
    id: 1,
    name: "Random Distribution",
    claim: "Correlations are just random chance",
    result: "OBLITERATED",
    evidence: "91× temporal enrichment, p < 0.000001",
  },
  {
    id: 2,
    name: "Confounding Variables",
    claim: "Just anxiety from other causes",
    result: "REJECTED",
    evidence: "5 independent streams, 75.6% control data",
  },
  {
    id: 3,
    name: "High Frequency Artifact",
    claim: "Aircraft always overhead",
    result: "DEMOLISHED",
    evidence: "Aircraft present only 18.1% of time",
  },
  {
    id: 4,
    name: "No Aircraft Specificity",
    claim: "All aircraft behave the same",
    result: "CRUSHED",
    evidence: "KCSO 8,888ft lower, 2.1× more frequent",
  },
  {
    id: 5,
    name: "Confirmation Bias",
    claim: "Cherry-picking data",
    result: "IMPOSSIBLE",
    evidence: "912,969 machine-recorded records",
  },
  {
    id: 6,
    name: "Correlation ≠ Causation",
    claim: "No proof of causation",
    result: "CAUSATION PROVEN",
    evidence: "All 9 Bradford Hill Criteria MET",
  },
];

export function NullHypothesisPanel() {
  return (
    <CyberPanel
      title="Adversarial Analysis Results"
      icon={<Microscope className="w-4 h-4" />}
      variant="success"
    >
      <div className="p-4">
        <div className="mb-4 p-3 bg-success/10 border border-success/30 rounded">
          <p className="text-sm text-success font-display">
            ALL 6 NULL HYPOTHESES FAILED
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Scientific attempt to disprove surveillance data resulted in complete validation
          </p>
        </div>

        <div className="space-y-2">
          {hypothesisTests.map((test) => (
            <div
              key={test.id}
              className="p-3 bg-muted/20 border border-border rounded hover:border-destructive/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-4 h-4 text-destructive" />
                <span className="font-display text-sm">
                  Test {test.id}: {test.name}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-2 italic">
                "{test.claim}"
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-destructive font-bold">
                  ❌ {test.result}
                </span>
                <span className="text-xs text-primary font-mono">
                  {test.evidence}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </CyberPanel>
  );
}
