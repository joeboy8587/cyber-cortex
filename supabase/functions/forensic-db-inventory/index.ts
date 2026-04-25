// Forensic DB Inventory — Phase 1 (READ-ONLY)
// Safely audits the entire Neon database without modifying any data.
// Detects: empty tables, duplicate-shape tables, fragment families, row counts, sizes.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TableInfo {
  schema: string;
  table: string;
  row_count: number;
  size_bytes: number;
  size_pretty: string;
  column_count: number;
  columns: string[];
  is_empty: boolean;
  last_analyzed: string | null;
}

interface DuplicateGroup {
  signature: string;
  tables: string[];
  total_rows: number;
}

interface FragmentFamily {
  family_name: string;
  pattern: string;
  tables: { name: string; rows: number }[];
  total_rows: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("NEON_DATABASE_URL");
  if (!url) {
    return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not set" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sql = postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 30, prepare: false });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "fullScan";

    if (action === "fullScan") {
      console.log("Starting forensic DB inventory scan (read-only)...");

      // 1. List all schemas with table counts
      const schemas = await sql.unsafe(`
        SELECT table_schema as schema, COUNT(*)::int as table_count
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
        GROUP BY table_schema
        ORDER BY table_count DESC
      `) as any[];

      // 2. Per-table inventory (row counts via pg_class - fast, approximate)
      const tables = await sql.unsafe(`
        SELECT
          n.nspname as schema,
          c.relname as table,
          COALESCE(c.reltuples::bigint, 0) as row_count_estimate,
          pg_total_relation_size(c.oid) as size_bytes,
          pg_size_pretty(pg_total_relation_size(c.oid)) as size_pretty,
          (SELECT COUNT(*)::int FROM information_schema.columns
           WHERE table_schema = n.nspname AND table_name = c.relname) as column_count,
          s.last_analyze
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.schemaname = n.nspname AND s.relname = c.relname
        WHERE c.relkind = 'r'
          AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
        ORDER BY pg_total_relation_size(c.oid) DESC
      `) as any[];

      // 3. Get column lists for shape comparison
      const columnsByTable = await sql.unsafe(`
        SELECT
          table_schema as schema,
          table_name as table,
          string_agg(column_name, ',' ORDER BY ordinal_position) as col_signature,
          array_agg(column_name ORDER BY ordinal_position) as columns
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
        GROUP BY table_schema, table_name
      `) as any[];

      const colMap = new Map<string, { signature: string; columns: string[] }>();
      for (const r of columnsByTable) {
        colMap.set(`${r.schema}.${r.table}`, { signature: r.col_signature, columns: r.columns });
      }

      // 4. Build enriched table list
      const enriched: TableInfo[] = tables.map((t: any) => {
        const cols = colMap.get(`${t.schema}.${t.table}`);
        return {
          schema: t.schema,
          table: t.table,
          row_count: Number(t.row_count_estimate) || 0,
          size_bytes: Number(t.size_bytes) || 0,
          size_pretty: t.size_pretty,
          column_count: t.column_count || 0,
          columns: cols?.columns || [],
          is_empty: Number(t.row_count_estimate) === 0,
          last_analyzed: t.last_analyze,
        };
      });

      // 5. Detect duplicate-shape tables (same column signature)
      const sigGroups = new Map<string, string[]>();
      for (const r of columnsByTable) {
        const key = r.col_signature;
        const fullName = `${r.schema}.${r.table}`;
        if (!sigGroups.has(key)) sigGroups.set(key, []);
        sigGroups.get(key)!.push(fullName);
      }
      const duplicates: DuplicateGroup[] = [];
      for (const [sig, tbls] of sigGroups) {
        if (tbls.length > 1) {
          const totalRows = tbls.reduce((sum, name) => {
            const t = enriched.find((e) => `${e.schema}.${e.table}` === name);
            return sum + (t?.row_count || 0);
          }, 0);
          duplicates.push({
            signature: sig.substring(0, 200) + (sig.length > 200 ? "..." : ""),
            tables: tbls,
            total_rows: totalRows,
          });
        }
      }
      duplicates.sort((a, b) => b.total_rows - a.total_rows);

      // 6. Detect fragment families by name pattern
      const families = new Map<string, { name: string; rows: number }[]>();
      const patterns = [
        { name: "Flight Detections", regex: /flight|adsb|aircraft.*detect|live_flight/i },
        { name: "Biometric / Health", regex: /biometric|whoop|heart|hrv|ecg|stress/i },
        { name: "OCR / Document Extraction", regex: /ocr|extract|document/i },
        { name: "Witness / Sightings", regex: /witness|sighting/i },
        { name: "Legal / Evidence", regex: /legal|evidence|case|exhibit|forensic/i },
        { name: "Drone / Sub-stall", regex: /drone|substall|sub_stall/i },
        { name: "Ghost / Spoofing", regex: /ghost|spoof|null_icao|squawk/i },
        { name: "KCSO / Sheriff", regex: /kcso|sheriff/i },
        { name: "Shell Companies / Entities", regex: /shell|entity|operator|registrant/i },
        { name: "Pattern Recognition / AI", regex: /pattern|josiah|sentinel|watchtower/i },
        { name: "Backup / Archive / Legacy", regex: /backup|archive|legacy|_old|_bak|recovery/i },
      ];

      for (const t of enriched) {
        for (const p of patterns) {
          if (p.regex.test(t.table)) {
            if (!families.has(p.name)) families.set(p.name, []);
            families.get(p.name)!.push({ name: `${t.schema}.${t.table}`, rows: t.row_count });
            break;
          }
        }
      }

      const fragmentFamilies: FragmentFamily[] = Array.from(families.entries())
        .map(([name, tbls]) => ({
          family_name: name,
          pattern: patterns.find((p) => p.name === name)!.regex.source,
          tables: tbls.sort((a, b) => b.rows - a.rows),
          total_rows: tbls.reduce((s, t) => s + t.rows, 0),
        }))
        .sort((a, b) => b.tables.length - a.tables.length);

      // 7. Summary stats
      const totalTables = enriched.length;
      const totalRows = enriched.reduce((s, t) => s + t.row_count, 0);
      const totalBytes = enriched.reduce((s, t) => s + t.size_bytes, 0);
      const emptyTables = enriched.filter((t) => t.is_empty).length;
      const duplicateTableCount = duplicates.reduce((s, d) => s + d.tables.length, 0);

      // 8. Save snapshot to Neon (additive, never destructive)
      try {
        await sql.unsafe(`
          CREATE TABLE IF NOT EXISTS public.forensic_db_inventory_snapshots (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ DEFAULT now(),
            total_tables INT,
            total_rows BIGINT,
            total_bytes BIGINT,
            empty_tables INT,
            duplicate_table_count INT,
            schemas JSONB,
            duplicates JSONB,
            fragment_families JSONB,
            top_tables JSONB
          )
        `);

        const topTables = enriched.slice(0, 50);
        await sql.unsafe(
          `INSERT INTO public.forensic_db_inventory_snapshots
           (total_tables,total_rows,total_bytes,empty_tables,duplicate_table_count,schemas,duplicates,fragment_families,top_tables)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb)`,
          [
            totalTables,
            totalRows,
            totalBytes,
            emptyTables,
            duplicateTableCount,
            JSON.stringify(schemas),
            JSON.stringify(duplicates.slice(0, 100)),
            JSON.stringify(fragmentFamilies),
            JSON.stringify(topTables),
          ] as any,
        );
      } catch (e) {
        console.warn("Snapshot save failed (non-fatal):", e);
      }

      const summary = {
        scanned_at: new Date().toISOString(),
        summary: {
          total_schemas: schemas.length,
          total_tables: totalTables,
          total_rows_estimate: totalRows,
          total_size_bytes: totalBytes,
          total_size_pretty: formatBytes(totalBytes),
          empty_tables: emptyTables,
          empty_pct: totalTables > 0 ? Math.round((emptyTables / totalTables) * 100) : 0,
          duplicate_groups: duplicates.length,
          duplicate_table_count: duplicateTableCount,
          fragment_families: fragmentFamilies.length,
        },
        schemas,
        top_tables: enriched.slice(0, 50),
        empty_tables_sample: enriched.filter((t) => t.is_empty).slice(0, 100),
        duplicates: duplicates.slice(0, 50),
        fragment_families: fragmentFamilies,
      };

      return new Response(JSON.stringify(summary), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "getSnapshots") {
      const snaps = await sql.unsafe(`
        SELECT id, created_at, total_tables, total_rows, total_bytes,
               empty_tables, duplicate_table_count
        FROM public.forensic_db_inventory_snapshots
        ORDER BY created_at DESC LIMIT 20
      `) as any[];
      return new Response(JSON.stringify({ snapshots: snaps }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("Forensic inventory error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* ignore */ }
  }
});

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
