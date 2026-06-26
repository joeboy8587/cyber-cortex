import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Loader2, Database, Search, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Source {
  id: string;
  schema_name: string;
  table_name: string;
  row_estimate: number;
  forensic_score: number;
  join_keys: string[];
  added_to_investigation: boolean;
  last_crawled: string;
}

export function EvidenceSourcesPanel() {
  const [crawling, setCrawling] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [sources, setSources] = useState<Source[]>([]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("discovered_evidence_sources")
      .select("*")
      .order("forensic_score", { ascending: false })
      .limit(500);
    if (error) toast.error(`Load failed: ${error.message}`);
    else setSources((data as Source[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const crawl = async () => {
    setCrawling(true);
    try {
      const { data, error } = await supabase.functions.invoke("neon-schema-crawl", {
        body: { action: "crawl" },
      });
      if (error) throw error;
      toast.success(`Crawl complete — ${data?.sources_indexed ?? 0} forensic tables indexed`);
      await load();
    } catch (e: any) {
      toast.error(`Crawl failed: ${e?.message || e}`);
    } finally { setCrawling(false); }
  };

  const toggle = async (s: Source) => {
    const { error } = await supabase
      .from("discovered_evidence_sources")
      .update({ added_to_investigation: !s.added_to_investigation })
      .eq("id", s.id);
    if (error) toast.error(error.message);
    else load();
  };

  const filtered = filter
    ? sources.filter(s =>
        s.table_name.toLowerCase().includes(filter.toLowerCase()) ||
        s.join_keys.some(k => k.toLowerCase().includes(filter.toLowerCase())))
    : sources;

  return (
    <Card className="border-cyan-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-cyan-400">
          <Database className="w-5 h-5" />
          Evidence Source Registry — Auto-Discovery of All Neon Tables
        </CardTitle>
        <p className="font-mono text-xs text-muted-foreground">
          Scores every table by forensic relevance (icao, timestamp, lat/lng, callsign, biometric, case keys).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={crawl} disabled={crawling}>
            {crawling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
            Crawl Neon Schema
          </Button>
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Filter by table or join key..."
              value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <Badge variant="outline">{filtered.length} of {sources.length}</Badge>
        </div>

        <ScrollArea className="h-[460px] rounded border">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-card border-b">
              <tr>
                <th className="text-left p-2">Table</th>
                <th className="text-right p-2">Rows (est.)</th>
                <th className="text-right p-2">Score</th>
                <th className="text-left p-2">Join Keys</th>
                <th className="text-right p-2">Investigation</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-b hover:bg-muted/30">
                  <td className="p-2">
                    <div className="font-bold">{s.table_name}</div>
                    <div className="text-muted-foreground">{s.schema_name}</div>
                  </td>
                  <td className="p-2 text-right">{Number(s.row_estimate).toLocaleString()}</td>
                  <td className="p-2 text-right">
                    <Badge variant={s.forensic_score >= 20 ? "destructive" : s.forensic_score >= 10 ? "default" : "secondary"}>
                      {s.forensic_score}
                    </Badge>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {s.join_keys.slice(0, 6).map(k => (
                        <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-2 text-right">
                    <Button size="sm" variant={s.added_to_investigation ? "default" : "outline"} onClick={() => toggle(s)}>
                      {s.added_to_investigation ? <><Check className="w-3 h-3 mr-1" />Added</> : <><Plus className="w-3 h-3 mr-1" />Add</>}
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">
                  {sources.length === 0 ? "No sources yet — click 'Crawl Neon Schema'." : "No matches."}
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
