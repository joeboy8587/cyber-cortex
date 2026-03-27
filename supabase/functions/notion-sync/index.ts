import "https://deno.land/x/xhr@0.1.0/mod.ts";
import postgres from "npm:postgres@3.4.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── SHA-256 helper ──────────────────────────────────────────────────────
async function computeSHA256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Notion Database IDs ─────────────────────────────────────────────────
const NOTION_DB_IDS = {
  evidenceFileLibrary: 'cf7486ba-2cdd-4773-924e-118c8e64d2f9',
  aircraftEventsLog: '0c3fd946-a8cc-4dd2-9ea8-1c0c58409a28',
  aircraftRegistry: 'c620d75c-7415-4e55-a6a7-240de9f452ab',
  incidentGallery: '7477fa92-eda4-4816-be48-16310e9683ad',
  chartsGallery: '7da4d986-357f-48af-acd1-3592e41aea3d',
  leoMilitaryEventLog: 'eb0962e3-b6c1-4bfc-b511-61e7223f4be0',
  afEventsPeakWindow: 'b91efb00-d1d2-4807-b019-d3d32e68d4d1',
  flightIntelReports: '45c28b62-3954-45d6-bd93-46639841bf1c',
  liveFlightDetections: '29e33a7b-866a-81b9-9bd9-000b9f0fb37f',
  flightAlerts: '29e33a7b-866a-8159-bc03-000b3841520b',
  physioCorrelation: 'ed9a2c91-789a-4f51-9927-0c6604eb54c0',
  csvBiometricLogs: 'ff246bdc-78d8-46c7-99b4-929fb72abd44',
  whoopFlightCorrelations: 'e4c498a4-139e-4344-958c-4451027e5f96',
  legalEvidenceMatrix: '29e33a7b-866a-814a-b67a-000b2b1c36eb',
  exhibitAIndex: '1f65e9ef-9838-4192-b5ca-0a78664361b1',
  josiahCodexApproved: '1fa24b9b-9ef8-4f18-93ef-c129ab2c7b7b',
  josiahArchive: '29e33a7b-866a-8159-bc03-000b3841520b',
  forensicEvidenceCSV: '29e33a7b-866a-81a9-929d-00026f770794',
  csvSupabaseImport: '29e33a7b-866a-814a-b94d-00026f770794',
};

// ── Singleton connection ────────────────────────────────────────────────
let _sql: ReturnType<typeof postgres> | null = null;

function getConnection(): ReturnType<typeof postgres> {
  if (_sql) return _sql;
  const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
  if (!databaseUrl) throw new Error('Database connection not configured');
  _sql = postgres(databaseUrl, { ssl: 'require', max: 2, idle_timeout: 30, prepare: false });
  return _sql;
}

// ── Table creation ──────────────────────────────────────────────────────
async function ensureNotionTables(sql: ReturnType<typeof postgres>) {
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
    );
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
    );
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
    );
  `);
}

// ── Handlers ────────────────────────────────────────────────────────────

async function handleSyncWTPREvents(sql: ReturnType<typeof postgres>, events: any[]) {
  if (!events || !Array.isArray(events)) throw new Error('Events array required');
  const inserted: string[] = [];
  const skipped: string[] = [];
  const errors: { event: string; error: string }[] = [];

  for (const event of events) {
    try {
      const existing = await sql`
        SELECT id FROM flight_events 
        WHERE event_id = ${event.event_id} 
        OR (registration = ${event.registration} AND detection_timestamp = ${event.timestamp})
        LIMIT 1
      `;
      if (existing.length > 0) { skipped.push(event.event_id || event.registration); continue; }

      const dataString = [event.event_id||'', event.registration||'', event.timestamp||'', event.altitude||'', event.zone||'', event.event_type||'', event.description||'', event.source||'notion'].join('|');
      const sha256_hash = await computeSHA256(dataString);

      await sql`
        INSERT INTO flight_events (event_id, registration, detection_timestamp, altitude_feet, zone, event_type, notes, detection_method, sha256_hash, created_at)
        VALUES (${event.event_id||null}, ${event.registration||null}, ${event.timestamp||null}, ${event.altitude||null}, ${event.zone||null}, ${event.event_type||null}, ${event.description||null}, ${'notion'}, ${sha256_hash}, NOW())
      `;
      inserted.push(event.event_id || event.registration);
    } catch (e) {
      errors.push({ event: event.event_id || event.registration, error: (e as Error).message });
    }
  }
  return { action: 'syncWTPREvents', inserted: inserted.length, skipped: skipped.length, errors: errors.length, insertedEvents: inserted, skippedEvents: skipped, errorDetails: errors, message: `Synced ${inserted.length} WTPR events from Notion (${skipped.length} already existed)` };
}

async function handleSyncJosiahReflections(sql: ReturnType<typeof postgres>, reflections: any[]) {
  if (!reflections || !Array.isArray(reflections)) throw new Error('Reflections array required');
  const inserted: string[] = [];
  const updated: string[] = [];
  const errors: { reflection: string; error: string }[] = [];

  for (const reflection of reflections) {
    try {
      const reflectionId = String(reflection.reflection_id || '').trim();
      if (!reflectionId) throw new Error('reflection_id is required');
      const dataString = [reflectionId, reflection.title||'', reflection.content||'', reflection.reflection_date||'', reflection.category||'', JSON.stringify(reflection.tags||[])].join('|');
      const sha256_hash = await computeSHA256(dataString);

      const existing = await sql`SELECT id FROM josiah_reflections_rows WHERE id = ${reflectionId} LIMIT 1`;
      const mapped = { id: reflectionId, reflection_content: reflection.content||null, trigger_type: reflection.category||null, created_at: reflection.reflection_date||null, source: 'notion', sha256_hash };

      if (existing.length > 0) {
        await sql`UPDATE josiah_reflections_rows SET reflection_content = ${mapped.reflection_content}, trigger_type = ${mapped.trigger_type}, created_at = ${mapped.created_at}, source = ${mapped.source}, sha256_hash = ${mapped.sha256_hash} WHERE id = ${reflectionId}`;
        updated.push(reflectionId);
      } else {
        await sql`INSERT INTO josiah_reflections_rows (id, reflection_content, trigger_type, created_at, source, sha256_hash) VALUES (${mapped.id}, ${mapped.reflection_content}, ${mapped.trigger_type}, ${mapped.created_at}, ${mapped.source}, ${mapped.sha256_hash})`;
        inserted.push(reflectionId);
      }
    } catch (e) {
      errors.push({ reflection: reflection?.reflection_id || 'unknown', error: (e as Error).message });
    }
  }
  return { action: 'syncJosiahReflections', inserted: inserted.length, updated: updated.length, errors: errors.length, message: `Synced ${inserted.length + updated.length} reflections (${inserted.length} new, ${updated.length} updated)` };
}

async function handleSyncEvidenceFiles(sql: ReturnType<typeof postgres>, files: any[]) {
  if (!files || !Array.isArray(files)) throw new Error('Files array required');
  await ensureNotionTables(sql);
  const inserted: string[] = [];
  const updated: string[] = [];
  const errors: { file: string; error: string }[] = [];

  for (const file of files) {
    try {
      const notionPageId = String(file.notion_page_id || file.id || '').trim();
      if (!notionPageId) throw new Error('notion_page_id required');
      const dataString = [notionPageId, file.filename||'', file.sha256_hash||'', file.data_date||'', JSON.stringify(file.tags||[]), file.sealed?'true':'false'].join('|');
      const chainHash = await computeSHA256(dataString);

      const existing = await sql`SELECT id FROM evidence_files WHERE notion_page_id = ${notionPageId} LIMIT 1`;
      if (existing.length > 0) {
        await sql`UPDATE evidence_files SET filename=${file.filename||null}, sha256_hash=${file.sha256_hash||chainHash}, tags=${file.tags||null}, file_type=${file.file_type||null}, data_date=${file.data_date||null}, sealed=${file.sealed||false}, sealed_on=${file.sealed_on||null}, sealed_by=${file.sealed_by||null}, parsing_status=${file.parsing_status||'1-To Parse'}, provenance=${file.provenance||null}, jurisdiction_relevance=${file.jurisdiction_relevance||null}, caption=${file.caption||null}, file_url=${file.file_url||null}, updated_at=NOW() WHERE notion_page_id = ${notionPageId}`;
        updated.push(notionPageId);
      } else {
        await sql`INSERT INTO evidence_files (notion_page_id, filename, sha256_hash, tags, file_type, data_date, sealed, sealed_on, sealed_by, parsing_status, provenance, jurisdiction_relevance, caption, file_url, source) VALUES (${notionPageId}, ${file.filename||null}, ${file.sha256_hash||chainHash}, ${file.tags||null}, ${file.file_type||null}, ${file.data_date||null}, ${file.sealed||false}, ${file.sealed_on||null}, ${file.sealed_by||null}, ${file.parsing_status||'1-To Parse'}, ${file.provenance||null}, ${file.jurisdiction_relevance||null}, ${file.caption||null}, ${file.file_url||null}, ${'notion'})`;
        inserted.push(notionPageId);
      }
    } catch (e) {
      errors.push({ file: file?.filename || file?.id || 'unknown', error: (e as Error).message });
    }
  }
  return { action: 'syncEvidenceFiles', inserted: inserted.length, updated: updated.length, errors: errors.length, message: `Synced ${inserted.length + updated.length} evidence files` };
}

async function handleSyncLegalMatrix(sql: ReturnType<typeof postgres>, entries: any[]) {
  if (!entries || !Array.isArray(entries)) throw new Error('Entries array required');
  await ensureNotionTables(sql);
  const inserted: string[] = [];
  const updated: string[] = [];
  const errors: { entry: string; error: string }[] = [];

  for (const entry of entries) {
    try {
      const notionPageId = String(entry.notion_page_id || entry.id || '').trim();
      if (!notionPageId) throw new Error('notion_page_id required');
      const dataString = [notionPageId, entry.exhibit_id||'', entry.statute||'', entry.evidence_type||'', entry.description||''].join('|');
      const sha256_hash = await computeSHA256(dataString);

      const existing = await sql`SELECT id FROM legal_evidence_matrix WHERE notion_page_id = ${notionPageId} LIMIT 1`;
      if (existing.length > 0) {
        await sql`UPDATE legal_evidence_matrix SET exhibit_id=${entry.exhibit_id||null}, statute=${entry.statute||null}, evidence_type=${entry.evidence_type||null}, description=${entry.description||null}, severity=${entry.severity||null}, linked_aircraft=${entry.linked_aircraft||null}, linked_entities=${entry.linked_entities||null}, rollup_correlations=${JSON.stringify(entry.rollup_correlations||{})}, jurisdiction=${entry.jurisdiction||null}, filing_status=${entry.filing_status||null}, sha256_hash=${sha256_hash}, updated_at=NOW() WHERE notion_page_id = ${notionPageId}`;
        updated.push(notionPageId);
      } else {
        await sql`INSERT INTO legal_evidence_matrix (notion_page_id, exhibit_id, statute, evidence_type, description, severity, linked_aircraft, linked_entities, rollup_correlations, jurisdiction, filing_status, sha256_hash, source) VALUES (${notionPageId}, ${entry.exhibit_id||null}, ${entry.statute||null}, ${entry.evidence_type||null}, ${entry.description||null}, ${entry.severity||null}, ${entry.linked_aircraft||null}, ${entry.linked_entities||null}, ${JSON.stringify(entry.rollup_correlations||{})}, ${entry.jurisdiction||null}, ${entry.filing_status||null}, ${sha256_hash}, ${'notion'})`;
        inserted.push(notionPageId);
      }
    } catch (e) {
      errors.push({ entry: entry?.exhibit_id || entry?.id || 'unknown', error: (e as Error).message });
    }
  }
  return { action: 'syncLegalMatrix', inserted: inserted.length, updated: updated.length, errors: errors.length, message: `Synced ${inserted.length + updated.length} legal evidence entries` };
}

async function handleSyncLEOEvents(sql: ReturnType<typeof postgres>, events: any[]) {
  if (!events || !Array.isArray(events)) throw new Error('Events array required');
  await ensureNotionTables(sql);
  const inserted: string[] = [];
  const updated: string[] = [];
  const errors: { event: string; error: string }[] = [];

  for (const event of events) {
    try {
      const notionPageId = String(event.notion_page_id || event.id || '').trim();
      if (!notionPageId) throw new Error('notion_page_id required');
      const dataString = [notionPageId, event.agency||'', event.event_type||'', event.event_timestamp||'', event.description||''].join('|');
      const sha256_hash = await computeSHA256(dataString);

      const existing = await sql`SELECT id FROM leo_military_events WHERE notion_page_id = ${notionPageId} LIMIT 1`;
      if (existing.length > 0) {
        await sql`UPDATE leo_military_events SET agency=${event.agency||null}, event_type=${event.event_type||null}, event_timestamp=${event.event_timestamp||null}, description=${event.description||null}, location=${event.location||null}, latitude=${event.latitude||null}, longitude=${event.longitude||null}, related_aircraft=${event.related_aircraft||null}, officer_unit=${event.officer_unit||null}, sha256_hash=${sha256_hash}, updated_at=NOW() WHERE notion_page_id = ${notionPageId}`;
        updated.push(notionPageId);
      } else {
        await sql`INSERT INTO leo_military_events (notion_page_id, agency, event_type, event_timestamp, description, location, latitude, longitude, related_aircraft, officer_unit, sha256_hash, source) VALUES (${notionPageId}, ${event.agency||null}, ${event.event_type||null}, ${event.event_timestamp||null}, ${event.description||null}, ${event.location||null}, ${event.latitude||null}, ${event.longitude||null}, ${event.related_aircraft||null}, ${event.officer_unit||null}, ${sha256_hash}, ${'notion'})`;
        inserted.push(notionPageId);
      }
    } catch (e) {
      errors.push({ event: event?.event_type || event?.id || 'unknown', error: (e as Error).message });
    }
  }
  return { action: 'syncLEOEvents', inserted: inserted.length, updated: updated.length, errors: errors.length, message: `Synced ${inserted.length + updated.length} LEO/military events` };
}

async function handleGetGapAnalysis(sql: ReturnType<typeof postgres>) {
  const flightRange = await sql`SELECT MIN(detection_timestamp) as earliest, MAX(detection_timestamp) as latest, COUNT(*) as count FROM flight_events`;
  const reflectionStats = await sql`SELECT MIN(created_at) as earliest, MAX(created_at) as latest, COUNT(*) as count FROM josiah_reflections_rows`;

  // Check new tables exist and get counts
  let evidenceCount = 0, legalCount = 0, leoCount = 0;
  try { const r = await sql`SELECT COUNT(*) as count FROM evidence_files`; evidenceCount = parseInt(r[0]?.count || '0'); } catch { /* table may not exist */ }
  try { const r = await sql`SELECT COUNT(*) as count FROM legal_evidence_matrix`; legalCount = parseInt(r[0]?.count || '0'); } catch { /* table may not exist */ }
  try { const r = await sql`SELECT COUNT(*) as count FROM leo_military_events`; leoCount = parseInt(r[0]?.count || '0'); } catch { /* table may not exist */ }

  return {
    flightEvents: { earliest: flightRange[0]?.earliest, latest: flightRange[0]?.latest, count: parseInt(flightRange[0]?.count || '0') },
    josiahReflections: { earliest: reflectionStats[0]?.earliest, latest: reflectionStats[0]?.latest, count: parseInt(reflectionStats[0]?.count || '0') },
    evidenceFiles: { count: evidenceCount },
    legalMatrix: { count: legalCount },
    leoMilitaryEvents: { count: leoCount },
    notionDatabaseIds: NOTION_DB_IDS,
    message: 'Gap analysis complete'
  };
}

async function handleCreateTables(sql: ReturnType<typeof postgres>) {
  await ensureNotionTables(sql);
  return { message: 'Notion integration tables created/verified', tables: ['evidence_files', 'legal_evidence_matrix', 'leo_military_events'] };
}

async function handleGetSyncStatus(sql: ReturnType<typeof postgres>) {
  const tables = [
    { name: 'flight_events', notionDb: 'aircraftEventsLog' },
    { name: 'josiah_reflections_rows', notionDb: 'josiahArchive' },
    { name: 'evidence_files', notionDb: 'evidenceFileLibrary' },
    { name: 'legal_evidence_matrix', notionDb: 'legalEvidenceMatrix' },
    { name: 'leo_military_events', notionDb: 'leoMilitaryEventLog' },
  ];

  const statuses = [];
  for (const t of tables) {
    try {
      const r = await sql.unsafe(`SELECT COUNT(*) as count, MAX(updated_at) as last_updated FROM ${t.name}`);
      statuses.push({ table: t.name, notionDb: t.notionDb, count: parseInt(r[0]?.count || '0'), lastUpdated: r[0]?.last_updated || null, exists: true });
    } catch {
      statuses.push({ table: t.name, notionDb: t.notionDb, count: 0, lastUpdated: null, exists: false });
    }
  }
  return { statuses, notionDatabaseIds: NOTION_DB_IDS };
}

// ── Main handler ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sql = getConnection();
    const body = await req.json();
    const { action } = body;

    let result;
    switch (action) {
      case 'syncWTPREvents': result = await handleSyncWTPREvents(sql, body.events); break;
      case 'syncJosiahReflections': result = await handleSyncJosiahReflections(sql, body.reflections); break;
      case 'syncEvidenceFiles': result = await handleSyncEvidenceFiles(sql, body.files); break;
      case 'syncLegalMatrix': result = await handleSyncLegalMatrix(sql, body.entries); break;
      case 'syncLEOEvents': result = await handleSyncLEOEvents(sql, body.events); break;
      case 'getGapAnalysis': result = await handleGetGapAnalysis(sql); break;
      case 'createNotionTables': result = await handleCreateTables(sql); break;
      case 'getSyncStatus': result = await handleGetSyncStatus(sql); break;
      default: throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ data: result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const error = err as Error;
    console.error('Notion sync error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
