import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";
import { Activity, AlertTriangle, Crosshair, Ghost, CalendarRange, Loader2, Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const KNOWN_FLEET = [
  'N912KC','N913KC','N916HT','N916GW','N916BQ','N916FT','N916NT',
  'N791FA','N790FA','N788FA','N786FA','N789FA','N787FA',
  'N229AM','N743AM','N63177','N7670F','N4334J','N73103',
  'N997SE','N9157A','N74FF','N71FF','N72FF','N854ND',
];
const FLEET_2026 = ['N912KC','N913KC','N791FA','N790FA','N788FA','N916GW','N916HT','N229AM','N63177','N4334J'];

const list = (arr: string[]) => arr.map(r => `'${r}'`).join(',');

const QUERIES: Record<string, { label: string; sql: string; icon: any; description: string }> = {
  ext1: {
    label: "1 · Known Fleet History",
    icon: Activity,
    description: "Aggregate detection counts, threat scores, and date ranges for all 25 known network aircraft.",
    sql: `SELECT registration, COUNT(*)::int AS detections, MIN(detection_timestamp)::date AS first_seen, MAX(detection_timestamp)::date AS last_seen, ROUND(AVG(threat_score)::numeric,1) AS avg_threat, MAX(threat_score) AS max_threat, SUM(CASE WHEN flagged THEN 1 ELSE 0 END)::int AS flagged FROM live_flight_detections_rows WHERE registration IN (${list(KNOWN_FLEET)}) GROUP BY registration ORDER BY detections DESC`,
  },
  ext2: {
    label: "2 · Threat ≥ 55",
    icon: AlertTriangle,
    description: "Top 200 highest-scoring detections across the entire 4M+ row archive.",
    sql: `SELECT icao_code, registration, altitude, speed, threat_score, flagged, flagged_reasons, detection_timestamp FROM live_flight_detections_rows WHERE threat_score >= 55 ORDER BY threat_score DESC, detection_timestamp DESC LIMIT 200`,
  },
  ext3: {
    label: "3 · Target Box (35.38–35.46, −119.07–−118.97)",
    icon: Crosshair,
    description: "Every aircraft that flew through the residence airspace box. Top 500 most recent.",
    sql: `SELECT icao_code, registration, altitude, speed, threat_score, flagged, detection_timestamp FROM live_flight_detections_rows WHERE latitude BETWEEN 35.38 AND 35.46 AND longitude BETWEEN -119.07 AND -118.97 ORDER BY detection_timestamp DESC LIMIT 500`,
  },
  ext4: {
    label: "4 · Ghosts & Unregistered",
    icon: Ghost,
    description: "Aggregated by icao_code where registration is missing/ghost/unknown.",
    sql: `SELECT icao_code, COUNT(*)::int AS detections, MAX(detection_timestamp) AS last_seen, ROUND(AVG(threat_score)::numeric,1) AS avg_threat FROM live_flight_detections_rows WHERE registration IS NULL OR registration = '' OR LOWER(registration) LIKE '%ghost%' OR LOWER(registration) LIKE '%unknown%' OR icao_code LIKE '~%' GROUP BY icao_code ORDER BY detections DESC LIMIT 100`,
  },
  ext5: {
    label: "5 · 2026 Active Network",
    icon: CalendarRange,
    description: "Confirms whether the surveillance fleet is still operating in 2026.",
    sql: `SELECT registration, COUNT(*)::int AS detections, MIN(detection_timestamp) AS first_2026, MAX(detection_timestamp) AS last_seen, ROUND(AVG(threat_score)::numeric,1) AS avg_threat, SUM(CASE WHEN flagged THEN 1 ELSE 0 END)::int AS flagged FROM live_flight_detections_rows WHERE detection_timestamp >= '2026-01-01' AND registration IN (${list(FLEET_2026)}) GROUP BY registration ORDER BY detections DESC`,
  },
};

function downloadCSV(rows: any[], name: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${name}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export function NetworkExtractsPanel() {
  const { customQuery } = useNeonDatabase();
  const [active, setActive] = useState("ext5");
  const [data, setData] = useState<Record<string, any[] | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const run = async (key: string) => {
    setLoading(p => ({ ...p, [key]: true }));
    try {
      const result = await customQuery(QUERIES[key].sql);
      const rows = Array.isArray(result) ? result : [];
      setData(p => ({ ...p, [key]: rows }));
      toast({ title: `${QUERIES[key].label}`, description: `${rows.length} rows returned` });
    } catch (e: any) {
      toast({ title: "Query failed", description: e?.message || "error", variant: "destructive" });
    } finally {
      setLoading(p => ({ ...p, [key]: false }));
    }
  };

  const threatBadge = (n: any) => {
    const v = Number(n) || 0;
    if (v >= 80) return <Badge variant="destructive">{v}</Badge>;
    if (v >= 55) return <Badge className="bg-warning text-warning-foreground">{v}</Badge>;
    return <Badge variant="secondary">{v}</Badge>;
  };

  return (
    <CyberPanel
      title="Network Surveillance Extracts"
      icon={<Activity className="h-4 w-4" />}
      variant="threat"
    >
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Five forensic extracts against <code className="text-primary">live_flight_detections_rows</code> (4M+ rows). Each runs server-side and returns aggregates or capped row sets.
        </p>
        <Tabs value={active} onValueChange={setActive}>
          <TabsList className="grid grid-cols-5 w-full">
            {Object.entries(QUERIES).map(([k, q]) => {
              const Icon = q.icon;
              return (
                <TabsTrigger key={k} value={k} className="text-xs">
                  <Icon className="h-3 w-3 mr-1" />
                  {q.label.split(" · ")[0]}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {Object.entries(QUERIES).map(([k, q]) => {
            const rows = data[k];
            return (
              <TabsContent key={k} value={k} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-display uppercase tracking-wider text-primary">{q.label}</div>
                    <div className="text-xs text-muted-foreground mt-1">{q.description}</div>
                  </div>
                  <div className="flex gap-2">
                    {rows && rows.length > 0 && (
                      <Button size="sm" variant="outline" onClick={() => downloadCSV(rows, `extract_${k}_${new Date().toISOString().slice(0,10)}`)}>
                        <Download className="h-3 w-3 mr-1" />CSV
                      </Button>
                    )}
                    <Button size="sm" onClick={() => run(k)} disabled={loading[k]}>
                      {loading[k] ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                      {rows ? "Re-run" : "Run extract"}
                    </Button>
                  </div>
                </div>
                {rows && (
                  <div className="border border-border rounded max-h-[420px] overflow-auto">
                    {rows.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">No rows.</div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(rows[0]).map(c => (
                              <TableHead key={c} className="text-xs uppercase">{c}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((r, i) => (
                            <TableRow key={i}>
                              {Object.entries(r).map(([c, v]) => (
                                <TableCell key={c} className="text-xs font-mono">
                                  {(c === 'threat_score' || c === 'avg_threat' || c === 'max_threat') ? threatBadge(v)
                                   : v === null || v === undefined ? <span className="text-muted-foreground">—</span>
                                   : String(v)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
                {rows && (
                  <div className="text-xs text-muted-foreground">{rows.length} rows</div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </CyberPanel>
  );
}
