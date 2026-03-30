import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "npm:postgres@3.4.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Notion DB IDs
const NOTION_DBS = {
  aircraftEventsLog: 'ccbe5121-6049-451b-b153-915c68ae4742', // data source for Aircraft Events Log
  evidenceFileLibrary: 'cf7486ba-2cdd-4773-924e-118c8e64d2f9',
  legalEvidenceMatrix: '29e33a7b-866a-814a-b67a-000b2b1c36eb',
  leoMilitaryEventLog: 'eb0962e3-b6c1-4bfc-b511-61e7223f4be0',
  josiahArchive: '29e33a7b-866a-8159-bc03-000b3841520b',
  liveFlightDetections: '29e33a7b-866a-81b9-9bd9-000b9f0fb37f',
  forensicEvidenceCSV: '29e33a7b-866a-81a9-929d-00026f770794',
};

async function computeSHA256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function notionQuery(dbId: string, filter: any, startCursor?: string): Promise<any> {
  const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY');
  if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY not configured');

  const body: any = { filter, page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;

  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Notion API ${res.status}: ${errText}`);
  }
  return res.json();
}

// Extract property value from Notion page
function getProp(page: any, name: string): any {
  const prop = page.properties?.[name];
  if (!prop) return null;
  switch (prop.type) {
    case 'title': return prop.title?.map((t: any) => t.plain_text).join('') || null;
    case 'rich_text': return prop.rich_text?.map((t: any) => t.plain_text).join('') || null;
    case 'number': return prop.number;
    case 'select': return prop.select?.name || null;
    case 'multi_select': return prop.multi_select?.map((s: any) => s.name) || [];
    case 'date': return prop.date?.start || null;
    case 'checkbox': return prop.checkbox;
    case 'url': return prop.url;
    case 'email': return prop.email;
    case 'formula':
      if (prop.formula?.type === 'string') return prop.formula.string;
      if (prop.formula?.type === 'number') return prop.formula.number;
      return null;
    case 'rollup':
      if (prop.rollup?.type === 'array') return prop.rollup.array?.map((r: any) => {
        if (r.type === 'rich_text') return r.rich_text?.map((t: any) => t.plain_text).join('');
        if (r.type === 'number') return r.number;
        return null;
      });
      if (prop.rollup?.type === 'number') return prop.rollup.number;
      return null;
    case 'status': return prop.status?.name || null;
    case 'relation': return prop.relation?.map((r: any) => r.id) || [];
    default: return null;
  }
}

function getCreatedTime(page: any): string {
  return page.created_time || new Date().toISOString();
}

// ── Backfill handlers ──────────────────────────────────────────────────

async function backfillAircraftEvents(sql: any, startDate: string, endDate: string) {
  const inserted: string[] = [];
  const skipped: string[] = [];
  const errors: any[] = [];
  let cursor: string | undefined;
  let totalFetched = 0;

  do {
    const result = await notionQuery(NOTION_DBS.aircraftEventsLog, {
      and: [
        { property: 'Datetime (UTC)', date: { on_or_after: startDate } },
        { property: 'Datetime (UTC)', date: { on_or_before: endDate } },
      ]
    }, cursor);

    totalFetched += result.results.length;

    for (const page of result.results) {
      try {
        const registration = getProp(page, 'Aircraft ID / Registration');
        const datetime = getProp(page, 'Datetime (UTC)');
        const altitude = getProp(page, 'Altitude (ft)');
        const description = getProp(page, 'Description');
        const behaviors = getProp(page, 'Behavior') || [];
        const eventCode = getProp(page, 'Event Code');
        const source = getProp(page, 'Source') || 'notion';
        const notionId = page.id;

        // Check if exists
        const existing = await sql`
          SELECT id FROM flight_events 
          WHERE event_id = ${notionId} 
          OR (registration = ${registration} AND detection_timestamp = ${datetime})
          LIMIT 1
        `;
        if (existing.length > 0) { skipped.push(registration || notionId); continue; }

        const dataStr = [notionId, registration||'', datetime||'', altitude||'', behaviors.join(','), description||''].join('|');
        const sha256 = await computeSHA256(dataStr);

        await sql`
          INSERT INTO flight_events (event_id, registration, detection_timestamp, altitude_feet, zone, event_type, notes, detection_method, sha256_hash, created_at)
          VALUES (${notionId}, ${registration}, ${datetime}, ${altitude}, ${behaviors[0]||null}, ${eventCode||'aircraft_event'}, ${description}, ${'notion-backfill'}, ${sha256}, NOW())
        `;
        inserted.push(registration || notionId);
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return { source: 'aircraftEventsLog', fetched: totalFetched, inserted: inserted.length, skipped: skipped.length, errors: errors.length, errorDetails: errors.slice(0, 5) };
}

async function backfillEvidenceFiles(sql: any, startDate: string, endDate: string) {
  const inserted: string[] = [];
  const updated: string[] = [];
  const errors: any[] = [];
  let cursor: string | undefined;
  let totalFetched = 0;

  // Ensure table exists
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS evidence_files (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      notion_page_id TEXT UNIQUE,
      filename TEXT,
      sha256_hash TEXT,
      tags TEXT[],
      file_type TEXT,
      data_date TIMESTAMPTZ,
      sealed BOOLEAN DEFAULT false,
      sealed_on TIMESTAMPTZ,
      sealed_by TEXT,
      parsing_status TEXT DEFAULT '1-To Parse',
      provenance TEXT,
      jurisdiction_relevance TEXT[],
      caption TEXT,
      file_url TEXT,
      related_event_id TEXT,
      related_physio_id TEXT,
      related_memory_id TEXT,
      source TEXT DEFAULT 'notion',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  do {
    // Use created_time filter since this DB may not have a specific date property for filtering
    const result = await notionQuery(NOTION_DBS.evidenceFileLibrary, {
      and: [
        { timestamp: 'created_time', created_time: { on_or_after: startDate } },
        { timestamp: 'created_time', created_time: { on_or_before: endDate } },
      ]
    }, cursor);

    totalFetched += result.results.length;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        const filename = getProp(page, 'File Name');
        const sha256 = getProp(page, 'SHA-256 Hash');
        const sealed = getProp(page, 'Sealed') || false;
        const parsingStatus = getProp(page, 'Parsing Status');
        const provenance = getProp(page, 'Provenance');
        const jurisdictions = getProp(page, 'Jurisdiction Relevance') || [];
        const caption = getProp(page, 'Caption/Abstract');
        const dataDate = getProp(page, 'Data Date');
        const fileType = getProp(page, 'Type');

        const chainStr = [notionId, filename||'', sha256||'', dataDate||'', JSON.stringify(jurisdictions)].join('|');
        const chainHash = await computeSHA256(chainStr);

        const existing = await sql`SELECT id FROM evidence_files WHERE notion_page_id = ${notionId} LIMIT 1`;
        if (existing.length > 0) {
          await sql`UPDATE evidence_files SET filename=${filename}, sha256_hash=${sha256||chainHash}, sealed=${sealed}, parsing_status=${parsingStatus||'1-To Parse'}, provenance=${provenance}, jurisdiction_relevance=${jurisdictions.length > 0 ? jurisdictions : null}, caption=${caption}, data_date=${dataDate}, updated_at=NOW() WHERE notion_page_id = ${notionId}`;
          updated.push(notionId);
        } else {
          await sql`INSERT INTO evidence_files (notion_page_id, filename, sha256_hash, sealed, parsing_status, provenance, jurisdiction_relevance, caption, data_date, file_type, source) VALUES (${notionId}, ${filename}, ${sha256||chainHash}, ${sealed}, ${parsingStatus||'1-To Parse'}, ${provenance}, ${jurisdictions.length > 0 ? jurisdictions : null}, ${caption}, ${dataDate}, ${fileType}, 'notion-backfill')`;
          inserted.push(notionId);
        }
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return { source: 'evidenceFileLibrary', fetched: totalFetched, inserted: inserted.length, updated: updated.length, errors: errors.length };
}

async function backfillLegalMatrix(sql: any, startDate: string, endDate: string) {
  const inserted: string[] = [];
  const errors: any[] = [];
  let cursor: string | undefined;
  let totalFetched = 0;

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS legal_evidence_matrix (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      notion_page_id TEXT UNIQUE,
      exhibit_id TEXT,
      statute TEXT,
      evidence_type TEXT,
      description TEXT,
      severity TEXT,
      linked_aircraft TEXT[],
      linked_entities TEXT[],
      rollup_correlations JSONB DEFAULT '{}',
      jurisdiction TEXT,
      filing_status TEXT,
      source TEXT DEFAULT 'notion',
      sha256_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  do {
    const result = await notionQuery(NOTION_DBS.legalEvidenceMatrix, {
      and: [
        { timestamp: 'created_time', created_time: { on_or_after: startDate } },
        { timestamp: 'created_time', created_time: { on_or_before: endDate } },
      ]
    }, cursor);

    totalFetched += result.results.length;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        const alertType = getProp(page, 'alert_type');
        const severity = getProp(page, 'severity');
        const description = getProp(page, 'description');
        const flightId = getProp(page, 'flight_id');
        const createdAt = getProp(page, 'created_at');
        const title = getProp(page, 'id') || getProp(page, 'userDefined:id');

        const dataStr = [notionId, alertType||'', description||'', severity||''].join('|');
        const sha256 = await computeSHA256(dataStr);

        const existing = await sql`SELECT id FROM legal_evidence_matrix WHERE notion_page_id = ${notionId} LIMIT 1`;
        if (existing.length > 0) continue;

        await sql`INSERT INTO legal_evidence_matrix (notion_page_id, exhibit_id, evidence_type, description, severity, source, sha256_hash) VALUES (${notionId}, ${title||flightId}, ${alertType}, ${description}, ${severity}, 'notion-backfill', ${sha256})`;
        inserted.push(notionId);
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return { source: 'legalEvidenceMatrix', fetched: totalFetched, inserted: inserted.length, errors: errors.length };
}

async function backfillLEOEvents(sql: any, startDate: string, endDate: string) {
  const inserted: string[] = [];
  const errors: any[] = [];
  let cursor: string | undefined;
  let totalFetched = 0;

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS leo_military_events (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      notion_page_id TEXT UNIQUE,
      agency TEXT,
      event_type TEXT,
      event_timestamp TIMESTAMPTZ,
      description TEXT,
      location TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      related_aircraft TEXT[],
      officer_unit TEXT,
      source TEXT DEFAULT 'notion',
      sha256_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  do {
    const result = await notionQuery(NOTION_DBS.leoMilitaryEventLog, {
      and: [
        { timestamp: 'created_time', created_time: { on_or_after: startDate } },
        { timestamp: 'created_time', created_time: { on_or_before: endDate } },
      ]
    }, cursor);

    totalFetched += result.results.length;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        const name = getProp(page, 'Name');

        const dataStr = [notionId, name||'', getCreatedTime(page)].join('|');
        const sha256 = await computeSHA256(dataStr);

        const existing = await sql`SELECT id FROM leo_military_events WHERE notion_page_id = ${notionId} LIMIT 1`;
        if (existing.length > 0) continue;

        await sql`INSERT INTO leo_military_events (notion_page_id, description, event_timestamp, source, sha256_hash) VALUES (${notionId}, ${name}, ${getCreatedTime(page)}, 'notion-backfill', ${sha256})`;
        inserted.push(notionId);
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return { source: 'leoMilitaryEventLog', fetched: totalFetched, inserted: inserted.length, errors: errors.length };
}

async function backfillForensicEvidence(sql: any, startDate: string, endDate: string) {
  const inserted: string[] = [];
  const errors: any[] = [];
  let cursor: string | undefined;
  let totalFetched = 0;

  do {
    const result = await notionQuery(NOTION_DBS.forensicEvidenceCSV, {
      and: [
        { timestamp: 'created_time', created_time: { on_or_after: startDate } },
        { timestamp: 'created_time', created_time: { on_or_before: endDate } },
      ]
    }, cursor);

    totalFetched += result.results.length;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        // Extract all properties dynamically
        const props: Record<string, any> = {};
        for (const [key, _] of Object.entries(page.properties || {})) {
          props[key] = getProp(page, key);
        }

        const dataStr = JSON.stringify(props);
        const sha256 = await computeSHA256(dataStr);

        // Store in evidence_documents (Supabase table)
        const title = props['Name'] || props['title'] || props['File Name'] || `forensic-${notionId.slice(0,8)}`;
        const content = JSON.stringify(props);

        // Check if already exists
        const existing = await sql`SELECT id FROM evidence_files WHERE notion_page_id = ${notionId} LIMIT 1`;
        if (existing.length > 0) continue;

        await sql`INSERT INTO evidence_files (notion_page_id, filename, sha256_hash, source, created_at) VALUES (${notionId}, ${title}, ${sha256}, 'notion-backfill-forensic', NOW())`;
        inserted.push(title);
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return { source: 'forensicEvidenceCSV', fetched: totalFetched, inserted: inserted.length, errors: errors.length };
}

async function backfillLiveFlightDetections(sql: any, startDate: string, endDate: string) {
  const inserted: string[] = [];
  const skipped: string[] = [];
  const errors: any[] = [];
  let cursor: string | undefined;
  let totalFetched = 0;

  do {
    const result = await notionQuery(NOTION_DBS.liveFlightDetections, {
      and: [
        { timestamp: 'created_time', created_time: { on_or_after: startDate } },
        { timestamp: 'created_time', created_time: { on_or_before: endDate } },
      ]
    }, cursor);

    totalFetched += result.results.length;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        const props: Record<string, any> = {};
        for (const [key, _] of Object.entries(page.properties || {})) {
          props[key] = getProp(page, key);
        }

        const registration = props['registration'] || props['Name'] || props['title'];
        if (!registration) continue;

        // Check if exists in flight_events
        const existing = await sql`SELECT id FROM flight_events WHERE event_id = ${notionId} LIMIT 1`;
        if (existing.length > 0) { skipped.push(registration); continue; }

        const dataStr = [notionId, registration, getCreatedTime(page)].join('|');
        const sha256 = await computeSHA256(dataStr);

        await sql`
          INSERT INTO flight_events (event_id, registration, detection_timestamp, detection_method, sha256_hash, created_at)
          VALUES (${notionId}, ${registration}, ${getCreatedTime(page)}, ${'notion-backfill-live'}, ${sha256}, NOW())
        `;
        inserted.push(registration);
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return { source: 'liveFlightDetections', fetched: totalFetched, inserted: inserted.length, skipped: skipped.length, errors: errors.length };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, startDate, endDate, databases } = await req.json();
    
    const start = startDate || '2026-01-01';
    const end = endDate || '2026-03-31';

    const NEON_DATABASE_URL = Deno.env.get('NEON_DATABASE_URL');
    if (!NEON_DATABASE_URL) throw new Error('NEON_DATABASE_URL not configured');

    const sql = postgres(NEON_DATABASE_URL, { ssl: 'require', max: 2, idle_timeout: 30, prepare: false });

    const results: any[] = [];

    if (action === 'scan') {
      // Just count what's available in Notion for the date range
      const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY');
      if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY not configured');

      const dbChecks = Object.entries(NOTION_DBS);
      const counts: Record<string, number> = {};
      
      const scanErrors: Record<string, string> = {};
      for (const [name, dbId] of dbChecks) {
        try {
          const res = await notionQuery(dbId, {
            and: [
              { timestamp: 'created_time', created_time: { on_or_after: start } },
              { timestamp: 'created_time', created_time: { on_or_before: end } },
            ]
          });
          counts[name] = res.results.length + (res.has_more ? 100 : 0);
        } catch (e) {
          counts[name] = -1;
          scanErrors[name] = (e as Error).message;
          console.error(`Scan error for ${name} (${dbId}):`, (e as Error).message);
        }
      }

      await sql.end();
      return new Response(JSON.stringify({ success: true, action: 'scan', dateRange: { start, end }, counts, scanErrors }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'backfill') {
      const targetDbs = databases || ['aircraftEventsLog', 'evidenceFileLibrary', 'legalEvidenceMatrix', 'leoMilitaryEventLog', 'forensicEvidenceCSV', 'liveFlightDetections'];

      for (const db of targetDbs) {
        try {
          switch (db) {
            case 'aircraftEventsLog':
              results.push(await backfillAircraftEvents(sql, start, end));
              break;
            case 'evidenceFileLibrary':
              results.push(await backfillEvidenceFiles(sql, start, end));
              break;
            case 'legalEvidenceMatrix':
              results.push(await backfillLegalMatrix(sql, start, end));
              break;
            case 'leoMilitaryEventLog':
              results.push(await backfillLEOEvents(sql, start, end));
              break;
            case 'forensicEvidenceCSV':
              results.push(await backfillForensicEvidence(sql, start, end));
              break;
            case 'liveFlightDetections':
              results.push(await backfillLiveFlightDetections(sql, start, end));
              break;
          }
        } catch (e) {
          results.push({ source: db, error: (e as Error).message });
        }
      }

      await sql.end();

      const totalInserted = results.reduce((sum, r) => sum + (r.inserted || 0), 0);
      const totalFetched = results.reduce((sum, r) => sum + (r.fetched || 0), 0);

      return new Response(JSON.stringify({
        success: true,
        action: 'backfill',
        dateRange: { start, end },
        totalFetched,
        totalInserted,
        databases: results,
        message: `Backfilled ${totalInserted} records from ${totalFetched} Notion pages across ${results.length} databases`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action. Use "scan" or "backfill"' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Notion backfill error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
