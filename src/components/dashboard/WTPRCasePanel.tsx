import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Loader2, Folder, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export function WTPRCasePanel() {
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data: resp, error } = await supabase.functions.invoke("wtpr-cases", {
        body: { action: "list", search, limit: 100 },
      });
      if (error) throw error;
      setData(resp);
    } catch (e: any) {
      toast.error(`Load failed: ${e?.message || e}`);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const cases = data?.cases || [];
  const cols = (data?.columns || []).slice(0, 8);

  return (
    <Card className="border-purple-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-purple-400">
          <Folder className="w-5 h-5" />
          WTPR Case System
        </CardTitle>
        <p className="font-mono text-xs text-muted-foreground">
          {data?.table
            ? <>Reading from <code>{data.table}</code> · {data.total?.toLocaleString()} total records</>
            : "Auto-detects WTPR case tables in Neon."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search cases..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()} />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Reload
          </Button>
        </div>

        {data?.detected?.length > 1 && (
          <div className="flex flex-wrap gap-2 text-xs font-mono">
            <span className="text-muted-foreground">Detected WTPR tables:</span>
            {data.detected.map((t: any) => (
              <Badge key={`${t.table_schema}.${t.table_name}`} variant="outline">{t.table_name}</Badge>
            ))}
          </div>
        )}

        <ScrollArea className="h-[440px] rounded border">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-card border-b">
              <tr>
                {cols.map((c: any) => (
                  <th key={c.name} className="text-left p-2 whitespace-nowrap">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cases.map((row: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30">
                  {cols.map((c: any) => {
                    const v = row[c.name];
                    const display = v === null || v === undefined
                      ? "—"
                      : typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 80);
                    return <td key={c.name} className="p-2 whitespace-nowrap">{display}</td>;
                  })}
                </tr>
              ))}
              {cases.length === 0 && !loading && (
                <tr><td colSpan={cols.length || 1} className="p-6 text-center text-muted-foreground">
                  {data?.message || "No cases found."}
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
