import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";
import { AlertTriangle, Shield, Radar, RefreshCw, Search, Skull } from "lucide-react";

interface HexSharing {
  hex_code: string;
  registration_count: number;
  registrations: string[];
  total_detections: number;
  min_altitude: number | null;
  avg_altitude: number | null;
  first_seen: string;
  last_seen: string;
  ground_proximity: number;
  negative_altitude: number;
  active_days: number;
}

interface ShellAsset {
  registration: string;
  icao_code: string;
  taxonomy_tag: string;
  detections: number;
  avg_alt: number | null;
  min_alt: number | null;
  low_ops: number;
  first_seen: string;
  last_seen: string;
  avg_speed: number | null;
}

interface KcsoTagged {
  registration: string;
  icao_code: string;
  taxonomy_tag: string;
  detections: number;
  low_altitude: number;
  avg_alt: number | null;
  avg_speed: number | null;
  first_seen: string;
  last_seen: string;
}

interface MilitaryDualHex {
  military_hex: string;
  civilian_reg: string;
  civilian_hex: string | null;
  detections: number;
  min_alt: number | null;
  max_alt: number | null;
  avg_alt: number | null;
  negative_alt_count: number;
  ground_prox: number;
  first_seen: string;
  last_seen: string;
}

interface ScanResult {
  hexSharing: HexSharing[];
  shellFleet: ShellAsset[];
  kcsoTagged: KcsoTagged[];
  militaryDualHex: MilitaryDualHex[];
  summary: {
    totalRecycledHexes: number;
    totalShellAssets: number;
    totalKcsoTagged: number;
    totalMilitarySpoofs: number;
    highestRecycleCount: number;
  };
  analyzedAt: string;
}

export default function ICAORecyclingDashboard() {
  const { queryDatabase, isLoading } = useNeonDatabase();
  const [data, setData] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setError(null);
    try {
      const result = await queryDatabase("icaoRecyclingScan", { timeWindow: "180 days" });
      setData(result);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { runScan(); }, []);

  const severityBadge = (count: number) => {
    if (count >= 5) return <Badge variant="destructive">CRITICAL</Badge>;
    if (count >= 3) return <Badge className="bg-orange-600">HIGH</Badge>;
    if (count >= 2) return <Badge className="bg-yellow-600">MEDIUM</Badge>;
    return <Badge variant="secondary">LOW</Badge>;
  };

  return (
    <div className="space-y-6">
      <CyberPanel
        title="ICAO Recycling & Shell Asset Discovery"
        icon={<Radar className="h-5 w-5" />}
        variant="threat"
        headerActions={
          <Button size="sm" variant="outline" onClick={runScan} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            Scan
          </Button>
        }
      >
        {error && (
          <div className="p-4 text-sm text-destructive bg-destructive/10 rounded">{error}</div>
        )}

        {data && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
              <SummaryCard label="Recycled Hex Codes" value={data.summary.totalRecycledHexes} icon="🔄" critical={data.summary.totalRecycledHexes > 10} />
              <SummaryCard label="Shell Assets" value={data.summary.totalShellAssets} icon="🏢" critical={data.summary.totalShellAssets > 15} />
              <SummaryCard label="KCSO Tagged" value={data.summary.totalKcsoTagged} icon="🎯" critical={data.summary.totalKcsoTagged > 5} />
              <SummaryCard label="Military Spoofs" value={data.summary.totalMilitarySpoofs} icon="⚠️" critical={data.summary.totalMilitarySpoofs > 0} />
              <SummaryCard label="Max Recycling" value={`${data.summary.highestRecycleCount}x`} icon="🔁" critical={data.summary.highestRecycleCount > 5} />
            </div>

            <Tabs defaultValue="military" className="p-4 pt-0">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="military">
                  <Skull className="h-3 w-3 mr-1" /> Military Spoofing ({data.militaryDualHex.length})
                </TabsTrigger>
                <TabsTrigger value="hex">
                  <Search className="h-3 w-3 mr-1" /> Hex Recycling ({data.hexSharing.length})
                </TabsTrigger>
                <TabsTrigger value="shell">
                  <Shield className="h-3 w-3 mr-1" /> Shell Fleet ({data.shellFleet.length})
                </TabsTrigger>
                <TabsTrigger value="kcso">
                  <AlertTriangle className="h-3 w-3 mr-1" /> KCSO Assets ({data.kcsoTagged.length})
                </TabsTrigger>
              </TabsList>

              {/* MILITARY DUAL-HEX TAB */}
              <TabsContent value="military">
                <CyberPanel title="🚨 MILITARY HEX SPOOFING — DUAL IDENTITY DETECTION" variant="threat">
                  <div className="p-4 text-xs text-muted-foreground mb-2">
                    Military ICAO hex codes (AE/AF prefix) broadcasting civilian N-numbers. Each row = confirmed identity fraud under 18 U.S.C. § 1001.
                  </div>
                  <div className="overflow-auto max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Military Hex</TableHead>
                          <TableHead>Fake Civilian ID</TableHead>
                          <TableHead>Civilian Hex</TableHead>
                          <TableHead>Detections</TableHead>
                          <TableHead>Alt Range</TableHead>
                          <TableHead>Neg Alt</TableHead>
                          <TableHead>Ground Prox</TableHead>
                          <TableHead>Period</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.militaryDualHex.length === 0 ? (
                          <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No military dual-hex spoofing detected</TableCell></TableRow>
                        ) : data.militaryDualHex.map((row, i) => (
                          <TableRow key={i} className={row.negative_alt_count > 0 ? "bg-destructive/10" : ""}>
                            <TableCell className="font-mono font-bold text-destructive">{row.military_hex}</TableCell>
                            <TableCell className="font-mono text-warning">{row.civilian_reg}</TableCell>
                            <TableCell className="font-mono text-xs">{row.civilian_hex || "—"}</TableCell>
                            <TableCell>{row.detections}</TableCell>
                            <TableCell className="text-xs">
                              {row.min_alt != null ? `${row.min_alt}` : "?"} – {row.max_alt != null ? `${row.max_alt}ft` : "?"}
                              {(row.min_alt ?? 0) < 0 && <span className="ml-1 text-destructive font-bold">⚠️ IMPOSSIBLE</span>}
                            </TableCell>
                            <TableCell>
                              {row.negative_alt_count > 0
                                ? <Badge variant="destructive">{row.negative_alt_count}</Badge>
                                : "0"}
                            </TableCell>
                            <TableCell>
                              {row.ground_prox > 0
                                ? <Badge className="bg-orange-600">{row.ground_prox}</Badge>
                                : "0"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(row.first_seen).toLocaleDateString()} – {new Date(row.last_seen).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {data.militaryDualHex.length > 0 && (
                    <div className="p-4 border-t border-border/50 space-y-2">
                      <h4 className="text-sm font-bold text-destructive">⚖️ LEGAL IMPLICATIONS</h4>
                      <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                        <li><strong>18 U.S.C. § 1001</strong> — False statements to FAA (ADS-B identity spoofing)</li>
                        <li><strong>49 U.S.C. § 46315</strong> — Aviation fraud (transponder manipulation)</li>
                        <li><strong>Posse Comitatus Act (18 U.S.C. § 1385)</strong> — Military conducting domestic law enforcement</li>
                        <li><strong>Consciousness of guilt:</strong> Negative altitudes ({data.militaryDualHex.reduce((s, r) => s + r.negative_alt_count, 0)} events) prove data fabrication</li>
                      </ul>
                    </div>
                  )}
                </CyberPanel>
              </TabsContent>

              {/* HEX RECYCLING TAB */}
              <TabsContent value="hex">
                <div className="overflow-auto max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ICAO Hex</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead># Registrations</TableHead>
                        <TableHead>Registrations</TableHead>
                        <TableHead>Detections</TableHead>
                        <TableHead>Min Alt</TableHead>
                        <TableHead>Neg Alt</TableHead>
                        <TableHead>Active Days</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.hexSharing.map((row, i) => (
                        <TableRow key={i} className={row.negative_altitude > 0 ? "bg-destructive/10" : row.registration_count >= 5 ? "bg-orange-900/10" : ""}>
                          <TableCell className="font-mono font-bold">{row.hex_code}</TableCell>
                          <TableCell>{severityBadge(row.registration_count)}</TableCell>
                          <TableCell className="font-bold text-lg">{row.registration_count}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(row.registrations || []).slice(0, 8).map((r, j) => (
                                <Badge key={j} variant="outline" className="font-mono text-xs">{r}</Badge>
                              ))}
                              {(row.registrations || []).length > 8 && (
                                <Badge variant="secondary">+{row.registrations.length - 8}</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{row.total_detections.toLocaleString()}</TableCell>
                          <TableCell className={row.min_altitude != null && row.min_altitude < 500 ? "text-destructive font-bold" : ""}>
                            {row.min_altitude != null ? `${row.min_altitude}ft` : "—"}
                          </TableCell>
                          <TableCell>
                            {row.negative_altitude > 0
                              ? <Badge variant="destructive">{row.negative_altitude} ⚠️</Badge>
                              : "0"}
                          </TableCell>
                          <TableCell>{row.active_days}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              {/* SHELL FLEET TAB */}
              <TabsContent value="shell">
                <div className="overflow-auto max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Registration</TableHead>
                        <TableHead>ICAO</TableHead>
                        <TableHead>Taxonomy</TableHead>
                        <TableHead>Detections</TableHead>
                        <TableHead>Low Ops</TableHead>
                        <TableHead>Avg Alt</TableHead>
                        <TableHead>Avg Speed</TableHead>
                        <TableHead>Period</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.shellFleet.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono font-bold">{row.registration}</TableCell>
                          <TableCell className="font-mono text-xs">{row.icao_code || "—"}</TableCell>
                          <TableCell>
                            <Badge variant={row.taxonomy_tag?.includes("kcso") ? "destructive" : "secondary"} className="text-xs">
                              {row.taxonomy_tag || "untagged"}
                            </Badge>
                          </TableCell>
                          <TableCell>{row.detections.toLocaleString()}</TableCell>
                          <TableCell className={row.low_ops > 10 ? "text-destructive font-bold" : ""}>
                            {row.low_ops}
                          </TableCell>
                          <TableCell>{row.avg_alt ?? "—"}ft</TableCell>
                          <TableCell>{row.avg_speed ?? "—"}kts</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(row.first_seen).toLocaleDateString()} – {new Date(row.last_seen).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              {/* KCSO TAGGED TAB */}
              <TabsContent value="kcso">
                <CyberPanel title="KCSO OPERATIONAL CONTROL — TAGGED ASSETS" variant="warning">
                  <div className="p-4 text-xs text-muted-foreground mb-2">
                    Aircraft tagged with KCSO taxonomy in the detection database. Proves operational control beyond "coordination."
                  </div>
                  <div className="overflow-auto max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Registration</TableHead>
                          <TableHead>ICAO</TableHead>
                          <TableHead>Tag</TableHead>
                          <TableHead>Detections</TableHead>
                          <TableHead>Low Alt Ops</TableHead>
                          <TableHead>Avg Alt</TableHead>
                          <TableHead>Avg Speed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.kcsoTagged.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono font-bold text-destructive">{row.registration}</TableCell>
                            <TableCell className="font-mono text-xs">{row.icao_code || "—"}</TableCell>
                            <TableCell><Badge variant="destructive" className="text-xs">{row.taxonomy_tag}</Badge></TableCell>
                            <TableCell>{row.detections.toLocaleString()}</TableCell>
                            <TableCell className="font-bold">{row.low_altitude}</TableCell>
                            <TableCell>{row.avg_alt ?? "—"}ft</TableCell>
                            <TableCell>{row.avg_speed ?? "—"}kts</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CyberPanel>
              </TabsContent>
            </Tabs>
          </>
        )}

        {!data && !error && isLoading && (
          <div className="p-8 text-center text-muted-foreground">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
            Scanning ICAO recycling patterns and shell assets...
          </div>
        )}
      </CyberPanel>
    </div>
  );
}

function SummaryCard({ label, value, icon, critical }: { label: string; value: string | number; icon: string; critical: boolean }) {
  return (
    <div className={`rounded-lg border p-3 text-center ${critical ? "border-destructive/50 bg-destructive/5" : "border-border/50 bg-background/40"}`}>
      <div className="text-xl mb-1">{icon}</div>
      <div className={`text-2xl font-bold ${critical ? "text-destructive" : "text-foreground"}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
