import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Map as MapIcon, RefreshCw, Download, Fingerprint, Loader2 } from "lucide-react";
import { downloadCSV, forensicFilename } from "@/lib/csv";

type T = { schema: string; table: string; category: string; rows: number; bytes: number; first_seen: string | null; last_seen: string | null; grade: string; issues: string[]; role: string };

const ROLE: Record<string, string> = { main: "Main source", copy_or_side: "Copy / side table", snapshot: "Old snapshot", empty: "Empty" };
const gradeVariant = (g: string) => (g === "A" || g === "B" ? "default" : g === "—" ? "outline" : "destructive") as any;
const fmt = (n: number) => n.toLocaleString();
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");
const sane = (s: string | null) => (s && s < new Date(Date.now() + 864e5).toISOString() ? s : null);

export default function DataMap() {
  const [census, setCensus] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [hideEmpty, setHideEmpty] = useState(true);

  const load = async () => {
    const { data } = await supabase.functions.invoke("data-map", { body: { action: "latest" } });
    setCensus(data?.census ?? null); setHistory(data?.history ?? []);
    if (!data?.census) run();
  };
  const run = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.functions.invoke("data-map", { body: { action: "run" } });
    setBusy(false);
    if (error || !data?.ok) { setErr(data?.error || error?.message || "Census failed"); return; }
    setCensus(data.census); load();
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const tables: T[] = census?.tables ?? [];
  const cats = useMemo(() => Object.entries(census?.by_category ?? {}).sort((a: any, b: any) => b[1].rows - a[1].rows) as [string, any][], [census]);
  const shown = useMemo(() => tables.filter((t) =>
    (!cat || t.category === cat) && (!hideEmpty || t.rows > 0) &&
    (!q || `${t.schema}.${t.table}`.toLowerCase().includes(q.toLowerCase()))), [tables, cat, q, hideEmpty]);
  const flight = census?.by_category?.["Flight / ADS-B"];

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><MapIcon className="h-6 w-6 text-primary" /> Data Map</h1>
            <p className="text-sm text-muted-foreground">Every table in the investigation database — what it holds, which period it covers, how clean it is. Nothing is ever deleted; copies are only labelled.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!tables.length}
              onClick={() => downloadCSV(tables.map((t) => ({ ...t, issues: t.issues.join("; "), role: ROLE[t.role] })), forensicFilename("CENSUS", "DATA_MAP"),
                ["schema", "table", "category", "role", "rows", "grade", "first_seen", "last_seen", "issues"])}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />} Recount now</Button>
          </div>
        </div>

        {err && <Card><CardContent className="p-3 text-sm text-destructive">{err}</CardContent></Card>}
        {!census && !err && <Card><CardContent className="p-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Taking the first census…</CardContent></Card>}

        {census && <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ["Total records", fmt(census.total_rows), "Database estimate, all tables added together"],
              ["Tables", fmt(census.table_count), `${fmt(census.empty_tables)} are empty leftovers`],
              ["Main flight table", flight?.main_rows ? fmt(flight.main_rows) : "—", "The one table every report should count flights from"],
              ["Size", `${(census.total_bytes / 1e9).toFixed(1)} GB`, `Census ${new Date(census.taken_at).toLocaleString()}`],
            ].map(([l, v, s]) => (
              <Card key={l}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-bold">{v}</div><div className="text-xs text-muted-foreground">{s}</div></CardContent></Card>
            ))}
          </div>

          <Card>
            <CardContent className="p-3 text-xs flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-primary" />
              <span>Census fingerprint <code className="font-mono">{census.sha256_hash}</code> — cite as "{fmt(census.total_rows)} records across {fmt(census.table_count)} tables as of {new Date(census.taken_at).toLocaleDateString()}".</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">By type of data</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              <p className="text-xs text-muted-foreground mb-2">Adding every table together double-counts — the same flight sits in several copies. Use the <b>main source</b> number for filings.</p>
              {cats.map(([name, c]) => (
                <button key={name} onClick={() => setCat(cat === name ? null : name)}
                  className={`w-full grid grid-cols-12 gap-2 items-center text-left text-sm rounded p-2 hover:bg-muted/40 ${cat === name ? "bg-muted/60" : ""}`}>
                  <span className="col-span-3 font-medium">{name}</span>
                  <span className="col-span-2 text-muted-foreground">{c.tables} tables ({c.empty} empty)</span>
                  <span className="col-span-2">{fmt(c.rows)} rows</span>
                  <span className="col-span-2 text-xs">{c.main ? <>Main: <b>{c.main_rows != null ? fmt(c.main_rows) : "?"}</b></> : <span className="text-muted-foreground">No main source set</span>}</span>
                  <span className="col-span-2 text-xs text-muted-foreground">{day(sane(c.first))} – {day(sane(c.last))}</span>
                  <span className="col-span-1 text-xs">{["A", "B", "C", "D", "F"].map((g) => c.grades[g] ? `${g}${c.grades[g]} ` : "").join("")}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Tables {cat && <Badge variant="outline" className="ml-2">{cat}</Badge>} <span className="text-xs text-muted-foreground font-normal">({shown.length})</span></CardTitle>
              <div className="flex gap-2 items-center">
                <Button size="sm" variant="ghost" onClick={() => setHideEmpty(!hideEmpty)}>{hideEmpty ? "Show empty" : "Hide empty"}</Button>
                <Input placeholder="Search tables…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-48" />
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[520px]">
                <div className="space-y-1">
                  {shown.slice(0, 600).map((t) => (
                    <div key={`${t.schema}.${t.table}`} className="grid grid-cols-12 gap-2 text-xs p-2 rounded hover:bg-muted/30 items-center">
                      <span className="col-span-4 font-mono truncate" title={`${t.schema}.${t.table}`}>{t.schema !== "public" && <span className="text-muted-foreground">{t.schema}.</span>}{t.table}</span>
                      <span className="col-span-1"><Badge variant={gradeVariant(t.grade)}>{t.grade}</Badge></span>
                      <span className="col-span-2 text-right">{fmt(t.rows)}</span>
                      <span className="col-span-2"><Badge variant={t.role === "main" ? "default" : "outline"}>{ROLE[t.role]}</Badge></span>
                      <span className="col-span-1 text-muted-foreground">{day(sane(t.last_seen))}</span>
                      <span className="col-span-2 text-muted-foreground truncate" title={t.issues.join("; ")}>{t.issues.join("; ") || "Clean"}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {history.length > 1 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Past censuses</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-xs">
                {history.map((h) => (
                  <div key={h.sha256_hash} className="flex gap-4"><span>{new Date(h.taken_at).toLocaleString()}</span><span>{fmt(Number(h.total_rows))} records</span><span>{h.table_count} tables</span><code className="text-muted-foreground">{h.sha256_hash.slice(0, 16)}…</code></div>
                ))}
              </CardContent>
            </Card>
          )}
        </>}
      </div>
    </DashboardLayout>
  );
}
