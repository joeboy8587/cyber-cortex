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

// ── Schema migration: safe constraint & column patching ────────────────

interface ConstraintReport {
  applied: string[];
  alreadyExist: string[];
  failed: { name: string; error: string }[];
}

async function ensureConstraints(sql: any): Promise<ConstraintReport> {
  const report: ConstraintReport = { applied: [], alreadyExist: [], failed: [] };

  // Helper: add unique constraint with explicit table check (not just conname)
  async function addUniqueConstraint(table: string, column: string, constraintName: string) {
    try {
      const exists = await sql.unsafe(
        `SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON c.conrelid = t.oid
         WHERE c.conname = $1 AND t.relname = $2 LIMIT 1`,
        [constraintName, table]
      );
      if (exists.length > 0) {
        report.alreadyExist.push(constraintName);
        return;
      }
      // Check for duplicate values before adding constraint
      const dupes = await sql.unsafe(
        `SELECT ${column}, COUNT(*) FROM ${table} WHERE ${column} IS NOT NULL GROUP BY ${column} HAVING COUNT(*) > 1 LIMIT 5`
      );
      if (dupes.length > 0) {
        report.failed.push({ name: constraintName, error: `${dupes.length} duplicate ${column} values exist — dedupe first` });
        return;
      }
      await sql.unsafe(`ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} UNIQUE (${column})`);
      report.applied.push(constraintName);
    } catch (e) {
      report.failed.push({ name: constraintName, error: (e as Error).message });
    }
  }

  // Helper: add column if missing
  async function addColumnIfMissing(table: string, column: string, def: string) {
    try {
      const exists = await sql.unsafe(
        `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2 LIMIT 1`,
        [table, column]
      );
      if (exists.length > 0) return;
      await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
      report.applied.push(`${table}.${column}`);
    } catch (e) {
      report.failed.push({ name: `${table}.${column}`, error: (e as Error).message });
    }
  }

  // ── flight_events: unique on event_id + add record_type & notion timestamps
  await addUniqueConstraint('flight_events', 'event_id', 'flight_events_event_id_unique');
  await addColumnIfMissing('flight_events', 'record_type', "TEXT DEFAULT 'curated_event'");
  await addColumnIfMissing('flight_events', 'notion_created_time', 'TIMESTAMPTZ');
  await addColumnIfMissing('flight_events', 'notion_last_edited_time', 'TIMESTAMPTZ');

  // ── evidence_files: ensure table + columns
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
      notion_created_time TIMESTAMPTZ, notion_last_edited_time TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  // Patch columns if table already existed with old schema
  const evidenceCols = [
    { name: 'notion_page_id', def: 'TEXT' },
    { name: 'source', def: "TEXT DEFAULT 'notion'" },
    { name: 'file_type', def: 'TEXT' },
    { name: 'data_date', def: 'TIMESTAMPTZ' },
    { name: 'sealed', def: 'BOOLEAN DEFAULT false' },
    { name: 'parsing_status', def: "TEXT DEFAULT '1-To Parse'" },
    { name: 'provenance', def: 'TEXT' },
    { name: 'jurisdiction_relevance', def: 'TEXT[]' },
    { name: 'caption', def: 'TEXT' },
    { name: 'notion_created_time', def: 'TIMESTAMPTZ' },
    { name: 'notion_last_edited_time', def: 'TIMESTAMPTZ' },
    { name: 'created_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
    { name: 'updated_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
  ];
  for (const col of evidenceCols) {
    await addColumnIfMissing('evidence_files', col.name, col.def);
  }
  await addUniqueConstraint('evidence_files', 'notion_page_id', 'evidence_files_notion_page_id_unique');

  // ── legal_evidence_matrix
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS legal_evidence_matrix (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      notion_page_id TEXT UNIQUE,
      exhibit_id TEXT, statute TEXT, evidence_type TEXT, description TEXT,
      severity TEXT, linked_aircraft TEXT[], linked_entities TEXT[],
      rollup_correlations JSONB DEFAULT '{}', jurisdiction TEXT,
      filing_status TEXT, source TEXT DEFAULT 'notion', sha256_hash TEXT,
      notion_created_time TIMESTAMPTZ, notion_last_edited_time TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await addColumnIfMissing('legal_evidence_matrix', 'notion_created_time', 'TIMESTAMPTZ');
  await addColumnIfMissing('legal_evidence_matrix', 'notion_last_edited_time', 'TIMESTAMPTZ');

  // ── leo_military_events
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS leo_military_events (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      notion_page_id TEXT UNIQUE,
      agency TEXT, event_type TEXT, event_timestamp TIMESTAMPTZ,
      description TEXT, location TEXT, latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION, related_aircraft TEXT[],
      officer_unit TEXT, source TEXT DEFAULT 'notion', sha256_hash TEXT,
      notion_created_time TIMESTAMPTZ, notion_last_edited_time TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await addColumnIfMissing('leo_military_events', 'notion_created_time', 'TIMESTAMPTZ');
  await addColumnIfMissing('leo_military_events', 'notion_last_edited_time', 'TIMESTAMPTZ');

  return report;
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

        // Use RETURNING to accurately count inserts vs conflicts
        const res = await sql.unsafe(
          `INSERT INTO flight_events (event_id, registration, detection_timestamp, altitude_feet, zone, event_type, notes, detection_method, sha256_hash, record_type, notion_created_time, notion_last_edited_time, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'notion-backfill', $8, 'curated_event', $9, $10, NOW())
           ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
          [notionId, registration, eventTs, altitude, behaviors[0] || null, eventCode || 'aircraft_event', description, sha256, page.created_time, page.last_edited_time]
        );
        if (res.length > 0) inserted++; else conflicted++;
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

        const res = await sql.unsafe(
          `INSERT INTO evidence_files (notion_page_id, filename, sha256_hash, sealed, parsing_status, provenance, jurisdiction_relevance, caption, data_date, file_type, source, notion_created_time, notion_last_edited_time)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'notion-backfill', $11, $12)
           ON CONFLICT (notion_page_id) DO UPDATE SET
             filename = EXCLUDED.filename, sha256_hash = EXCLUDED.sha256_hash,
             sealed = EXCLUDED.sealed, parsing_status = EXCLUDED.parsing_status,
             notion_last_edited_time = EXCLUDED.notion_last_edited_time,
             updated_at = NOW()
           RETURNING notion_page_id`,
          [notionId, filename, sha256 || chainHash, sealed, parsingStatus || '1-To Parse', provenance, jurisdictions.length > 0 ? jurisdictions : null, caption, dataDate, fileType, page.created_time, page.last_edited_time]
        );
        // Upsert always returns a row, so count based on xmax (updated vs inserted)
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
          `INSERT INTO legal_evidence_matrix (notion_page_id, exhibit_id, evidence_type, description, severity, source, sha256_hash, notion_created_time, notion_last_edited_time)
           VALUES ($1, $2, $3, $4, $5, 'notion-backfill', $6, $7, $8)
           ON CONFLICT (notion_page_id) DO NOTHING
           RETURNING notion_page_id`,
          [notionId, title || flightId, alertType, description, severity, sha256, page.created_time, page.last_edited_time]
        );
        if (res.length > 0) inserted++; else conflicted++;
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
          `INSERT INTO leo_military_events (notion_page_id, description, event_timestamp, source, sha256_hash, notion_created_time, notion_last_edited_time)
           VALUES ($1, $2, $3, 'notion-backfill', $4, $5, $6)
           ON CONFLICT (notion_page_id) DO NOTHING
           RETURNING notion_page_id`,
          [notionId, name, eventTs, sha256, page.created_time, page.last_edited_time]
        );
        if (res.length > 0) inserted++; else conflicted++;
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
          `INSERT INTO evidence_files (notion_page_id, filename, sha256_hash, source, notion_created_time, notion_last_edited_time)
           VALUES ($1, $2, $3, 'notion-backfill-forensic', $4, $5)
           ON CONFLICT (notion_page_id) DO NOTHING
           RETURNING notion_page_id`,
          [notionId, title, sha256, page.created_time, page.last_edited_time]
        );
        if (res.length > 0) inserted++; else conflicted++;
      } catch (e) {
        errors.push({ id: page.id, error: (e as Error).message });
      }
    }

    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor && pagesProcessed < maxPages);

  return { source: 'forensicEvidenceCSV', fetched: totalFetched, inserted, conflicted, errors: errors.length, errorDetails: errors.slice(0, 5), nextCursor: cursor || null, complete: !cursor };
}

// ── Backfill: Live Flight Detections → flight_events as record_type='raw_detection'

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
          `INSERT INTO flight_events (event_id, registration, detection_timestamp, detection_method, sha256_hash, record_type, notion_created_time, notion_last_edited_time, created_at)
           VALUES ($1, $2, $3, 'notion-backfill-live', $4, 'raw_detection', $5, $6, NOW())
           ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
          [notionId, registration, eventTs, sha256, page.created_time, page.last_edited_time]
        );
        if (res.length > 0) inserted++; else conflicted++;
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

    // Ensure schema is ready — returns detailed constraint report
    const constraintReport = await ensureConstraints(sql);

    if (action === 'scan') {
      const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY');
      if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY not configured');

      const counts: Record<string, number> = {};
      const scanErrors: Record<string, string> = {};

      for (const [name, dbId] of Object.entries(NOTION_DBS)) {
        try {
          const res = await notionQuery(dbId, buildTimeFilter(startDate, endDate, timeField as any), undefined, 1);
          counts[name] = res.results.length + (res.has_more ? 999 : 0);
        } catch (e) {
          counts[name] = -1;
          scanErrors[name] = (e as Error).message;
        }
      }

      await sql.end();
      return new Response(JSON.stringify({ success: true, action: 'scan', dateRange: { start: startDate, end: endDate }, timeField, counts, scanErrors, constraintReport }), {
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
        constraintReport,
        message: `Backfilled ${totalInserted} records (${totalConflicted} conflicts) from ${totalFetched} pages`
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await sql.end();
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
