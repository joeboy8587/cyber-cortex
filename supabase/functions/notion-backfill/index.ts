import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "npm:postgres@3.4.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Notion DB IDs — verified via workspace search (database container IDs)
const NOTION_DBS = {
  aircraftEventsLog: '0c3fd946-a8cc-4dd2-9ea8-1c0c58409a28',
  evidenceFileLibrary: '1e54936a-c78d-40b2-9e18-c2c05ed4118c',
  legalEvidenceMatrix: '29e33a7b-866a-8044-a98c-ee3d9fc925d4',
  leoMilitaryEventLog: '61cc9d11-371b-4017-83e3-2352d168e739',
  josiahArchive: 'b4920f99-99fb-4b33-8843-c3dffaf2956e',
  liveFlightDetections: '29e33a7b-866a-8005-a736-ec0f5253c498',
  forensicEvidenceCSV: '32733a7b-866a-806a-9839-cd3359250f16',
  flightAlertsRows: '29e33a7b-866a-805e-9fdd-c15c5b504624',
};

// ── Helpers ─────────────────────────────────────────────────────────────

async function computeSHA256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function notionQuery(dbId: string, filter: any, startCursor?: string, pageSize = 20): Promise<any> {
  const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY');
  if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY not configured');

  const body: any = { filter, page_size: pageSize };
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

// Build time filter — supports both created_time and last_edited_time
function buildTimeFilter(startDate: string, endDate: string, timeField: 'created_time' | 'last_edited_time' = 'created_time') {
  return {
    and: [
      { timestamp: timeField, [timeField]: { on_or_after: startDate } },
      { timestamp: timeField, [timeField]: { on_or_before: endDate } },
    ]
  };
}

// ── Standardized backfill interface ─────────────────────────────────────

interface BackfillParams {
  sql: any;
  startDate: string;
  endDate: string;
  maxPages: number;
  pageSize: number;
  startCursor?: string;
  timeField: 'created_time' | 'last_edited_time';
}

interface BackfillResult {
  source: string;
  fetched: number;
  inserted: number;
  conflicted: number;
  errors: number;
  errorDetails: any[];
  nextCursor: string | null;
  complete: boolean;
}

// ── Ensure unique constraints ───────────────────────────────────────────

async function ensureConstraints(sql: any) {
  // flight_events: unique on event_id
  await sql.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flight_events_event_id_unique') THEN
        ALTER TABLE flight_events ADD CONSTRAINT flight_events_event_id_unique UNIQUE (event_id);
      END IF;
    EXCEPTION WHEN others THEN NULL;
    END $$;
  `).catch(() => {});

  // evidence_files: already has UNIQUE on notion_page_id from CREATE TABLE
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS evidence_files (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      notion_page_id TEXT UNIQUE,
      filename TEXT, sha256_hash TEXT, tags TEXT[], file_type TEXT,
      data_date TIMESTAMPTZ, sealed BOOLEAN DEFAULT false,
      sealed_on TIMESTAMPTZ, sealed_by TEXT,
      parsing_status TEXT DEFAULT '1-To Parse', provenance TEXT,
      jurisdiction_relevance TEXT[], caption TEXT, file_url TEXT,
      related_event_id TEXT, related_physio_id TEXT, related_memory_id TEXT,
      source TEXT DEFAULT 'notion',
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS legal_evidence_matrix (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      notion_page_id TEXT UNIQUE,
      exhibit_id TEXT, statute TEXT, evidence_type TEXT, description TEXT,
      severity TEXT, linked_aircraft TEXT[], linked_entities TEXT[],
      rollup_correlations JSONB DEFAULT '{}', jurisdiction TEXT,
      filing_status TEXT, source TEXT DEFAULT 'notion', sha256_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS leo_military_events (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      notion_page_id TEXT UNIQUE,
      agency TEXT, event_type TEXT, event_timestamp TIMESTAMPTZ,
      description TEXT, location TEXT, latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION, related_aircraft TEXT[],
      officer_unit TEXT, source TEXT DEFAULT 'notion', sha256_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

// ── Backfill: Aircraft Events Log ──────────────────────────────────────

async function backfillAircraftEvents(p: BackfillParams): Promise<BackfillResult> {
  const { sql, startDate, endDate, maxPages, pageSize, startCursor, timeField } = p;
  let cursor: string | undefined = startCursor;
  let totalFetched = 0, inserted = 0, conflicted = 0, pagesProcessed = 0;
  const errors: any[] = [];

  console.log(`[aircraft] Backfill ${startDate}→${endDate} maxPages=${maxPages} timeField=${timeField}`);

  do {
    const result = await notionQuery(
      NOTION_DBS.aircraftEventsLog,
      buildTimeFilter(startDate, endDate, timeField),
      cursor, pageSize
    );
    totalFetched += result.results.length;
    pagesProcessed++;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        const registration = getProp(page, 'Aircraft ID / Registration') || getProp(page, 'Name');
        // Datetime fallback chain: Datetime (UTC) → When → created_time
        const eventTs = getProp(page, 'Datetime (UTC)') || getProp(page, 'When') || page.created_time;
        const altitude = getProp(page, 'Altitude (ft)');
        const description = getProp(page, 'Description');
        const behaviors = getProp(page, 'Behavior') || [];
        const eventCode = getProp(page, 'Event Code');

        const dataStr = [notionId, registration||'', eventTs||'', altitude||'', behaviors.join?.(',') || '', description||''].join('|');
        const sha256 = await computeSHA256(dataStr);

        const res = await sql.unsafe(
          `INSERT INTO flight_events (event_id, registration, detection_timestamp, altitude_feet, zone, event_type, notes, detection_method, sha256_hash, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'notion-backfill', $8, NOW())
           ON CONFLICT (event_id) DO NOTHING`,
          [notionId, registration, eventTs, altitude, behaviors[0] || null, eventCode || 'aircraft_event', description, sha256]
        );
        // postgres.js returns count for affected rows
        if (res.count === 0) conflicted++; else inserted++;
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor && pagesProcessed < maxPages);

  console.log(`[aircraft] Done: fetched=${totalFetched} inserted=${inserted} conflicted=${conflicted} errors=${errors.length}`);
  return { source: 'aircraftEventsLog', fetched: totalFetched, inserted, conflicted, errors: errors.length, errorDetails: errors.slice(0, 5), nextCursor: cursor || null, complete: !cursor };
}

// ── Backfill: Evidence File Library ────────────────────────────────────

async function backfillEvidenceFiles(p: BackfillParams): Promise<BackfillResult> {
  const { sql, startDate, endDate, maxPages, pageSize, startCursor, timeField } = p;
  let cursor: string | undefined = startCursor;
  let totalFetched = 0, inserted = 0, conflicted = 0, pagesProcessed = 0;
  const errors: any[] = [];

  do {
    const result = await notionQuery(NOTION_DBS.evidenceFileLibrary, buildTimeFilter(startDate, endDate, timeField), cursor, pageSize);
    totalFetched += result.results.length;
    pagesProcessed++;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        const filename = getProp(page, 'File Name') || getProp(page, 'Name');
        const sha256 = getProp(page, 'SHA-256 Hash');
        const sealed = getProp(page, 'Sealed') || false;
        const parsingStatus = getProp(page, 'Parsing Status');
        const provenance = getProp(page, 'Provenance');
        const jurisdictions = getProp(page, 'Jurisdiction Relevance') || [];
        const caption = getProp(page, 'Caption/Abstract');
        const dataDate = getProp(page, 'Data Date') || page.created_time;
        const fileType = getProp(page, 'Type');

        const chainStr = [notionId, filename||'', sha256||'', dataDate||''].join('|');
        const chainHash = await computeSHA256(chainStr);

        await sql.unsafe(
          `INSERT INTO evidence_files (notion_page_id, filename, sha256_hash, sealed, parsing_status, provenance, jurisdiction_relevance, caption, data_date, file_type, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'notion-backfill')
           ON CONFLICT (notion_page_id) DO UPDATE SET
             filename = EXCLUDED.filename, sha256_hash = EXCLUDED.sha256_hash,
             sealed = EXCLUDED.sealed, parsing_status = EXCLUDED.parsing_status,
             updated_at = NOW()`,
          [notionId, filename, sha256 || chainHash, sealed, parsingStatus || '1-To Parse', provenance, jurisdictions.length > 0 ? jurisdictions : null, caption, dataDate, fileType]
        );
        inserted++;
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor && pagesProcessed < maxPages);

  return { source: 'evidenceFileLibrary', fetched: totalFetched, inserted, conflicted, errors: errors.length, errorDetails: errors.slice(0, 5), nextCursor: cursor || null, complete: !cursor };
}

// ── Backfill: Legal Evidence Matrix ────────────────────────────────────

async function backfillLegalMatrix(p: BackfillParams): Promise<BackfillResult> {
  const { sql, startDate, endDate, maxPages, pageSize, startCursor, timeField } = p;
  let cursor: string | undefined = startCursor;
  let totalFetched = 0, inserted = 0, conflicted = 0, pagesProcessed = 0;
  const errors: any[] = [];

  do {
    const result = await notionQuery(NOTION_DBS.legalEvidenceMatrix, buildTimeFilter(startDate, endDate, timeField), cursor, pageSize);
    totalFetched += result.results.length;
    pagesProcessed++;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        const alertType = getProp(page, 'alert_type');
        const severity = getProp(page, 'severity');
        const description = getProp(page, 'description');
        const flightId = getProp(page, 'flight_id');
        const title = getProp(page, 'id') || getProp(page, 'Name');

        const dataStr = [notionId, alertType||'', description||'', severity||''].join('|');
        const sha256 = await computeSHA256(dataStr);

        const res = await sql.unsafe(
          `INSERT INTO legal_evidence_matrix (notion_page_id, exhibit_id, evidence_type, description, severity, source, sha256_hash)
           VALUES ($1, $2, $3, $4, $5, 'notion-backfill', $6)
           ON CONFLICT (notion_page_id) DO NOTHING`,
          [notionId, title || flightId, alertType, description, severity, sha256]
        );
        if (res.count === 0) conflicted++; else inserted++;
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor && pagesProcessed < maxPages);

  return { source: 'legalEvidenceMatrix', fetched: totalFetched, inserted, conflicted, errors: errors.length, errorDetails: errors.slice(0, 5), nextCursor: cursor || null, complete: !cursor };
}

// ── Backfill: LEO Military Events ──────────────────────────────────────

async function backfillLEOEvents(p: BackfillParams): Promise<BackfillResult> {
  const { sql, startDate, endDate, maxPages, pageSize, startCursor, timeField } = p;
  let cursor: string | undefined = startCursor;
  let totalFetched = 0, inserted = 0, conflicted = 0, pagesProcessed = 0;
  const errors: any[] = [];

  do {
    const result = await notionQuery(NOTION_DBS.leoMilitaryEventLog, buildTimeFilter(startDate, endDate, timeField), cursor, pageSize);
    totalFetched += result.results.length;
    pagesProcessed++;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        const name = getProp(page, 'Name');
        const eventTs = getProp(page, 'Date') || getProp(page, 'When') || page.created_time;

        const dataStr = [notionId, name||'', eventTs].join('|');
        const sha256 = await computeSHA256(dataStr);

        const res = await sql.unsafe(
          `INSERT INTO leo_military_events (notion_page_id, description, event_timestamp, source, sha256_hash)
           VALUES ($1, $2, $3, 'notion-backfill', $4)
           ON CONFLICT (notion_page_id) DO NOTHING`,
          [notionId, name, eventTs, sha256]
        );
        if (res.count === 0) conflicted++; else inserted++;
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor && pagesProcessed < maxPages);

  return { source: 'leoMilitaryEventLog', fetched: totalFetched, inserted, conflicted, errors: errors.length, errorDetails: errors.slice(0, 5), nextCursor: cursor || null, complete: !cursor };
}

// ── Backfill: Forensic Evidence CSV ────────────────────────────────────

async function backfillForensicEvidence(p: BackfillParams): Promise<BackfillResult> {
  const { sql, startDate, endDate, maxPages, pageSize, startCursor, timeField } = p;
  let cursor: string | undefined = startCursor;
  let totalFetched = 0, inserted = 0, conflicted = 0, pagesProcessed = 0;
  const errors: any[] = [];

  do {
    const result = await notionQuery(NOTION_DBS.forensicEvidenceCSV, buildTimeFilter(startDate, endDate, timeField), cursor, pageSize);
    totalFetched += result.results.length;
    pagesProcessed++;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        const props: Record<string, any> = {};
        for (const [key] of Object.entries(page.properties || {})) {
          props[key] = getProp(page, key);
        }

        const title = props['Name'] || props['title'] || props['File Name'] || `forensic-${notionId.slice(0,8)}`;
        const dataStr = JSON.stringify(props);
        const sha256 = await computeSHA256(dataStr);

        const res = await sql.unsafe(
          `INSERT INTO evidence_files (notion_page_id, filename, sha256_hash, source, created_at)
           VALUES ($1, $2, $3, 'notion-backfill-forensic', NOW())
           ON CONFLICT (notion_page_id) DO NOTHING`,
          [notionId, title, sha256]
        );
        if (res.count === 0) conflicted++; else inserted++;
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor && pagesProcessed < maxPages);

  return { source: 'forensicEvidenceCSV', fetched: totalFetched, inserted, conflicted, errors: errors.length, errorDetails: errors.slice(0, 5), nextCursor: cursor || null, complete: !cursor };
}

// ── Backfill: Live Flight Detections ───────────────────────────────────

async function backfillLiveFlightDetections(p: BackfillParams): Promise<BackfillResult> {
  const { sql, startDate, endDate, maxPages, pageSize, startCursor, timeField } = p;
  let cursor: string | undefined = startCursor;
  let totalFetched = 0, inserted = 0, conflicted = 0, pagesProcessed = 0;
  const errors: any[] = [];

  do {
    const result = await notionQuery(NOTION_DBS.liveFlightDetections, buildTimeFilter(startDate, endDate, timeField), cursor, pageSize);
    totalFetched += result.results.length;
    pagesProcessed++;

    for (const page of result.results) {
      try {
        const notionId = page.id;
        const props: Record<string, any> = {};
        for (const [key] of Object.entries(page.properties || {})) {
          props[key] = getProp(page, key);
        }

        const registration = props['registration'] || props['Name'] || props['title'];
        if (!registration) { conflicted++; continue; }

        const eventTs = props['detection_timestamp'] || props['When'] || page.created_time;
        const dataStr = [notionId, registration, eventTs].join('|');
        const sha256 = await computeSHA256(dataStr);

        const res = await sql.unsafe(
          `INSERT INTO flight_events (event_id, registration, detection_timestamp, detection_method, sha256_hash, created_at)
           VALUES ($1, $2, $3, 'notion-backfill-live', $4, NOW())
           ON CONFLICT (event_id) DO NOTHING`,
          [notionId, registration, eventTs, sha256]
        );
        if (res.count === 0) conflicted++; else inserted++;
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor && pagesProcessed < maxPages);

  return { source: 'liveFlightDetections', fetched: totalFetched, inserted, conflicted, errors: errors.length, errorDetails: errors.slice(0, 5), nextCursor: cursor || null, complete: !cursor };
}

// ── Route handler map ──────────────────────────────────────────────────

const BACKFILL_FNS: Record<string, (p: BackfillParams) => Promise<BackfillResult>> = {
  aircraftEventsLog: backfillAircraftEvents,
  evidenceFileLibrary: backfillEvidenceFiles,
  legalEvidenceMatrix: backfillLegalMatrix,
  leoMilitaryEventLog: backfillLEOEvents,
  forensicEvidenceCSV: backfillForensicEvidence,
  liveFlightDetections: backfillLiveFlightDetections,
};

// ── Main handler ────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      action,
      startDate = '2026-01-01',
      endDate = '2026-03-31',
      databases,
      maxPages = 3,
      pageSize = 20,
      cursor: startCursor,
      timeField = 'created_time',
    } = body;

    const NEON_DATABASE_URL = Deno.env.get('NEON_DATABASE_URL');
    if (!NEON_DATABASE_URL) throw new Error('NEON_DATABASE_URL not configured');

    const sql = postgres(NEON_DATABASE_URL, { ssl: 'require', max: 2, idle_timeout: 30, prepare: false });

    // Ensure unique constraints on first run
    await ensureConstraints(sql);

    if (action === 'scan') {
      const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY');
      if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY not configured');

      const counts: Record<string, number> = {};
      const scanErrors: Record<string, string> = {};

      for (const [name, dbId] of Object.entries(NOTION_DBS)) {
        try {
          const res = await notionQuery(dbId, buildTimeFilter(startDate, endDate, timeField as any), undefined, 1);
          // If has_more, there are 2+; if results.length=1 and !has_more, exactly 1; etc
          counts[name] = res.results.length + (res.has_more ? 999 : 0); // 999+ means "many"
        } catch (e) {
          counts[name] = -1;
          scanErrors[name] = (e as Error).message;
        }
      }

      await sql.end();
      return new Response(JSON.stringify({ success: true, action: 'scan', dateRange: { start: startDate, end: endDate }, timeField, counts, scanErrors }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'backfill') {
      const targetDbs = databases || Object.keys(BACKFILL_FNS);
      const results: BackfillResult[] = [];

      for (const db of targetDbs) {
        const fn = BACKFILL_FNS[db];
        if (!fn) { results.push({ source: db, fetched: 0, inserted: 0, conflicted: 0, errors: 1, errorDetails: [{ error: `Unknown database: ${db}` }], nextCursor: null, complete: true }); continue; }

        try {
          results.push(await fn({
            sql, startDate, endDate,
            maxPages, pageSize,
            startCursor: startCursor,
            timeField: timeField as any,
          }));
        } catch (e) {
          results.push({ source: db, fetched: 0, inserted: 0, conflicted: 0, errors: 1, errorDetails: [{ error: (e as Error).message }], nextCursor: null, complete: true });
        }
      }

      await sql.end();

      const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
      const totalFetched = results.reduce((s, r) => s + r.fetched, 0);
      const totalConflicted = results.reduce((s, r) => s + r.conflicted, 0);
      const allComplete = results.every(r => r.complete);

      return new Response(JSON.stringify({
        success: true, action: 'backfill',
        dateRange: { start: startDate, end: endDate }, timeField,
        totalFetched, totalInserted, totalConflicted, allComplete,
        databases: results,
        message: `Backfilled ${totalInserted} records (${totalConflicted} conflicts) from ${totalFetched} pages`
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
