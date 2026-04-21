import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";
import { Loader2, Search, Database, Eye, EyeOff, Stethoscope } from "lucide-react";
import { toast } from "sonner";

interface EnrichedRow {
  reg: string;
  hex: string;
  detections_window: number;
  flagged_window: number;
  avg_alt_window: number | null;
  min_alt_window: number | null;
  threat_tier: number;
  shell_company_flag: boolean;
  hist_total: number;
  hist_flagged: number;
  operator_inferred: string | null;
  aircraft_type: string | null;
}

interface DarkRow {
  hex: string;
  reg: string;
  priv_pings: number;
  flagged_pings: number;
  pub_pings: number;
  min_alt: number | null;
  threat_tier: number;
  shell_company_flag: boolean;
  operator_inferred: string | null;
  dark_status: string;
}

interface ProfileResult {
  registry?: any;
  detections?: any;
  public_presence?: any;
  unmasking?: any;
  dark_ops_indicator?: string;
  error?: string;
}

const tierColor = (t: number) => {
  if (t === 1) return "destructive";
  if (t === 2) return "default";
  if (t === 3) return "secondary";
  return "outline";
};

const darkColor = (s: string) => {
  if (s === "DARK_OPS") return "destructive";
  if (s === "LIKELY_DARK") return "default";
  if (s === "MOSTLY_DARK") return "secondary";
  return "outline";
};

interface AirMethodsRow {
  registration: string;
  icao24: string | null;
  detection_count: number;
  flagged_count: number;
  min_alt: number | null;
  avg_alt: number | null;
  china_lake_visits: number;
  china_lake_min_alt: number | null;
  owner_name: string | null;
  aircraft_type: string | null;
  tactical_role: string;
  threat_level: string;
}

const roleColor = (r: string) => {
  if (r === "MILITARY_LIAISON") return "destructive";
  if (r === "SURVEILLANCE_LOITER") return "destructive";
  if (r === "STATION_KEEPING") return "default";
  return "outline";
};

const threatColor = (t: string) => {
  if (t === "CRITICAL") return "destructive";
  if (t === "HIGH") return "default";
  return "secondary";
};

export function EnrichedAircraftIntelligencePanel() {
  const { customQuery, isLoading } = useNeonDatabase();
  const [enriched, setEnriched] = useState<EnrichedRow[]>([]);
  const [enrichedSummary, setEnrichedSummary] = useState<any>(null);
  const [dark, setDark] = useState<DarkRow[]>([]);
  const [darkSummary, setDarkSummary] = useState<any>(null);
  const [airMethods, setAirMethods] = useState<AirMethodsRow[]>([]);
  const [airMethodsSummary, setAirMethodsSummary] = useState<any>(null);
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [profileQuery, setProfileQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const callAction = async (action: string, params: Record<string, unknown>) => {
    // Re-use the queryDatabase plumbing through customQuery? No — we need direct action.
    // Use supabase.functions.invoke via a tiny helper.
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.functions.invoke("neon-query", {
      body: { action, ...params },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data?.data ?? data;
  };

  const runEnriched = async () => {
    setBusy("enriched");
    try {
      const res = await callAction("enrichedAircraftIntelligence", {
        days: 90,
        limit: 100,
        minTier: 0,
      });
      setEnriched(res?.aircraft || []);
      setEnrichedSummary(res?.summary || null);
      toast.success(`Loaded ${res?.aircraft?.length || 0} enriched aircraft`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const runDark = async () => {
    setBusy("dark");
    try {
      const res = await callAction("darkOpsComparison", {
        days: 60,
        minDetections: 5,
        limit: 100,
      });
      setDark(res?.aircraft || []);
      setDarkSummary(res?.summary || null);
      toast.success(`Found ${res?.aircraft?.length || 0} dark-ops candidates`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const runProfile = async () => {
    if (!profileQuery.trim()) {
      toast.error("Enter a registration (e.g. N912KC) or hex (e.g. a12345)");
      return;
    }
    setBusy("profile");
    try {
      const isHex = /^[0-9a-fA-F]{6}$/.test(profileQuery.trim());
      const res = await callAction("aircraftMasterProfile", {
        registration: isHex ? "" : profileQuery.trim(),
        hex: isHex ? profileQuery.trim() : "",
      });
      setProfile(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          Enriched Aircraft Intelligence
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Cross-references live detections with the enhanced registry, public ADS-B feed, and unmasking
          intelligence to surface threat tier, shell affiliation, and dark-ops behavior.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="enriched">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="enriched">Enriched Detections</TabsTrigger>
            <TabsTrigger value="dark">
              <EyeOff className="h-4 w-4 mr-1" /> Dark Ops
            </TabsTrigger>
            <TabsTrigger value="profile">
              <Search className="h-4 w-4 mr-1" /> Master Profile
            </TabsTrigger>
          </TabsList>

          <TabsContent value="enriched" className="space-y-4 mt-4">
            <Button onClick={runEnriched} disabled={busy === "enriched" || isLoading}>
              {busy === "enriched" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Scan Enriched Detections (90d)
            </Button>
            {enrichedSummary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <StatBox label="Total" value={enrichedSummary.total} />
                <StatBox label="Shell Cos" value={enrichedSummary.shells} variant="destructive" />
                <StatBox label="Tier 1" value={enrichedSummary.tier1} variant="destructive" />
                <StatBox label="Tier 2" value={enrichedSummary.tier2} variant="default" />
                <StatBox label="Unregistered" value={enrichedSummary.unregistered} variant="secondary" />
              </div>
            )}
            {enriched.length > 0 && (
              <div className="overflow-auto max-h-[500px] border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Reg</th>
                      <th className="p-2 text-left">Tier</th>
                      <th className="p-2 text-left">Shell</th>
                      <th className="p-2 text-left">Operator</th>
                      <th className="p-2 text-right">Recent</th>
                      <th className="p-2 text-right">Flagged</th>
                      <th className="p-2 text-right">Min Alt</th>
                      <th className="p-2 text-right">Hist</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enriched.map((r, i) => (
                      <tr key={i} className="border-t hover:bg-muted/50">
                        <td className="p-2 font-mono">{r.reg || r.hex}</td>
                        <td className="p-2">
                          <Badge variant={tierColor(r.threat_tier) as any}>T{r.threat_tier}</Badge>
                        </td>
                        <td className="p-2">
                          {r.shell_company_flag ? (
                            <Badge variant="destructive">SHELL</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground truncate max-w-[180px]">
                          {r.operator_inferred || r.aircraft_type || "—"}
                        </td>
                        <td className="p-2 text-right">{r.detections_window}</td>
                        <td className="p-2 text-right text-destructive">{r.flagged_window}</td>
                        <td className="p-2 text-right">{r.min_alt_window ?? "—"}</td>
                        <td className="p-2 text-right text-muted-foreground">{r.hist_total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="dark" className="space-y-4 mt-4">
            <Button onClick={runDark} disabled={busy === "dark" || isLoading}>
              {busy === "dark" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Find Dark Ops (private vs public ADS-B)
            </Button>
            {darkSummary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <StatBox label="Total" value={darkSummary.total} />
                <StatBox label="Full Dark" value={darkSummary.full_dark} variant="destructive" />
                <StatBox label="Likely Dark" value={darkSummary.likely_dark} variant="default" />
                <StatBox label="Mostly Dark" value={darkSummary.mostly_dark} variant="secondary" />
                <StatBox label="Shells Dark" value={darkSummary.shells_dark} variant="destructive" />
              </div>
            )}
            {dark.length > 0 && (
              <div className="overflow-auto max-h-[500px] border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Hex / Reg</th>
                      <th className="p-2 text-left">Status</th>
                      <th className="p-2 text-left">Tier</th>
                      <th className="p-2 text-right">Private</th>
                      <th className="p-2 text-right">Public</th>
                      <th className="p-2 text-right">Flagged</th>
                      <th className="p-2 text-right">Min Alt</th>
                      <th className="p-2 text-left">Operator</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dark.map((r, i) => (
                      <tr key={i} className="border-t hover:bg-muted/50">
                        <td className="p-2 font-mono">{r.reg || r.hex}</td>
                        <td className="p-2">
                          <Badge variant={darkColor(r.dark_status) as any}>{r.dark_status}</Badge>
                        </td>
                        <td className="p-2">
                          <Badge variant={tierColor(r.threat_tier) as any}>T{r.threat_tier}</Badge>
                        </td>
                        <td className="p-2 text-right">{r.priv_pings}</td>
                        <td className="p-2 text-right text-muted-foreground">{r.pub_pings}</td>
                        <td className="p-2 text-right text-destructive">{r.flagged_pings}</td>
                        <td className="p-2 text-right">{r.min_alt ?? "—"}</td>
                        <td className="p-2 text-muted-foreground truncate max-w-[180px]">
                          {r.operator_inferred || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="profile" className="space-y-4 mt-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label>Registration or Hex</Label>
                <Input
                  value={profileQuery}
                  onChange={(e) => setProfileQuery(e.target.value)}
                  placeholder="N912KC or a12345"
                  onKeyDown={(e) => e.key === "Enter" && runProfile()}
                />
              </div>
              <Button onClick={runProfile} disabled={busy === "profile"}>
                {busy === "profile" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                Build Profile
              </Button>
            </div>

            {profile && !profile.error && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant={profile.dark_ops_indicator === "DARK_OPS" ? "destructive" : profile.dark_ops_indicator === "LIKELY_DARK" ? "default" : "outline"}>
                    {profile.dark_ops_indicator === "PUBLIC" ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                    {profile.dark_ops_indicator}
                  </Badge>
                </div>
                <ProfileSection title="Registry" data={profile.registry} />
                <ProfileSection title="Recent Detections" data={profile.detections} />
                <ProfileSection title="Public ADS-B" data={profile.public_presence} />
                <ProfileSection title="Unmasking Intel" data={profile.unmasking} />
              </div>
            )}
            {profile?.error && (
              <p className="text-destructive text-sm">{profile.error}</p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value, variant }: { label: string; value: number; variant?: string }) {
  return (
    <div className="border rounded-md p-2 text-center">
      <div className={`text-lg font-bold ${variant === "destructive" ? "text-destructive" : variant === "default" ? "text-primary" : ""}`}>
        {value ?? 0}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ProfileSection({ title, data }: { title: string; data: any }) {
  if (!data) {
    return (
      <div className="border rounded-md p-3">
        <div className="text-sm font-semibold mb-1">{title}</div>
        <div className="text-xs text-muted-foreground">No data</div>
      </div>
    );
  }
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <div className="border rounded-md p-3">
      <div className="text-sm font-semibold mb-2">{title}</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        {entries.map(([k, v]) => (
          <div key={k}>
            <div className="text-muted-foreground">{k}</div>
            <div className="font-mono truncate">{String(v)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
