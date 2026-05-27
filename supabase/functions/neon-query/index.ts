import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
// All handlers lazy-loaded to avoid BOOT_ERROR from combined file size exceeding Deno parse limits
let _handleAction: ((action: string, body: Record<string, any>, sql: any) => Promise<unknown>) | null = null;
let _handleAction2: ((action: string, body: Record<string, any>, sql: any) => Promise<unknown>) | null = null;
let _handleAction3: ((action: string, body: Record<string, any>, sql: any) => Promise<unknown>) | null = null;
let _handleAction4: ((action: string, body: Record<string, any>, sql: any) => Promise<unknown>) | null = null;
let _handleAction5: ((action: string, body: Record<string, any>, sql: any) => Promise<unknown>) | null = null;
let _handleAction6: ((action: string, body: Record<string, any>, sql: any) => Promise<unknown>) | null = null;
let _handleAction7: ((action: string, body: Record<string, any>, sql: any) => Promise<unknown>) | null = null;
let _handleAction8: ((action: string, body: Record<string, any>, sql: any) => Promise<unknown>) | null = null;

const HANDLER1_ACTIONS = new Set([
  'getBehavioralAlignment',
  'computeBehavioralAlignment',
  'createBehavioralAlignmentTable',
  'getMedicalBehavioralAlignment',
  'computeMedicalBehavioralAlignment',
  'createMedicalBehavioralAlignmentTable',
  'getMilitaryGovBehavioralAlignment',
  'computeMilitaryGovBehavioralAlignment',
  'createMilitaryGovBehavioralAlignmentTable',
  'provenanceAudit',
  'sealSyntheticData',
  'getDataProvenanceBreakdown',
  'disableAutoTagger',
  'retroactiveFlagging',
  'biometricCollisionCheck',
  'getValidatedXXB',
  'crossModalStitch',
  'crossModalStitchSummary',
]);

const HANDLER2_ACTIONS = new Set([
  'analyzeSaturation',
  'getMultimodalCoverage',
  'getFullTimelineStories',
  'getDataCoverageStats',
  'createPerformanceIndexes',
  'syncKcsoFleet',
  'importKCSOBudgetData',
  'getUnmaskHQData',
  'getUnmaskHQLandingTrails',
  'c2014CohortScan',
  'operatorEnrichment',
  'xxbFlightAnalysis',
  'getTopFlaggedAircraft',
  'getAnomalousHexCodes',
  'fixIcaoColumnMapping',
  'fixColumnDrift',
  'getAircraftTrajectory',
  'getAltitudeViolations',
  'getViolationAircraft',
]);

const HANDLER3_ACTIONS = new Set([
  'getDashboardCounts',
  'getDataSourceStatus',
  'getLegalAnalysisStats',
  'getFederalCaseConvergence',
  'backfillIcaoCodes',
  'scanAllTables',
  'getTaxonomy',
  'taxonomyStats',
  'getEnterpriseProfiles',
  'getKCSOBudgetData',
  'getUnfilteredStats',
  'bridgeTaxonomy',
  'getGhostAircraftReport',
  'anonymousAnomalyScan',
  'getInvestigationConfig',
  'getTableCategories',
  'spoofDetectionScan',
  'droneInvestigationScan',
  'layeredDeceptionScan',
]);

const HANDLER4_ACTIONS = new Set([
  'transponderModeAnalysis',
  'ghostFleetScore',
  'transponderModeSwitching',
  'icaoRecyclingScan',
  'chronoTimelineScan',
  'chronoTimelineRebuild',
  'chronoTimelineSummary',
  'posseComitatus',
  'upsertFAARecords',
  'getFAARegistry',
  'ifrSurveillanceDetection',
  'icaoIdentityCleanup',
  'ghostAircraftForensics',
]);

const HANDLER5_ACTIONS = new Set([
  'schemaCatalog',
  'schemaTablePreview',
  'schemaRelationshipMap',
  'schemaSearch',
  'ensureDroneTables',
  'droneRFScan',
  'insertDroneRF',
  'ghostToDroneCorrelation',
  'denverLogisticsScan',
  'launchRecoveryPoints',
  'schemaFragmentationAnalysis',
]);

const HANDLER6_ACTIONS = new Set([
  'squawkDeceptionAnalysis',
  'addSquawkColumn',
  'backfillSquawk',
  'mlAnomalyScore',
  'tulareCountyScan',
  'kcsoHexCrossRef',
  'airMethodsISRAnalysis',
]);

const HANDLER7_ACTIONS = new Set([
  'fullArchiveCensus',
  'crossDomainQuery',
  'dropVectorTables',
]);

const HANDLER8_ACTIONS = new Set([
  'getKernCountyFlights',
  'unifiedFlightQuery',
  'getFlaggedAircraftData',
  'cleanupNullDetections',
  'getIngestionStats',
  'quarantineMergePrecheck',
  'quarantineMergeShadow',
  'quarantineMergeValidate',
  'quarantineMergeSwap',
  'getMilitaryAircraft',
  'getCanadianCorridor',
  'biometricOCRAudit',
  'reprocessBiometricOCR',
  'flightAnomalyScan',
  'obfuscationDetectionMatrix',
  'zeroFootClassification',
  'nightOpsAnomalyScan',
  'shellOperatorUnmask',
  'openFieldStaging',
  'kcsoCoordinationCheck',
  'enrichedAircraftIntelligence',
  'aircraftMasterProfile',
  'darkOpsComparison',
  'airMethodsFleet',
  'buildEnrichedDetections',
  'buildAircraftMasterProfile',
  'getUnificationStatus',
  'skyTimelineCorrelator',
  'militaryHexAnalysis',
]);

async function getHandler1() {
  if (!_handleAction) { const mod = await import("./handlers.ts"); _handleAction = mod.handleAction; }
  return _handleAction;
}
async function getHandler2() {
  if (!_handleAction2) { const mod = await import("./handlers2.ts"); _handleAction2 = mod.handleAction2; }
  return _handleAction2;
}
async function getHandler3() {
  if (!_handleAction3) { const mod = await import("./handlers3.ts"); _handleAction3 = mod.handleAction3; }
  return _handleAction3;
}
async function getHandler4() {
  if (!_handleAction4) { const mod = await import("./handlers4.ts"); _handleAction4 = mod.handleAction4; }
  return _handleAction4;
}
async function getHandler5() {
  if (!_handleAction5) { const mod = await import("./handlers5.ts"); _handleAction5 = mod.handleAction5; }
  return _handleAction5;
}
async function getHandler6() {
  if (!_handleAction6) { const mod = await import("./handlers6.ts"); _handleAction6 = mod.handleAction6; }
  return _handleAction6;
}
async function getHandler7() {
  if (!_handleAction7) { const mod = await import("./handlers7.ts"); _handleAction7 = mod.handleAction7; }
  return _handleAction7;
}
// Handler8 lives in sibling edge function `neon-query-h8` to keep this
// function's parse size small. We proxy via HTTP rather than dynamic import.
async function getHandler8() {
  if (_handleAction8) return _handleAction8;
  _handleAction8 = async (action: string, body: Record<string, any>, _sql: any) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl) throw new Error('SUPABASE_URL not configured for sibling proxy');
    const res = await fetch(`${supabaseUrl}/functions/v1/neon-query-h8`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
        'apikey': anonKey,
      },
      body: JSON.stringify({ ...body, action }),
    });
    const text = await res.text();
    let parsed: any;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: text }; }
    if (!res.ok) throw new Error(parsed?.error || `neon-query-h8 returned ${res.status}`);
    return parsed;
  };
  return _handleAction8;
}

const VERSION = "2.13.0";
console.log(`neon-query v${VERSION} booting...`);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

let _sql: ReturnType<typeof postgres> | null = null;
let _sqlReady: Promise<ReturnType<typeof postgres>> | null = null;

function getConnection(): Promise<ReturnType<typeof postgres>> {
  if (_sql) return Promise.resolve(_sql);
  if (_sqlReady) return _sqlReady;

  _sqlReady = (async () => {
    const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
    if (!databaseUrl) throw new Error('Database connection not configured');

    const url = new URL(databaseUrl);
    url.searchParams.set('sslmode', 'require');

    const sql = postgres(url.toString(), {
      ssl: { rejectUnauthorized: false },
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      fetch_types: false,
      prepare: false,
      connection: {
        application_name: 'neon-query-edge-v' + VERSION,
        statement_timeout: 25000,
      },
      onnotice: () => {},
      debug: false,
      transform: { undefined: null },
    });

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const testPromise = sql`SELECT 1 as connected`;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection test timeout after 15s')), 15000)
        );
        await Promise.race([testPromise, timeoutPromise]);
        console.log(`Database connected successfully on attempt ${attempt}`);
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        console.log(`Connection attempt ${attempt} failed, retrying...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    _sql = sql;
    return sql;
  })().catch((err) => {
    _sqlReady = null;
    _sql = null;
    throw err;
  });

  return _sqlReady;
}

Deno.serve(async (req) => {
  try {
    console.log(`neon-query v${VERSION} handling request: ${req.method}`);
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (!Deno.env.get('NEON_DATABASE_URL')) {
      return new Response(JSON.stringify({ error: 'Database connection not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    try {
      let body: Record<string, any> = {};
      try {
        const text = await req.text();
        if (text && text.trim()) body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { table, limit = 100, offset = 0, query, data, where } = body;
      const actionRaw = body.action;
      const action = (typeof actionRaw === 'string' && actionRaw.trim().length > 0)
        ? actionRaw
        : (typeof query === 'string' && query.trim().length > 0 ? 'customQuery' : undefined);

      if (action === 'ping') {
        return new Response(JSON.stringify({ status: 'ok', version: VERSION, timestamp: new Date().toISOString() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (!action || typeof action !== 'string') {
        return new Response(JSON.stringify({ error: 'Missing required field: action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const sql = await getConnection();
      let result: unknown;

      // Hard request budget: ensure we always reply before the platform's
      // 150s IDLE_TIMEOUT so the client gets a parseable JSON error instead
      // of a 504 BOOT/IDLE crash. 120s leaves ~30s headroom.
      const REQUEST_BUDGET_MS = 120000;
      let budgetTimer: number | undefined;
      const budgetPromise = new Promise<never>((_, reject) => {
        budgetTimer = setTimeout(
          () => reject(new Error(`Request exceeded ${REQUEST_BUDGET_MS / 1000}s budget for action="${action}"`)),
          REQUEST_BUDGET_MS,
        ) as unknown as number;
      });
      const clearBudget = () => { if (budgetTimer !== undefined) clearTimeout(budgetTimer); };


      const work = (async () => {
      switch (action) {

        case 'getTables': {
          result = await sql`
            SELECT n.nspname as schemaname, c.relname as tablename, c.reltuples::bigint as row_count
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
            ORDER BY c.reltuples DESC LIMIT 500
          `;
          break;
        }

        case 'getTableData': {
          if (!table) throw new Error('Table name is required');
          const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
          result = await sql.unsafe(`SELECT * FROM ${safeTable} LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`);
          break;
        }

        case 'getTableSchema': {
          if (!table) throw new Error('Table name is required');
          result = await sql`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = ${table} ORDER BY ordinal_position`;
          break;
        }

        case 'entityCanonicalIndex': {
          // Phase 1: Canonical entity index across high-value tables.
          // Each candidate: {table, idCol, tsCol, type}. We probe schema first,
          // then UNION ALL aggregated counts. Keep result <= 5000 rows.
          const candidates: { table: string; idCol: string; tsCol: string | null; type: string }[] = [
            { table: 'confirmed_biometric_correlations', idCol: 'aircraft_id', tsCol: 'event_timestamp', type: 'aircraft_id' },
            { table: 'confirmed_biometric_correlations', idCol: 'registration', tsCol: 'event_timestamp', type: 'aircraft_id' },
            { table: 'exhibit_d_biometric_harm',          idCol: 'aircraft_id', tsCol: 'event_timestamp', type: 'aircraft_id' },
            { table: 'exhibit_d_biometric_harm',          idCol: 'registration', tsCol: 'event_timestamp', type: 'aircraft_id' },
            { table: 'alert_logs',                        idCol: 'icao24',      tsCol: 'created_at',     type: 'aircraft_icao24' },
            { table: 'alert_logs',                        idCol: 'aircraft_id', tsCol: 'created_at',     type: 'aircraft_id' },
            { table: 'alert_logs',                        idCol: 'registration', tsCol: 'created_at',    type: 'aircraft_id' },
            { table: 'alert_logs',                        idCol: 'callsign',    tsCol: 'created_at',     type: 'aircraft_callsign' },
            { table: 'flight_events',                     idCol: 'registration', tsCol: 'event_timestamp', type: 'aircraft_id' },
            { table: 'flight_events',                     idCol: 'icao24',      tsCol: 'event_timestamp', type: 'aircraft_icao24' },
            { table: 'flight_events',                     idCol: 'callsign',    tsCol: 'event_timestamp', type: 'aircraft_callsign' },
          ];

          // Probe which (table, col) pairs actually exist
          const tableNames = Array.from(new Set(candidates.map(c => c.table)));
          const tableList = tableNames.map(t => `'${t.replace(/'/g, "''")}'`).join(",");
          const colExists = await sql.unsafe(`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name IN (${tableList})
          `);
          const have = new Set((colExists as any[]).map(r => `${r.table_name}.${r.column_name}`));

          const minOcc = Number(body.min_occurrences ?? 5);
          const limit = Math.min(Number(body.limit ?? 5000), 10000);
          const parts: string[] = [];
          for (const c of candidates) {
            if (!have.has(`${c.table}.${c.idCol}`)) continue;
            const tsExpr = c.tsCol && have.has(`${c.table}.${c.tsCol}`) ? `MAX(("${c.tsCol}")::timestamptz)` : `NULL::timestamptz`;
            parts.push(`
              SELECT
                '${c.type}'::text                            AS type,
                "${c.idCol}"::text                            AS canonical_value,
                '${c.table}'::text                            AS source_table,
                COUNT(*)::bigint                              AS occurrences,
                ${tsExpr}                                     AS last_seen
              FROM "${c.table}"
              WHERE "${c.idCol}" IS NOT NULL AND "${c.idCol}"::text <> ''
              GROUP BY "${c.idCol}"
              HAVING COUNT(*) >= ${minOcc}
            `);
          }
          if (parts.length === 0) {
            result = { rows: [], probed: candidates.length, sources_available: 0 };
            break;
          }
          const unionSql = `
            WITH agg AS (${parts.join(' UNION ALL ')})
            SELECT type, canonical_value, source_table, occurrences, last_seen
            FROM agg
            ORDER BY occurrences DESC
            LIMIT ${limit}
          `;
          const rows = await sql.unsafe(unionSql);
          result = {
            rows,
            probed: candidates.length,
            sources_available: parts.length,
            generated_at: new Date().toISOString(),
          };
          break;
        }

        case 'getStats': {
          const tables = await sql`SELECT COUNT(*) as table_count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`;
          const records = await sql`SELECT COALESCE(SUM(c.reltuples)::bigint, 0) as total_records FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`;
          result = { tableCount: parseInt((tables[0] as any)?.table_count || '0'), totalRecords: parseInt((records[0] as any)?.total_records || '0') };
          break;
        }

        case 'customQuery': {
          if (!query) throw new Error('Query is required');
          const normalizedQuery = query.trim().toUpperCase();
          const isSelectQuery = normalizedQuery.startsWith('SELECT') || normalizedQuery.startsWith('WITH');
          const hasDangerousKeywords = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i.test(query);
          if (!isSelectQuery || hasDangerousKeywords) throw new Error('Only SELECT queries are allowed');
          try {
            result = await sql.unsafe(query);
          } catch (e) {
            const err = e as any;
            console.warn('customQuery non-fatal database error:', { code: String(err?.code || ''), message: String(err?.message || 'Query failed') });
            result = { data: [], nonFatal: true, code: String(err?.code || ''), error: String(err?.message || 'Query failed') };
          }
          break;
        }

        case 'buildRelationships': {
          // Create registry table if not exists
          await sql.unsafe(`CREATE TABLE IF NOT EXISTS table_relationships (
            id SERIAL PRIMARY KEY, source_table TEXT NOT NULL, source_column TEXT NOT NULL,
            target_table TEXT NOT NULL, target_column TEXT NOT NULL,
            relationship_type TEXT DEFAULT 'inferred', join_key_type TEXT DEFAULT 'registration',
            confidence TEXT DEFAULT 'high', domain TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(source_table, source_column, target_table, target_column)
          )`);
          // Clear and rebuild
          await sql.unsafe(`DELETE FROM table_relationships WHERE 1=1`);

          const joinKeys = [
            { col: 'registration', master: 'live_flight_detections_rows', masterCol: 'registration', key: 'registration', domain: 'flight' },
            { col: 'aircraft_registration', master: 'live_flight_detections_rows', masterCol: 'registration', key: 'registration', domain: 'biometric_flight' },
            { col: 'callsign', master: 'live_flight_detections_rows', masterCol: 'callsign', key: 'callsign', domain: 'flight' },
            { col: 'hex', master: 'live_flight_detections_rows', masterCol: 'hex', key: 'hex_icao', domain: 'flight' },
            { col: 'icao_hex', master: 'live_flight_detections_rows', masterCol: 'icao_code', key: 'hex_icao', domain: 'flight' },
            { col: 'icao24', master: 'live_flight_detections_rows', masterCol: 'icao24', key: 'hex_icao', domain: 'flight' },
            { col: 'icao_code', master: 'live_flight_detections_rows', masterCol: 'icao_code', key: 'hex_icao', domain: 'flight' },
            { col: 'n_number', master: 'aircraft_registry', masterCol: 'n_number', key: 'n_number', domain: 'registry' },
            { col: 'tail_number', master: 'kcso_fleet', masterCol: 'tail_number', key: 'tail_number', domain: 'kcso' },
            { col: 'case_id', master: 'cases', masterCol: 'id', key: 'case_id', domain: 'legal' },
            { col: 'exhibit_id', master: 'exhibits', masterCol: 'id', key: 'exhibit_id', domain: 'legal' },
            { col: 'entity_id', master: 'entity_registry', masterCol: 'entity_id', key: 'entity_id', domain: 'entity' },
            { col: 'forensic_event_id', master: 'master_forensic_events', masterCol: 'forensic_event_id', key: 'forensic_event', domain: 'forensic' },
          ];

          let totalLinks = 0;
          for (const jk of joinKeys) {
            try {
              const tables = await sql.unsafe(`SELECT table_name FROM information_schema.columns WHERE column_name = '${jk.col}' AND table_schema = 'public' ORDER BY table_name`);
              const filtered = (tables as any[]).filter((t: any) => t.table_name !== jk.master);
              for (let i = 0; i < filtered.length; i += 30) {
                const batch = filtered.slice(i, i + 30);
                const values = batch.map((t: any) =>
                  `('${t.table_name}','${jk.col}','${jk.master}','${jk.masterCol}','inferred','${jk.key}','high','${jk.domain}')`
                ).join(',');
                if (values) {
                  await sql.unsafe(`INSERT INTO table_relationships (source_table,source_column,target_table,target_column,relationship_type,join_key_type,confidence,domain) VALUES ${values} ON CONFLICT DO NOTHING`);
                }
                totalLinks += batch.length;
              }
            } catch (e) { console.warn(`Failed mapping ${jk.col}:`, e); }
          }

          const countResult = await sql.unsafe(`SELECT COUNT(*)::int as cnt FROM table_relationships`);
          const domainSummary = await sql.unsafe(`SELECT domain, COUNT(*)::int as cnt FROM table_relationships GROUP BY domain ORDER BY cnt DESC`);
          const keySummary = await sql.unsafe(`SELECT join_key_type, COUNT(*)::int as cnt FROM table_relationships GROUP BY join_key_type ORDER BY cnt DESC`);

          result = {
            totalLinks: (countResult as any[])[0]?.cnt || totalLinks,
            byDomain: domainSummary,
            byJoinKey: keySummary,
            message: `Successfully mapped ${totalLinks} relationships`
          };
          break;
        }

        case 'getRelationships': {
          const domainFilter = body.domain;
          const keyFilter = body.joinKeyType;
          let whereClause = 'WHERE 1=1';
          if (domainFilter) whereClause += ` AND domain = '${String(domainFilter).replace(/'/g,'')}'`;
          if (keyFilter) whereClause += ` AND join_key_type = '${String(keyFilter).replace(/'/g,'')}'`;

          try {
            const relationships = await sql.unsafe(`SELECT * FROM table_relationships ${whereClause} ORDER BY domain, join_key_type, source_table LIMIT 500`);
            const summary = await sql.unsafe(`SELECT domain, join_key_type, COUNT(*)::int as cnt FROM table_relationships GROUP BY domain, join_key_type ORDER BY cnt DESC`);
            const total = await sql.unsafe(`SELECT COUNT(*)::int as cnt FROM table_relationships`);
            result = { relationships, summary, total: (total as any[])[0]?.cnt || 0 };
          } catch (e) {
            result = { relationships: [], summary: [], total: 0, error: 'Table not built yet - run Build Relationships first' };
          }
          break;
        }

        case 'applyForeignKey': {
          const { sourceTable, sourceColumn, targetTable, targetColumn } = body;
          if (!sourceTable || !sourceColumn || !targetTable || !targetColumn) {
            throw new Error('sourceTable, sourceColumn, targetTable, targetColumn are required');
          }
          const safe = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '');
          const st = safe(sourceTable), sc = safe(sourceColumn), tt = safe(targetTable), tc = safe(targetColumn);
          const fkName = `fk_${st}_${sc}_${tt}`.substring(0, 63);

          // Validate both tables/columns exist
          const srcCheck = await sql.unsafe(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${st}' AND column_name='${sc}' LIMIT 1`);
          const tgtCheck = await sql.unsafe(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${tt}' AND column_name='${tc}' LIMIT 1`);
          if ((srcCheck as any[]).length === 0) throw new Error(`Column ${sc} not found in ${st}`);
          if ((tgtCheck as any[]).length === 0) throw new Error(`Column ${tc} not found in ${tt}`);

          // Check if target column has a unique constraint (required for FK target)
          const uniqueCheck = await sql.unsafe(`
            SELECT 1 FROM pg_indexes WHERE tablename='${tt}' 
            AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%${tc}%' LIMIT 1
          `);
          const pkCheck = await sql.unsafe(`
            SELECT 1 FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
            WHERE tc.table_name='${tt}' AND ccu.column_name='${tc}' AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
          `);

          if ((uniqueCheck as any[]).length === 0 && (pkCheck as any[]).length === 0) {
            // Create unique index on target column first
            try {
              await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${tt}_${tc}_uniq ON ${tt} (${tc})`);
            } catch (ixErr) {
              throw new Error(`Cannot create FK: target column ${tt}.${tc} has duplicate values and cannot be made unique`);
            }
          }

          // Clean orphaned rows (set to null where source value doesn't exist in target)
          const orphanCount = await sql.unsafe(`
            SELECT COUNT(*)::int as cnt FROM ${st} s 
            WHERE s.${sc} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${tt} t WHERE t.${tc} = s.${sc})
          `);
          const orphans = (orphanCount as any[])[0]?.cnt || 0;
          if (orphans > 0) {
            await sql.unsafe(`UPDATE ${st} SET ${sc} = NULL WHERE ${sc} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${tt} t WHERE t.${tc} = ${st}.${sc})`);
          }

          // Create the FK constraint
          await sql.unsafe(`ALTER TABLE ${st} ADD CONSTRAINT ${fkName} FOREIGN KEY (${sc}) REFERENCES ${tt}(${tc}) ON DELETE SET NULL ON UPDATE CASCADE`);

          // Update the registry
          await sql.unsafe(`UPDATE table_relationships SET relationship_type='foreign_key' WHERE source_table='${st}' AND source_column='${sc}' AND target_table='${tt}' AND target_column='${tc}'`);

          result = { success: true, fkName, orphansCleaned: orphans, message: `FK ${fkName} created: ${st}.${sc} → ${tt}.${tc}` };
          break;
        }

        case 'getExistingFKs': {
          result = await sql.unsafe(`
            SELECT tc.constraint_name, kcu.table_name as source_table, kcu.column_name as source_column,
                   ccu.table_name as target_table, ccu.column_name as target_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            ORDER BY tc.constraint_name
          `);
          break;
        }

        case 'removeForeignKey': {
          const { constraintName, tableName } = body;
          if (!constraintName || !tableName) throw new Error('constraintName and tableName required');
          const safeCn = constraintName.replace(/[^a-zA-Z0-9_]/g, '');
          const safeTn = tableName.replace(/[^a-zA-Z0-9_]/g, '');
          await sql.unsafe(`ALTER TABLE ${safeTn} DROP CONSTRAINT IF EXISTS ${safeCn}`);
          result = { success: true, message: `Removed FK ${safeCn} from ${safeTn}` };
          break;
        }

        case 'previewForeignKey': {
          const { sourceTable: pSrc, sourceColumn: pSrcCol, targetTable: pTgt, targetColumn: pTgtCol } = body;
          if (!pSrc || !pSrcCol || !pTgt || !pTgtCol) throw new Error('All params required');
          const s = (v: string) => v.replace(/[^a-zA-Z0-9_]/g, '');
          const srcTotal = await sql.unsafe(`SELECT COUNT(*)::int as cnt FROM ${s(pSrc)} WHERE ${s(pSrcCol)} IS NOT NULL`);
          const orphanPreview = await sql.unsafe(`SELECT COUNT(*)::int as cnt FROM ${s(pSrc)} s WHERE s.${s(pSrcCol)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${s(pTgt)} t WHERE t.${s(pTgtCol)} = s.${s(pSrcCol)})`);
          const tgtUnique = await sql.unsafe(`SELECT COUNT(DISTINCT ${s(pTgtCol)})::int as uniq, COUNT(*)::int as total FROM ${s(pTgt)} WHERE ${s(pTgtCol)} IS NOT NULL`);
          result = {
            sourceRows: (srcTotal as any[])[0]?.cnt || 0,
            orphanRows: (orphanPreview as any[])[0]?.cnt || 0,
            targetUnique: (tgtUnique as any[])[0]?.uniq || 0,
            targetTotal: (tgtUnique as any[])[0]?.total || 0,
            isTargetUnique: (tgtUnique as any[])[0]?.uniq === (tgtUnique as any[])[0]?.total,
          };
          break;
        }

        case 'createIndex': {
          if (!query) throw new Error('Index DDL is required');
          const normalizedDDL = query.trim().toUpperCase();
          if (!normalizedDDL.startsWith('CREATE INDEX') && !normalizedDDL.startsWith('CREATE UNIQUE INDEX')) {
            throw new Error('Only CREATE INDEX statements are allowed');
          }
          result = await sql.unsafe(query);
          break;
        }

        case 'dropTrigger': {
          const triggerName = body.triggerName;
          const triggerTable = body.triggerTable;
          if (!triggerName || !triggerTable) throw new Error('triggerName and triggerTable are required');
          const safeTrigger = triggerName.replace(/[^a-zA-Z0-9_]/g, '');
          const safeTable2 = triggerTable.replace(/[^a-zA-Z0-9_]/g, '');
          result = await sql.unsafe(`DROP TRIGGER IF EXISTS ${safeTrigger} ON ${safeTable2}`);
          break;
        }

        case 'insertRecord': {
          const allowedTables = ['aircraft_registry_enriched','operator_profiles_enriched','criminal_enterprise_command_structure','shell_companies','live_flight_detections_rows','biometric_monitoring','ocr_aircraft_holding_patterns','daily_event_imports','josiah_reflections_rows','pattern_recognition_enriched','legal_findings','forensic_violation_citations','legal_intel_extractions','aircraft_violations','flagged_aircraft_rows_rows'];
          if (!table || !allowedTables.includes(table)) throw new Error(`Insert not allowed for table: ${table}`);
          if (!data || typeof data !== 'object') throw new Error('Data object is required');
          const columns = Object.keys(data);
          const values = Object.values(data) as (string|number|boolean|null)[];
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const columnList = columns.map(c => `"${c.replace(/[^a-zA-Z0-9_]/g, '')}"`).join(', ');
          result = await sql.unsafe(`INSERT INTO ${table} (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING *`, values as postgres.ParameterOrJSON<never>[]);
          break;
        }

        case 'batchInsert': {
          const allowedTables = ['aircraft_registry_enriched','operator_profiles_enriched','shell_companies','live_flight_detections_rows','biometric_monitoring','ocr_aircraft_holding_patterns','daily_event_imports','josiah_reflections_rows','legal_findings','forensic_violation_citations','legal_intel_extractions','aircraft_violations','flagged_aircraft_rows_rows','whoop_biometrics'];
          if (!table || !allowedTables.includes(table)) throw new Error(`Batch insert not allowed for table: ${table}`);
          if (!Array.isArray(data) || data.length === 0) throw new Error('Data array is required');
          const columns = Object.keys(data[0] || {});
          if (columns.length === 0) throw new Error('Data rows must have at least one column');
          const safeColumns = columns.map(c => `"${c.replace(/[^a-zA-Z0-9_]/g, '')}"`);
          const values: (string|number|boolean|null)[] = [];
          const rowsPlaceholders: string[] = [];
          data.forEach((row, rowIndex) => {
            const rowPlaceholders: string[] = [];
            columns.forEach((col, colIndex) => { values.push((row as any)[col] ?? null); rowPlaceholders.push(`$${rowIndex * columns.length + colIndex + 1}`); });
            rowsPlaceholders.push(`(${rowPlaceholders.join(', ')})`);
          });
          const inserted = await sql.unsafe(`INSERT INTO ${table} (${safeColumns.join(', ')}) VALUES ${rowsPlaceholders.join(', ')} ON CONFLICT DO NOTHING`, values as postgres.ParameterOrJSON<never>[]);
          result = { data: { inserted: Array.isArray(inserted) ? inserted.length : data.length } };
          break;
        }

        case 'updateRecord': {
          const allowedUpdateTables = ['aircraft_registry_enriched','operator_profiles_enriched','shell_companies','criminal_enterprise_command_structure','live_flight_detections_rows'];
          if (!table || !allowedUpdateTables.includes(table)) throw new Error(`Update not allowed for table: ${table}`);
          if (!data || typeof data !== 'object' || !where) throw new Error('Data object and where clause are required');
          const setClauses = Object.keys(data).map((col, i) => `"${col.replace(/[^a-zA-Z0-9_]/g, '')}" = $${i + 1}`).join(', ');
          const updateValues = [...Object.values(data), where.value] as (string|number|boolean|null)[];
          const whereClause = `"${where.column.replace(/[^a-zA-Z0-9_]/g, '')}" = $${Object.keys(data).length + 1}`;
          result = await sql.unsafe(`UPDATE ${table} SET ${setClauses} WHERE ${whereClause} RETURNING *`, updateValues as postgres.ParameterOrJSON<never>[]);
          break;
        }

        default: {
          // Route to lazy-loaded handlers
          const handlerMap: [Set<string>, () => Promise<(action: string, body: Record<string, any>, sql: any) => Promise<unknown>>][] = [
            [HANDLER1_ACTIONS, getHandler1],
            [HANDLER2_ACTIONS, getHandler2],
            [HANDLER3_ACTIONS, getHandler3],
            [HANDLER4_ACTIONS, getHandler4],
            [HANDLER5_ACTIONS, getHandler5],
            [HANDLER6_ACTIONS, getHandler6],
            [HANDLER7_ACTIONS, getHandler7],
            [HANDLER8_ACTIONS, getHandler8],
          ];

          let handled = false;
          for (const [actionSet, getHandler] of handlerMap) {
            if (actionSet.has(action)) {
              const handler = await getHandler();
              result = await handler(action, body, sql);
              handled = true;
              break;
            }
          }

          if (!handled) throw new Error(`Unknown action: ${action}`);
          break;
        }
      }
      })();

      try {
        result = await Promise.race([work, budgetPromise]);
      } finally {
        clearBudget();
      }

      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });


    } catch (error) {
      console.error('Neon query error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('Connection') || msg.includes('timeout') || msg.includes('FATAL') || msg.includes('budget')) {
        _sql = null;
        _sqlReady = null;
      }
      const isBudget = msg.includes('exceeded') && msg.includes('budget');
      return new Response(JSON.stringify({ error: msg, code: isBudget ? 'BUDGET_EXCEEDED' : undefined }), { status: isBudget ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

  } catch (outerError) {
    console.error('Outer error:', outerError);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
