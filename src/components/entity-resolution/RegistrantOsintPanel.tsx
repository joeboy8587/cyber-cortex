import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { toast } from "sonner";
import { Search, RefreshCw, AlertTriangle, Building2, Users, MapPin, FileText } from "lucide-react";

interface ScanResult {
  scanned?: { registrant: string; matches: number }[];
  matches_total?: number;
  conflicts_found?: number;
  conflicts?: any[];
}

export function RegistrantOsintPanel() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [limit, setLimit] = useState(10);
  const [singleName, setSingleName] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [entities, setEntities] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);

  const runBatch = async () => {
    setLoading(true);
    setProgress(15);
    setResult(null);
    try {
      toast.info(`Scanning top ${limit} registrants via OpenCorporates + CA SoS...`);
      const timer = setInterval(() => setProgress((p) => Math.min(p + 5, 90)), 2000);
      const { data, error } = await supabase.functions.invoke("registrant-osint-scan", {
        body: { action: "scan_batch", limit },
      });
      clearInterval(timer);
      setProgress(100);
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Scan failed");
      setResult(data);
      toast.success(`Scanned ${data.registrants_scanned} registrants — ${data.matches_total} matches, ${data.conflicts_found} conflicts`);
      await loadResults();
    } catch (e: any) {
      toast.error(`OSINT scan failed: ${e.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 1500);
    }
  };

  const runSingle = async () => {
    if (!singleName.trim()) {
      toast.error("Enter a registrant name");
      return;
    }
    setLoading(true);
    setProgress(20);
    try {
      const { data, error } = await supabase.functions.invoke("registrant-osint-scan", {
        body: { action: "scan_registrant", registrant_name: singleName.trim() },
      });
      setProgress(100);
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Scan failed");
      setResult(data);
      toast.success(`Found ${data.matches_total} corporate records for "${singleName}"`);
      await loadResults();
    } catch (e: any) {
      toast.error(`Lookup failed: ${e.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 1500);
    }
  };

  const loadResults = async () => {
    const { data } = await supabase.functions.invoke("registrant-osint-scan", {
      body: { action: "list_results" },
    });
    if (data?.success) {
      setEntities(data.entities || []);
      setConflicts(data.conflicts || []);
    }
  };

  return (
    <CyberPanel title="Registrant OSINT Sweep" icon={<Search className="h-5 w-5" />}>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Pulls unique registrant names from Aircraft Registry, queries <strong>OpenCorporates</strong> and{" "}
          <strong>CA Secretary of State</strong> via Firecrawl, and flags shared officers, addresses, and registered agents across your shell fleet.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs font-medium">Batch scan top N registrants</label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={25}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                disabled={loading}
              />
              <Button onClick={runBatch} disabled={loading}>
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Run Sweep"}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Single registrant lookup</label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. ALF IX LLC"
                value={singleName}
                onChange={(e) => setSingleName(e.target.value)}
                disabled={loading}
                onKeyDown={(e) => e.key === "Enter" && runSingle()}
              />
              <Button onClick={runSingle} disabled={loading} variant="secondary">
                Lookup
              </Button>
            </div>
          </div>
        </div>

        {progress > 0 && <Progress value={progress} className="h-2" />}

        {result && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 rounded border bg-background/50">
              <Building2 className="h-4 w-4 mx-auto mb-1 text-primary" />
              <div className="text-lg font-bold">{result.matches_total ?? 0}</div>
              <div className="text-xs text-muted-foreground">Corporate Matches</div>
            </div>
            <div className="p-3 rounded border bg-background/50">
              <Users className="h-4 w-4 mx-auto mb-1 text-primary" />
              <div className="text-lg font-bold">{result.scanned?.length ?? 0}</div>
              <div className="text-xs text-muted-foreground">Registrants Scanned</div>
            </div>
            <div className="p-3 rounded border bg-background/50">
              <AlertTriangle className="h-4 w-4 mx-auto mb-1 text-destructive" />
              <div className="text-lg font-bold text-destructive">{result.conflicts_found ?? 0}</div>
              <div className="text-xs text-muted-foreground">Shared-Actor Flags</div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm font-medium">Saved Results</span>
          <Button variant="ghost" size="sm" onClick={loadResults} disabled={loading}>
            <RefreshCw className="h-3 w-3 mr-1" /> Load
          </Button>
        </div>

        {conflicts.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm font-medium">Shared-Actor Conflicts ({conflicts.length})</span>
            </div>
            <ScrollArea className="h-[180px]">
              <div className="space-y-1">
                {conflicts.map((c) => (
                  <div key={c.id} className="p-2 rounded border border-destructive/30 bg-destructive/5 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="destructive" className="text-[10px]">
                        {c.field === "shared_officer" && <Users className="h-3 w-3 mr-1" />}
                        {c.field === "shared_address" && <MapPin className="h-3 w-3 mr-1" />}
                        {c.field === "shared_agent" && <FileText className="h-3 w-3 mr-1" />}
                        {c.field?.replace("_", " ")}
                      </Badge>
                      <span className="font-mono">{c.value_a}</span>
                    </div>
                    <div className="text-muted-foreground">
                      Links: {c.registration} + {c.value_b}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {entities.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Entities in Registry ({entities.length})</span>
            </div>
            <ScrollArea className="h-[220px]">
              <div className="space-y-1">
                {entities.map((e) => {
                  const oc = e.metadata?.opencorporates;
                  const ca = e.metadata?.ca_sos;
                  const primary = oc || ca || {};
                  return (
                    <div key={e.entity_id} className="p-2 rounded border bg-background/50 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{e.canonical_identifier}</span>
                        <div className="flex gap-1">
                          {oc && <Badge variant="outline" className="text-[10px]">OpenCorporates</Badge>}
                          {ca && <Badge variant="outline" className="text-[10px]">CA SoS</Badge>}
                          {primary.status && <Badge variant="secondary" className="text-[10px]">{primary.status}</Badge>}
                        </div>
                      </div>
                      {primary.jurisdiction && (
                        <div className="text-muted-foreground">Jurisdiction: {primary.jurisdiction}</div>
                      )}
                      {primary.registered_address && (
                        <div className="text-muted-foreground">Addr: {primary.registered_address}</div>
                      )}
                      {primary.registered_agent && (
                        <div className="text-muted-foreground">Agent: {primary.registered_agent}</div>
                      )}
                      {primary.officers?.length > 0 && (
                        <div className="text-muted-foreground">
                          Officers: {primary.officers.slice(0, 4).join(", ")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </CyberPanel>
  );
}
