// Registrant OSINT Scan
// Pulls unique registrants from aircraft_registry, scrapes OpenCorporates + CA SoS
// via Firecrawl, writes structured matches to entity_registry, and flags shared
// officers / addresses / agents in operator_profile_conflicts.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY");

interface OsintCompany {
  name: string;
  jurisdiction?: string;
  company_number?: string;
  status?: string;
  incorporation_date?: string;
  registered_address?: string;
  registered_agent?: string;
  officers?: string[];
  source_url: string;
  source: "opencorporates" | "ca_sos";
}

async function firecrawlJson(url: string, prompt: string, waitFor = 2500): Promise<any | null> {
  if (!FIRECRAWL_KEY) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: [{ type: "json", prompt }, "markdown"],
        onlyMainContent: true,
        waitFor,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      console.error(`Firecrawl ${r.status} for ${url}: ${await r.text()}`);
      return null;
    }
    const j = await r.json();
    return j?.data ?? j;
  } catch (e) {
    clearTimeout(t);
    console.error(`Firecrawl error for ${url}:`, e);
    return null;
  }
}

async function scanOpenCorporates(name: string): Promise<OsintCompany[]> {
  const q = encodeURIComponent(name);
  const url = `https://opencorporates.com/companies?q=${q}&utf8=%E2%9C%93`;
  const data = await firecrawlJson(
    url,
    `Extract up to 8 companies matching "${name}" from the search results. For each: name, jurisdiction (state/country), company_number, status (active/inactive/dissolved), incorporation_date, registered_address, and up to 5 officer names. Return {"companies":[{name, jurisdiction, company_number, status, incorporation_date, registered_address, officers:[]}]}`,
  );
  const list = data?.json?.companies ?? data?.companies ?? [];
  return list.map((c: any) => ({
    name: c.name || name,
    jurisdiction: c.jurisdiction,
    company_number: c.company_number,
    status: c.status,
    incorporation_date: c.incorporation_date,
    registered_address: c.registered_address,
    officers: Array.isArray(c.officers) ? c.officers : [],
    source_url: url,
    source: "opencorporates" as const,
  }));
}

async function scanCaSos(name: string): Promise<OsintCompany[]> {
  const q = encodeURIComponent(name);
  const url = `https://bizfileonline.sos.ca.gov/search/business?SearchType=CORP&SearchCriteria=${q}&SearchSubType=Keyword`;
  const data = await firecrawlJson(
    url,
    `Extract up to 6 California business entities matching "${name}". For each: name, company_number (entity number), status, incorporation_date (registration date), registered_agent (agent for service of process), registered_address (agent or principal address). Return {"companies":[{name, company_number, status, incorporation_date, registered_agent, registered_address}]}`,
    4000,
  );
  const list = data?.json?.companies ?? data?.companies ?? [];
  return list.map((c: any) => ({
    name: c.name || name,
    jurisdiction: "California",
    company_number: c.company_number,
    status: c.status,
    incorporation_date: c.incorporation_date,
    registered_address: c.registered_address,
    registered_agent: c.registered_agent,
    officers: [],
    source_url: url,
    source: "ca_sos" as const,
  }));
}

function norm(s?: string | null): string {
  return (s || "").toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    if (!FIRECRAWL_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl connector not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || "scan_batch";

    // --- List conflicts ---------------------------------------------------
    if (action === "list_results") {
      const { data: entities } = await sb
        .from("entity_registry")
        .select("*")
        .in("entity_type", ["shell_company", "operator"])
        .contains("source_tables", ["osint_scan"])
        .order("last_seen", { ascending: false })
        .limit(200);
      const { data: conflicts } = await sb
        .from("operator_profile_conflicts")
        .select("*")
        .in("field", ["shared_officer", "shared_address", "shared_agent"])
        .order("detected_at", { ascending: false })
        .limit(200);
      return new Response(
        JSON.stringify({ success: true, entities: entities || [], conflicts: conflicts || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Scan (single registrant or batch) --------------------------------
    let registrants: string[] = [];

    if (action === "scan_registrant" && body.registrant_name) {
      registrants = [String(body.registrant_name)];
    } else {
      const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 25);
      const { data, error } = await sb
        .from("aircraft_registry")
        .select("registrant_name")
        .not("registrant_name", "is", null)
        .order("scraped_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const seen = new Set<string>();
      for (const row of data || []) {
        const n = (row.registrant_name || "").trim();
        if (!n) continue;
        const key = norm(n);
        if (seen.has(key)) continue;
        seen.add(key);
        registrants.push(n);
        if (registrants.length >= limit) break;
      }
    }

    const scanned: any[] = [];
    const allCompanies: OsintCompany[] = [];

    for (const reg of registrants) {
      const [oc, ca] = await Promise.all([
        scanOpenCorporates(reg).catch(() => []),
        scanCaSos(reg).catch(() => []),
      ]);
      const matches = [...oc, ...ca];
      allCompanies.push(...matches);

      // Upsert into entity_registry
      for (const c of matches) {
        const canonical = norm(c.name);
        if (!canonical) continue;
        const { data: existing } = await sb
          .from("entity_registry")
          .select("entity_id, metadata, aliases, source_tables")
          .eq("canonical_identifier", canonical)
          .eq("entity_type", "shell_company")
          .maybeSingle();

        const metadata = {
          ...(existing?.metadata || {}),
          [c.source]: {
            jurisdiction: c.jurisdiction,
            company_number: c.company_number,
            status: c.status,
            incorporation_date: c.incorporation_date,
            registered_address: c.registered_address,
            registered_agent: c.registered_agent,
            officers: c.officers,
            source_url: c.source_url,
            scanned_at: new Date().toISOString(),
          },
          linked_registrant: reg,
        };
        const source_tables = Array.from(new Set([
          ...(Array.isArray(existing?.source_tables) ? existing!.source_tables : []),
          "osint_scan",
          `osint_${c.source}`,
        ]));
        const aliases = Array.from(new Set([
          ...(existing?.aliases || []),
          c.name,
          reg,
        ]));

        if (existing) {
          await sb.from("entity_registry").update({
            metadata, source_tables, aliases, last_seen: new Date().toISOString(),
          }).eq("entity_id", existing.entity_id);
        } else {
          await sb.from("entity_registry").insert({
            entity_type: "shell_company",
            canonical_identifier: canonical,
            aliases,
            source_tables,
            metadata,
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString(),
          });
        }
      }

      scanned.push({ registrant: reg, matches: matches.length });
    }

    // --- Cross-reference for shared officers / addresses / agents ---------
    const officerMap = new Map<string, Set<string>>(); // officer -> set of company names
    const addressMap = new Map<string, Set<string>>();
    const agentMap = new Map<string, Set<string>>();

    for (const c of allCompanies) {
      const cn = c.name;
      for (const o of c.officers || []) {
        const k = norm(o);
        if (!k || k.length < 4) continue;
        if (!officerMap.has(k)) officerMap.set(k, new Set());
        officerMap.get(k)!.add(cn);
      }
      const addr = norm(c.registered_address);
      if (addr && addr.length > 8) {
        if (!addressMap.has(addr)) addressMap.set(addr, new Set());
        addressMap.get(addr)!.add(cn);
      }
      const ag = norm(c.registered_agent);
      if (ag && ag.length > 4) {
        if (!agentMap.has(ag)) agentMap.set(ag, new Set());
        agentMap.get(ag)!.add(cn);
      }
    }

    const conflictsInserted: any[] = [];
    const insertConflict = async (field: string, value: string, companies: string[]) => {
      if (companies.length < 2) return;
      const row = {
        registration: companies[0],
        field,
        value_a: value,
        source_a: "osint_scan",
        value_b: companies.slice(1).join(" | "),
        source_b: "osint_scan",
        resolved: false,
        detected_at: new Date().toISOString(),
      };
      const { error } = await sb.from("operator_profile_conflicts").insert(row);
      if (!error) conflictsInserted.push(row);
    };

    for (const [k, cos] of officerMap) if (cos.size >= 2) await insertConflict("shared_officer", k, [...cos]);
    for (const [k, cos] of addressMap) if (cos.size >= 2) await insertConflict("shared_address", k, [...cos]);
    for (const [k, cos] of agentMap) if (cos.size >= 2) await insertConflict("shared_agent", k, [...cos]);

    return new Response(
      JSON.stringify({
        success: true,
        scanned,
        registrants_scanned: registrants.length,
        matches_total: allCompanies.length,
        conflicts_found: conflictsInserted.length,
        conflicts: conflictsInserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("registrant-osint-scan error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
