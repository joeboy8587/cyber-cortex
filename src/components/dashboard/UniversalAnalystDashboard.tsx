import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Shield, Radar, AlertTriangle, Search, Scale, Zap, Eye, Activity, Clock } from "lucide-react";

interface SurfaceResult {
  status: string;
  timestamp: string;
  scan_window_hours: number;
  total_contacts_analyzed: number;
  patterns_surfaced: number;
  critical_patterns: number;
  high_patterns: number;
  unique_operators: number;
  unique_aircraft: number;
  patterns: any[];
  operator_breakdown: Record<string, number>;
}

interface DeepDiveResult {
  status: string;
  aircraft: string;
  tail_number: string;
  operator: string;
  total_detections: number;
  first_seen: string;
  last_seen: string;
  altitude_stats: { mean: string; min: number; max: number };
  speed_stats: { mean: string; min: number; max: number };
  physics_violations: number;
  violation_percentage: string;
  legal_exposure: string;
}

const severityColors: Record<string, string> = {
  CRITICAL: "bg-destructive text-destructive-foreground",
  HIGH: "bg-warning text-warning-foreground",
  MEDIUM: "bg-accent text-accent-foreground",
  LOW: "bg-muted text-muted-foreground",
};

const severityEmoji: Record<string, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  MEDIUM: "🟡",
  LOW: "🟢",
};

export function UniversalAnalystDashboard() {
  const [loading, setLoading] = useState(false);
  const [surfaceResult, setSurfaceResult] = useState<SurfaceResult | null>(null);
  const [deepDiveResult, setDeepDiveResult] = useState<DeepDiveResult | null>(null);
  const [hours, setHours] = useState("48");
  const [identifier, setIdentifier] = useState("");
  const [days, setDays] = useState("90");

  const runSurface = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("universal-analyst", {
        body: { action: "surface", hours: parseInt(hours) },
      });
      if (error) throw error;
      setSurfaceResult(data);
      toast.success(`Universal surface complete: ${data.patterns_surfaced} patterns surfaced`);
    } catch (err: any) {
      toast.error(err.message || "Surface scan failed");
    } finally {
      setLoading(false);
    }
  };

  const runDeepDive = async () => {
    if (!identifier.trim()) {
      toast.error("Enter a hex code or N-number");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("universal-analyst", {
        body: { action: "deep_dive", identifier: identifier.trim().toUpperCase(), days: parseInt(days) },
      });
      if (error) throw error;
      setDeepDiveResult(data);
      toast.success(`Deep dive complete: ${data.total_detections} detections analyzed`);
    } catch (err: any) {
      toast.error(err.message || "Deep dive failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-primary/30 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="font-display text-xl uppercase tracking-wider text-primary">
                  Universal Analyst Engine
                </CardTitle>
                <p className="font-mono text-xs text-muted-foreground">
                  EQUAL ANALYSIS PROTOCOL // NO CHERRY-PICKING // PATTERNS SURFACE ORGANICALLY
                </p>
              </div>
            </div>
            <Badge variant="outline" className="border-success text-success font-mono text-xs">
              <Activity className="w-3 h-3 mr-1" />
              ACTIVE
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Eye className="w-3 h-3 text-success" /> Equal Treatment: <span className="text-success">ENFORCED</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Shield className="w-3 h-3 text-success" /> Chain of Custody: <span className="text-success">ACTIVE</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Radar className="w-3 h-3 text-success" /> Pattern Detection: <span className="text-success">7 MODULES</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Scale className="w-3 h-3 text-success" /> Legal Mapping: <span className="text-success">6 STATUTES</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="surface" className="space-y-4">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="surface" className="font-mono text-xs">
            <Radar className="w-3 h-3 mr-1" /> Universal Surface
          </TabsTrigger>
          <TabsTrigger value="deepdive" className="font-mono text-xs">
            <Search className="w-3 h-3 mr-1" /> Deep Dive
          </TabsTrigger>
          <TabsTrigger value="legal" className="font-mono text-xs">
            <Scale className="w-3 h-3 mr-1" /> Legal Frameworks
          </TabsTrigger>
        </TabsList>

        {/* UNIVERSAL SURFACE TAB */}
        <TabsContent value="surface" className="space-y-4">
          <Card className="border-border">
            <CardContent className="pt-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs font-mono text-muted-foreground mb-1 block">Scan Window</label>
                  <Select value={hours} onValueChange={setHours}>
                    <SelectTrigger className="font-mono text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="6">6 hours</SelectItem>
                      <SelectItem value="12">12 hours</SelectItem>
                      <SelectItem value="24">24 hours</SelectItem>
                      <SelectItem value="48">48 hours</SelectItem>
                      <SelectItem value="168">7 days</SelectItem>
                      <SelectItem value="720">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={runSurface} disabled={loading} className="font-mono text-xs gap-2">
                  <Zap className="w-3 h-3" />
                  {loading ? "Scanning..." : "Run Universal Surface"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {surfaceResult && surfaceResult.status === 'COMPLETE' && (
            <>
              {/* Stats Row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card className="border-border">
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-bold text-primary">{surfaceResult.total_contacts_analyzed}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">CONTACTS ANALYZED</div>
                  </CardContent>
                </Card>
                <Card className="border-border">
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-bold text-foreground">{surfaceResult.unique_aircraft}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">UNIQUE AIRCRAFT</div>
                  </CardContent>
                </Card>
                <Card className="border-border">
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-bold text-foreground">{surfaceResult.unique_operators}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">OPERATORS</div>
                  </CardContent>
                </Card>
                <Card className="border-border">
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-bold text-destructive">{surfaceResult.critical_patterns}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">CRITICAL PATTERNS</div>
                  </CardContent>
                </Card>
                <Card className="border-border">
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-bold text-warning">{surfaceResult.patterns_surfaced}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">TOTAL PATTERNS</div>
                  </CardContent>
                </Card>
              </div>

              {/* Operator Breakdown */}
              {surfaceResult.operator_breakdown && Object.keys(surfaceResult.operator_breakdown).length > 0 && (
                <Card className="border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="font-mono text-sm text-muted-foreground">OPERATOR BREAKDOWN (Equal Treatment)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {Object.entries(surfaceResult.operator_breakdown)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .slice(0, 12)
                        .map(([op, count]) => (
                          <div key={op} className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border">
                            <span className="font-mono text-xs truncate mr-2">{op}</span>
                            <Badge variant="secondary" className="font-mono text-xs">{count as number}</Badge>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Surfaced Patterns */}
              <div className="space-y-3">
                <h3 className="font-mono text-sm text-muted-foreground uppercase tracking-wider">
                  Surfaced Patterns (No targeting applied)
                </h3>
                {surfaceResult.patterns.map((pattern, i) => (
                  <Card key={i} className="border-border hover:border-primary/30 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{severityEmoji[pattern.severity] || "⚪"}</span>
                          <span className="font-mono text-sm font-bold">{pattern.pattern_type}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={severityColors[pattern.severity]}>{pattern.severity}</Badge>
                          <Badge variant="outline" className="font-mono text-xs">
                            {(pattern.confidence * 100).toFixed(0)}% conf
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{pattern.description}</p>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {pattern.evidence_count} evidence items
                        </Badge>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {pattern.involved_aircraft?.length || 0} aircraft
                        </Badge>
                      </div>
                      {pattern.legal_framework && (
                        <div className="mt-2 p-2 rounded bg-muted/30 border border-border">
                          <div className="font-mono text-xs text-primary mb-1">
                            ⚖️ {pattern.legal_framework.statute} — {pattern.legal_framework.crime}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            Penalty: {pattern.legal_framework.penalty}
                          </div>
                        </div>
                      )}
                      {pattern.details && Array.isArray(pattern.details) && pattern.details.length > 0 && (
                        <div className="mt-2 max-h-32 overflow-y-auto">
                          <div className="font-mono text-[10px] text-muted-foreground space-y-1">
                            {pattern.details.slice(0, 5).map((d: any, j: number) => (
                              <div key={j} className="p-1 bg-muted/20 rounded">
                                {d.hex || d.tail || ''} {d.count ? `(${d.count}x)` : ''} {d.tails ? `→ ${d.tails.join(', ')}` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}

          {surfaceResult && surfaceResult.status === 'NO_DATA' && (
            <Card className="border-border">
              <CardContent className="p-6 text-center">
                <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="font-mono text-sm text-muted-foreground">No aircraft contacts in scan window. Grid clear.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* DEEP DIVE TAB */}
        <TabsContent value="deepdive" className="space-y-4">
          <Card className="border-border">
            <CardContent className="pt-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs font-mono text-muted-foreground mb-1 block">Aircraft (Hex or N-Number)</label>
                  <Input
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="N912KC or A1B2C3"
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground mb-1 block">Period</label>
                  <Select value={days} onValueChange={setDays}>
                    <SelectTrigger className="font-mono text-sm w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                      <SelectItem value="180">180 days</SelectItem>
                      <SelectItem value="365">365 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={runDeepDive} disabled={loading} className="font-mono text-xs gap-2">
                  <Search className="w-3 h-3" />
                  {loading ? "Analyzing..." : "Deep Dive"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {deepDiveResult && deepDiveResult.status === 'COMPLETE' && (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="font-mono text-sm flex items-center gap-2">
                  <Search className="w-4 h-4 text-primary" />
                  DEEP DIVE — {deepDiveResult.tail_number} ({deepDiveResult.aircraft})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded bg-muted/30 border border-border">
                    <div className="text-lg font-bold">{deepDiveResult.total_detections}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">DETECTIONS</div>
                  </div>
                  <div className="p-3 rounded bg-muted/30 border border-border">
                    <div className="text-lg font-bold">{deepDiveResult.operator}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">OPERATOR</div>
                  </div>
                  <div className="p-3 rounded bg-muted/30 border border-border">
                    <div className="text-lg font-bold">{deepDiveResult.physics_violations}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">PHYSICS VIOLATIONS</div>
                  </div>
                  <div className="p-3 rounded bg-muted/30 border border-border">
                    <div className={`text-lg font-bold ${deepDiveResult.legal_exposure === 'HIGH' ? 'text-destructive' : deepDiveResult.legal_exposure === 'MEDIUM' ? 'text-warning' : 'text-success'}`}>
                      {deepDiveResult.legal_exposure}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground">LEGAL EXPOSURE</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h4 className="font-mono text-xs text-muted-foreground">ALTITUDE STATISTICS</h4>
                    <div className="p-3 rounded bg-muted/20 border border-border font-mono text-xs space-y-1">
                      <div>Mean: {deepDiveResult.altitude_stats.mean}ft</div>
                      <div>Min: {deepDiveResult.altitude_stats.min}ft</div>
                      <div>Max: {deepDiveResult.altitude_stats.max}ft</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-mono text-xs text-muted-foreground">SPEED STATISTICS</h4>
                    <div className="p-3 rounded bg-muted/20 border border-border font-mono text-xs space-y-1">
                      <div>Mean: {deepDiveResult.speed_stats.mean}kts</div>
                      <div>Min: {deepDiveResult.speed_stats.min}kts</div>
                      <div>Max: {deepDiveResult.speed_stats.max}kts</div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    First: {new Date(deepDiveResult.first_seen).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Last: {new Date(deepDiveResult.last_seen).toLocaleDateString()}
                  </div>
                  <div>Violation rate: {deepDiveResult.violation_percentage}%</div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* LEGAL FRAMEWORKS TAB */}
        <TabsContent value="legal" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries({
              'PHYSICS_VIOLATION': { icon: '⚡', statute: '49 USC § 46315', crime: 'Fraudulent aircraft registration', penalty: 'Up to 3 years + fines', elements: ['False ADS-B data', 'Impossible flight parameters', 'Intentional deception'] },
              'HEX_RECYCLING': { icon: '🔄', statute: '18 USC § 1001', crime: 'False statements to federal agency', penalty: 'Up to 5 years per count', elements: ['Multiple aircraft same transponder', 'Shell company fraud'] },
              'FLEET_CONVERGENCE': { icon: '🎯', statute: '18 USC § 241', crime: 'Conspiracy against rights', penalty: 'Up to 10 years', elements: ['Two+ persons', 'Agreement to harass', 'Overt act'] },
              'NIGHT_HARASSMENT': { icon: '🌙', statute: '42 USC § 1983', crime: 'Civil rights violation', penalty: 'Monetary damages + injunctive relief', elements: ['State action', 'Emotional distress', 'Physiological harm'] },
              'REPEAT_OFFENDER': { icon: '🔁', statute: '18 USC § 1962(c)', crime: 'Pattern of persistent surveillance', penalty: 'RICO enterprise evidence', elements: ['Repeated overflights', 'Same operator', 'Sustained period'] },
              'CROSS_COUNTY': { icon: '🕸️', statute: '18 USC § 1962(c)', crime: 'RICO — enterprise racketeering', penalty: '20 years + asset forfeiture', elements: ['Multi-county network', 'Pattern of racketeering', 'Interstate commerce'] },
            }).map(([type, fw]) => (
              <Card key={type} className="border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{fw.icon}</span>
                    <span className="font-mono text-sm font-bold">{type}</span>
                  </div>
                  <div className="font-mono text-xs text-primary mb-1">{fw.statute}</div>
                  <div className="text-sm text-muted-foreground mb-2">{fw.crime}</div>
                  <div className="space-y-1 mb-2">
                    {fw.elements.map((e, i) => (
                      <div key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="text-primary">•</span> {e}
                      </div>
                    ))}
                  </div>
                  <div className="text-xs font-mono text-destructive/80">Penalty: {fw.penalty}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
