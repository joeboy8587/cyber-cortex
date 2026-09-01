import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, ShieldAlert, Plane, Building2, Radio } from "lucide-react";
import { AGENCY_FOR, FEDERAL_FRONTS, FRONT_CALLSIGN_REGEX, FRONT_REGEX } from "@/lib/federalFronts";
import { toast } from "sonner";

interface FleetRow {
  tail: string;
  hex: string;
  registrant: string;
  city: string;
  state: string;
  year: string | null;
  model: string | null;
}

interface HitRow {
  hex: string;
  tail: string | null;
  pings: number;
  first_seen: string;
  last_seen: string;
  minalt: number | null;
  maxalt: number | null;
}

interface CallsignRow {
  callsign: string;
  registration: string | null;
  pings: number;
  last_seen: string;
}

const runQuery = async <T,>(query: string, timeout = 22000): Promise<T[]> => {
  const { data, error } = await supabase.functions.invoke("neon-query", {
    body: { action: "customQuery", query, timeout },
  });
  if (error) throw new Error(error.message);
  if (data?.error && !data?.data?.length) throw new Error(data.error);
  return (data?.data ?? data ?? []) as T[];
};

/**
 * Federal Front-Company Watchlist
 * Cross-references the FAA master registry against documented FBI/DEA/USMS/DHS
 * aviation front companies, then joins those Mode-S hex codes against the live
 * detection archive to surface any presence inside our collection footprint.
 */
export default function FederalFrontPanel() {
  const [loading, setLoading] = useState(false);
  const [fleet, setFleet] = useState<FleetRow[]>([]);
  const [hits, setHits] = useState<HitRow[]>([]);
  const [callsigns, setCallsigns] = useState<CallsignRow[]>([]);
  const [ranAt, setRanAt] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const fleetRows = await runQuery<FleetRow>(`
        SELECT upper('N'||n_number) AS tail,
               upper(replace(mode_s_code_hex,' ','')) AS hex,
               upper(name) AS registrant,
               coalesce(city,'') AS city,
               coalesce(state,'') AS state,
               year_mfr AS year,
               mfr_mdl_code AS model
        FROM faa_master
        WHERE upper(name) ~ '(${FRONT_REGEX})'
        ORDER BY registrant, tail
      `);
      setFleet(fleetRows);

      const hexes = Array.from(new Set(fleetRows.map((r) => r.hex).filter(Boolean)));
      if (hexes.length) {
        // icao24 is stored in mixed case; query both forms so the btree index is used.
        const list = hexes
          .flatMap((h) => [h.toUpperCase(), h.toLowerCase()])
          .map((h) => `'${h.replace(/'/g, "")}'`)
          .join(",");
        const hitRows = await runQuery<HitRow>(`
          SELECT icao24 AS hex, max(registration) AS tail, count(*)::int AS pings,
                 min(detection_timestamp) AS first_seen, max(detection_timestamp) AS last_seen,
                 round(min(altitude))::int AS minalt, round(max(altitude))::int AS maxalt
          FROM live_flight_detections_rows
          WHERE icao24 IN (${list})
          GROUP BY 1
          ORDER BY pings DESC
          LIMIT 100
        `);
        setHits(hitRows);
      }

      const csRows = await runQuery<CallsignRow>(`
        SELECT upper(callsign) AS callsign, max(registration) AS registration,
               count(*)::int AS pings, max(detection_timestamp) AS last_seen
        FROM live_flight_detections_rows
        WHERE callsign IS NOT NULL
          AND upper(callsign) ~ '${FRONT_CALLSIGN_REGEX}'
          AND detection_timestamp > now() - interval '90 days'
        GROUP BY 1
        ORDER BY pings DESC
        LIMIT 25
      `);
      setCallsigns(csRows);
      setRanAt(new Date().toLocaleString());
    } catch (e: any) {
      toast.error(`Front-company scan failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const byCompany = FEDERAL_FRONTS.map((f) => ({
    ...f,
    count: fleet.filter((r) => r.registrant.includes(f.name)).length,
  })).filter((f) => f.count > 0);

  const totalPings = hits.reduce((s, h) => s + Number(h.pings), 0);

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 font-display uppercase tracking-wider">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Federal Front-Company Watchlist
            </CardTitle>
            <CardDescription>
              FBI / DEA / USMS / DHS covert aviation fronts (AP 2015, BuzzFeed 2016–17, The Intercept 2021)
              joined against the FAA master registry and the live detection archive.
              {ranAt && <span className="ml-1 opacity-70">Last scan {ranAt}.</span>}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={scan} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Re-scan</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat icon={Building2} label="Front companies matched" value={byCompany.length} />
          <Stat icon={Plane} label="Registry aircraft" value={fleet.length} />
          <Stat icon={ShieldAlert} label="Airframes detected here" value={hits.length} tone="destructive" />
          <Stat icon={Radio} label="Detection pings" value={totalPings} tone="destructive" />
        </div>

        {hits.length > 0 && (
          <div>
            <h3 className="mb-2 font-display text-sm uppercase tracking-wider text-destructive">
              Confirmed presence in our airspace
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tail</TableHead>
                  <TableHead>Hex</TableHead>
                  <TableHead>Front / Agency</TableHead>
                  <TableHead className="text-right">Pings</TableHead>
                  <TableHead className="text-right">Alt band (ft)</TableHead>
                  <TableHead>Window</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hits.map((h) => {
                  const match = fleet.find((f) => f.hex.toUpperCase() === h.hex.toUpperCase());
                  const front = match ? AGENCY_FOR(match.registrant) : undefined;
                  const ground = (h.maxalt ?? 0) === 0;
                  return (
                    <TableRow key={h.hex}>
                      <TableCell className="font-mono font-bold">{h.tail || match?.tail || "—"}</TableCell>
                      <TableCell className="font-mono text-xs uppercase">{h.hex}</TableCell>
                      <TableCell className="text-xs">
                        {match?.registrant ?? "—"}
                        {front && (
                          <Badge variant="destructive" className="ml-2">
                            {front.agency}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{h.pings}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {ground ? "GROUND (0)" : `${h.minalt?.toLocaleString()}–${h.maxalt?.toLocaleString()}`}
                      </TableCell>
                      <TableCell className="text-xs opacity-80">
                        {new Date(h.first_seen).toLocaleDateString()} → {new Date(h.last_seen).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">
              Presence is not proof of a mission. Ground-state squitters (0 ft) mean the airframe was parked;
              high-altitude transits with no orbit are logged, not escalated.
            </p>
          </div>
        )}

        <div>
          <h3 className="mb-2 font-display text-sm uppercase tracking-wider">Registry footprint by front company</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Front company</TableHead>
                <TableHead>Agency</TableHead>
                <TableHead>Registered city</TableHead>
                <TableHead className="text-right">Aircraft</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byCompany.map((f) => (
                <TableRow key={f.name}>
                  <TableCell className="font-mono text-xs font-bold">{f.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{f.agency}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{f.city}</TableCell>
                  <TableCell className="text-right font-mono">{f.count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{f.note}</TableCell>
                </TableRow>
              ))}
              {!byCompany.length && !loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No registry matches returned.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div>
          <h3 className="mb-2 font-display text-sm uppercase tracking-wider">
            Tradecraft callsign monitor (JENNA / JENA / ROSS, last 90 days)
          </h3>
          {callsigns.length ? (
            <div className="flex flex-wrap gap-2">
              {callsigns.map((c) => (
                <Badge key={c.callsign} variant="secondary" className="font-mono">
                  {c.callsign} · {c.pings} pings · {new Date(c.last_seen).toLocaleDateString()}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No matching callsigns in the window. Squawk 4414/4415 monitoring still requires squawk capture in ingest.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: number;
  tone?: "destructive";
}) {
  return (
    <div className="rounded border border-border bg-card/50 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${tone === "destructive" ? "text-destructive" : ""}`} />
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl ${tone === "destructive" ? "text-destructive" : "text-primary"}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
