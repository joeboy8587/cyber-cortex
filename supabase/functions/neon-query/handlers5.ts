import postgres from "npm:postgres@3.4.4";

type SQL = ReturnType<typeof postgres>;

export async function handleAction5(action: string, body: Record<string, any>, sql: SQL): Promise<unknown> {
  switch (action) {
    case 'schemaCatalog': {
      // Discover all tables, columns, row counts, and inferred relationships
      await sql`SET statement_timeout = '25s'`;

      const [tables, columns, foreignKeys, rowCounts] = await Promise.all([
        // All tables in public schema
        sql`
          SELECT table_name, table_type
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `,
        // All columns with types
        sql`
          SELECT table_name, column_name, data_type, is_nullable,
                 column_default, ordinal_position
          FROM information_schema.columns
          WHERE table_schema = 'public'
          ORDER BY table_name, ordinal_position
        `,
        // Explicit foreign keys
        sql`
          SELECT
            tc.table_name as source_table,
            kcu.column_name as source_column,
            ccu.table_name as target_table,
            ccu.column_name as target_column,
            tc.constraint_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = 'public'
        `,
        // Fast row count estimates using pg_class
        sql`
          SELECT c.relname as table_name,
                 c.reltuples::bigint as estimated_rows,
                 pg_total_relation_size(c.oid) as total_bytes
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
          ORDER BY c.reltuples DESC
        `
      ]);

      // Build column index for relationship inference
      const columnIndex: Record<string, string[]> = {};
      for (const col of columns) {
        const key = col.column_name as string;
        if (!columnIndex[key]) columnIndex[key] = [];
        columnIndex[key].push(col.table_name as string);
      }

      // Infer implicit relationships by shared column names
      const JOIN_KEYS = [
        'registration', 'icao_code', 'tail_number', 'n_number',
        'hex_id', 'callsign', 'operator', 'entity_id',
        'forensic_event_id', 'session_id', 'user_id',
        'source_id', 'aircraft_id', 'detection_id'
      ];

      const inferredRelationships: Array<{
        column: string;
        tables: string[];
        count: number;
      }> = [];

      for (const key of JOIN_KEYS) {
        if (columnIndex[key] && columnIndex[key].length > 1) {
          inferredRelationships.push({
            column: key,
            tables: columnIndex[key],
            count: columnIndex[key].length,
          });
        }
      }

      // Also find columns that appear in 3+ tables (potential join keys)
      for (const [col, tbls] of Object.entries(columnIndex)) {
        if (tbls.length >= 3 && !JOIN_KEYS.includes(col) &&
            !['id', 'created_at', 'updated_at'].includes(col)) {
          inferredRelationships.push({
            column: col,
            tables: tbls,
            count: tbls.length,
          });
        }
      }

      // Sort inferred by count descending
      inferredRelationships.sort((a, b) => b.count - a.count);

      // Categorize tables
      const categories: Record<string, string[]> = {
        surveillance: [],
        biometric: [],
        legal: [],
        forensic: [],
        agent: [],
        registry: [],
        infrastructure: [],
        other: [],
      };

      for (const t of tables) {
        const name = t.table_name as string;
        if (name.includes('flight') || name.includes('detection') || name.includes('aircraft') || name.includes('drone') || name.includes('surveillance') || name.includes('tracker')) {
          categories.surveillance.push(name);
        } else if (name.includes('biometric') || name.includes('heart') || name.includes('hrv') || name.includes('stress') || name.includes('ecg')) {
          categories.biometric.push(name);
        } else if (name.includes('legal') || name.includes('violation') || name.includes('complaint') || name.includes('filing') || name.includes('exhibit')) {
          categories.legal.push(name);
        } else if (name.includes('forensic') || name.includes('evidence') || name.includes('merkle') || name.includes('chain') || name.includes('hash')) {
          categories.forensic.push(name);
        } else if (name.includes('agent') || name.includes('session') || name.includes('message') || name.includes('josiah') || name.includes('sentinel')) {
          categories.agent.push(name);
        } else if (name.includes('registry') || name.includes('fleet') || name.includes('faa') || name.includes('operator') || name.includes('shell') || name.includes('entity')) {
          categories.registry.push(name);
        } else if (name.includes('job') || name.includes('config') || name.includes('profile') || name.includes('role') || name.includes('materialized')) {
          categories.infrastructure.push(name);
        } else {
          categories.other.push(name);
        }
      }

      return {
        tables: tables.map(t => {
          const name = t.table_name as string;
          const rc = rowCounts.find((r: any) => r.table_name === name);
          const cols = columns.filter((c: any) => c.table_name === name);
          return {
            name,
            type: t.table_type,
            estimatedRows: parseInt(rc?.estimated_rows || '0'),
            totalBytes: parseInt(rc?.total_bytes || '0'),
            columnCount: cols.length,
            columns: cols.map((c: any) => ({
              name: c.column_name,
              type: c.data_type,
              nullable: c.is_nullable === 'YES',
            })),
          };
        }),
        foreignKeys,
        inferredRelationships,
        categories,
        summary: {
          totalTables: tables.length,
          totalColumns: columns.length,
          totalForeignKeys: foreignKeys.length,
          totalInferredLinks: inferredRelationships.length,
          totalRows: rowCounts.reduce((s: number, r: any) => s + parseInt(r.estimated_rows || '0'), 0),
          totalBytes: rowCounts.reduce((s: number, r: any) => s + parseInt(r.total_bytes || '0'), 0),
        },
      };
    }

    case 'schemaTablePreview': {
      // Preview sample rows from a specific table
      const tableName = body.tableName;
      if (!tableName || !/^[a-z_][a-z0-9_]*$/.test(tableName)) {
        throw new Error('Invalid table name');
      }

      await sql`SET statement_timeout = '10s'`;

      const sample = await sql.unsafe(
        `SELECT * FROM "${tableName}" LIMIT 5`
      );

      // Get column stats
      const colStats = await sql.unsafe(`
        SELECT column_name, data_type,
               (SELECT COUNT(*)::int FROM "${tableName}" WHERE "${tableName}"."${''}" IS NOT NULL) as non_null
        FROM information_schema.columns
        WHERE table_name = '${tableName}' AND table_schema = 'public'
        ORDER BY ordinal_position
        LIMIT 50
      `).catch(() => []);

      return { tableName, sample, rowCount: sample.length };
    }

    case 'schemaRelationshipMap': {
      // Deep relationship analysis between two tables
      const { sourceTable, targetTable } = body;
      if (!sourceTable || !targetTable) throw new Error('sourceTable and targetTable required');

      await sql`SET statement_timeout = '15s'`;

      // Find shared columns
      const sharedCols = await sql`
        SELECT a.column_name, a.data_type
        FROM information_schema.columns a
        JOIN information_schema.columns b
          ON a.column_name = b.column_name
        WHERE a.table_name = ${sourceTable}
          AND b.table_name = ${targetTable}
          AND a.table_schema = 'public'
          AND b.table_schema = 'public'
          AND a.column_name NOT IN ('id', 'created_at', 'updated_at')
      `;

      // For each shared column, check value overlap
      const overlaps = [];
      for (const col of sharedCols.slice(0, 5)) {
        try {
          const overlap = await sql.unsafe(`
            SELECT COUNT(DISTINCT a."${col.column_name}")::int as shared_values
            FROM "${sourceTable}" a
            INNER JOIN "${targetTable}" b ON a."${col.column_name}" = b."${col.column_name}"
            WHERE a."${col.column_name}" IS NOT NULL
            LIMIT 1
          `);
          overlaps.push({
            column: col.column_name,
            type: col.data_type,
            sharedValues: overlap[0]?.shared_values || 0,
          });
        } catch (e) {
          overlaps.push({ column: col.column_name, type: col.data_type, sharedValues: -1 });
        }
      }

      return { sourceTable, targetTable, sharedColumns: sharedCols, overlaps };
    }

    case 'schemaSearch': {
      // Search for tables/columns matching a query
      const query = (body.query || '').toLowerCase();
      if (!query) throw new Error('query required');

      await sql`SET statement_timeout = '10s'`;

      const [tableMatches, columnMatches] = await Promise.all([
        sql`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND LOWER(table_name) LIKE ${'%' + query + '%'}
          ORDER BY table_name
          LIMIT 50
        `,
        sql`
          SELECT table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (LOWER(column_name) LIKE ${'%' + query + '%'}
                 OR LOWER(table_name) LIKE ${'%' + query + '%'})
          ORDER BY table_name, ordinal_position
          LIMIT 100
        `,
      ]);

      return { tableMatches, columnMatches };
    }

    // ── DRONE DETECTION SYSTEM ─────────────────────────────────────────

    case 'ensureDroneTables': {
      await sql`SET statement_timeout = '25s'`;

      // Create drone_rf_signatures table
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS drone_rf_signatures (
          id SERIAL PRIMARY KEY,
          detection_timestamp TIMESTAMPTZ DEFAULT NOW(),
          frequency_mhz NUMERIC,
          signal_strength_dbm NUMERIC,
          modulation_type TEXT,
          protocol TEXT,
          estimated_manufacturer TEXT,
          estimated_model TEXT,
          latitude NUMERIC,
          longitude NUMERIC,
          altitude_ft NUMERIC,
          bearing_deg NUMERIC,
          linked_ghost_callsign TEXT,
          linked_ghost_icao TEXT,
          confidence_score NUMERIC DEFAULT 0,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create drone_launch_recovery_points table
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS drone_launch_recovery_points (
          id SERIAL PRIMARY KEY,
          latitude NUMERIC NOT NULL,
          longitude NUMERIC NOT NULL,
          location_name TEXT,
          location_type TEXT DEFAULT 'unknown',
          first_observed TIMESTAMPTZ DEFAULT NOW(),
          last_observed TIMESTAMPTZ DEFAULT NOW(),
          observation_count INT DEFAULT 1,
          associated_registrations TEXT[],
          associated_callsigns TEXT[],
          avg_launch_altitude_ft NUMERIC,
          avg_recovery_altitude_ft NUMERIC,
          operational_hours TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create ghost_to_drone_mappings table
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ghost_to_drone_mappings (
          id SERIAL PRIMARY KEY,
          ghost_callsign TEXT,
          ghost_icao TEXT,
          ghost_registration TEXT,
          probable_drone_platform TEXT,
          platform_confidence NUMERIC DEFAULT 0,
          physics_violations JSONB DEFAULT '[]',
          detection_count INT DEFAULT 0,
          avg_altitude_ft NUMERIC,
          avg_speed_kts NUMERIC,
          min_speed_kts NUMERIC,
          max_altitude_ft NUMERIC,
          night_ops_pct NUMERIC,
          cluster_id TEXT,
          operational_pattern TEXT,
          first_seen TIMESTAMPTZ,
          last_seen TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create denver_logistics_flights table
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS denver_logistics_flights (
          id SERIAL PRIMARY KEY,
          callsign TEXT,
          registration TEXT,
          icao_code TEXT,
          origin TEXT,
          destination TEXT,
          departure_time TIMESTAMPTZ,
          arrival_time TIMESTAMPTZ,
          altitude_ft NUMERIC,
          speed_kts NUMERIC,
          aircraft_type TEXT,
          operator TEXT,
          correlation_score NUMERIC DEFAULT 0,
          drone_surge_correlation BOOLEAN DEFAULT false,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      return { success: true, tables: ['drone_rf_signatures', 'drone_launch_recovery_points', 'ghost_to_drone_mappings', 'denver_logistics_flights'] };
    }

    case 'droneRFScan': {
      await sql`SET statement_timeout = '25s'`;

      // Ensure tables exist first
      await sql.unsafe(`CREATE TABLE IF NOT EXISTS drone_rf_signatures (id SERIAL PRIMARY KEY, detection_timestamp TIMESTAMPTZ DEFAULT NOW(), frequency_mhz NUMERIC, signal_strength_dbm NUMERIC, modulation_type TEXT, protocol TEXT, estimated_manufacturer TEXT, estimated_model TEXT, latitude NUMERIC, longitude NUMERIC, altitude_ft NUMERIC, bearing_deg NUMERIC, linked_ghost_callsign TEXT, linked_ghost_icao TEXT, confidence_score NUMERIC DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);

      const signatures = await sql`SELECT * FROM drone_rf_signatures ORDER BY detection_timestamp DESC LIMIT 200`;
      return { signatures, count: signatures.length };
    }

    case 'insertDroneRF': {
      await sql`SET statement_timeout = '10s'`;
      const d = body.data;
      if (!d) throw new Error('data required');
      await sql.unsafe(`CREATE TABLE IF NOT EXISTS drone_rf_signatures (id SERIAL PRIMARY KEY, detection_timestamp TIMESTAMPTZ DEFAULT NOW(), frequency_mhz NUMERIC, signal_strength_dbm NUMERIC, modulation_type TEXT, protocol TEXT, estimated_manufacturer TEXT, estimated_model TEXT, latitude NUMERIC, longitude NUMERIC, altitude_ft NUMERIC, bearing_deg NUMERIC, linked_ghost_callsign TEXT, linked_ghost_icao TEXT, confidence_score NUMERIC DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
      const result = await sql.unsafe(
        `INSERT INTO drone_rf_signatures (frequency_mhz, signal_strength_dbm, modulation_type, protocol, estimated_manufacturer, estimated_model, latitude, longitude, altitude_ft, linked_ghost_callsign, linked_ghost_icao, confidence_score, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [d.frequency_mhz, d.signal_strength_dbm, d.modulation_type, d.protocol, d.estimated_manufacturer, d.estimated_model, d.latitude, d.longitude, d.altitude_ft, d.linked_ghost_callsign, d.linked_ghost_icao, d.confidence_score, d.notes]
      );
      return { inserted: result };
    }

    case 'ghostToDroneCorrelation': {
      await sql`SET statement_timeout = '25s'`;

      // Find all ghost aircraft with physics violations and cluster them
      const ghosts = await sql.unsafe(`
        WITH ghost_stats AS (
          SELECT
            COALESCE(callsign, 'UNKNOWN') as callsign,
            COALESCE(icao_code, '') as icao,
            COALESCE(registration, '') as registration,
            COUNT(*) as detection_count,
            AVG(altitude) as avg_alt,
            AVG(speed) as avg_speed,
            MIN(speed) as min_speed,
            MAX(altitude) as max_alt,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 6) as night_detections,
            COUNT(*) FILTER (WHERE speed < 50 AND speed > 0) as sub_stall_count,
            COUNT(*) FILTER (WHERE altitude < 0) as negative_alt_count,
            COUNT(*) FILTER (WHERE altitude < 500 AND altitude > 0) as ultra_low_count
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '90 days'
            AND latitude BETWEEN 35.20 AND 35.60
            AND longitude BETWEEN -119.25 AND -118.75
          GROUP BY COALESCE(callsign,'UNKNOWN'), COALESCE(icao_code,''), COALESCE(registration,'')
          HAVING COUNT(*) >= 5
        )
        SELECT *,
          ROUND(night_detections::numeric / NULLIF(detection_count,0) * 100, 1) as night_ops_pct,
          CASE
            WHEN sub_stall_count > 0 AND negative_alt_count > 0 THEN 'CONFIRMED_DRONE'
            WHEN sub_stall_count > 0 OR ultra_low_count > detection_count * 0.7 THEN 'PROBABLE_DRONE'
            WHEN avg_alt < 1000 AND night_detections > detection_count * 0.4 THEN 'SUSPECTED_DRONE'
            WHEN avg_speed < 80 AND avg_alt < 1500 THEN 'POSSIBLE_DRONE'
            ELSE 'UNDETERMINED'
          END as drone_classification,
          CASE
            WHEN sub_stall_count > 0 THEN 'Sub-stall speed violations'
            WHEN negative_alt_count > 0 THEN 'Negative altitude (spoofing)'
            WHEN ultra_low_count > detection_count * 0.5 THEN 'Ultra-low altitude profile'
            WHEN avg_speed < 50 THEN 'Hover/loiter capability'
            ELSE 'Behavioral pattern'
          END as primary_evidence
        FROM ghost_stats
        WHERE sub_stall_count > 0
          OR negative_alt_count > 0
          OR ultra_low_count > detection_count * 0.5
          OR (avg_speed < 80 AND avg_alt < 1000)
        ORDER BY
          CASE
            WHEN sub_stall_count > 0 AND negative_alt_count > 0 THEN 1
            WHEN sub_stall_count > 0 THEN 2
            WHEN negative_alt_count > 0 THEN 3
            ELSE 4
          END,
          detection_count DESC
        LIMIT 100
      `);

      // Summary stats
      const summary = {
        totalGhosts: ghosts.length,
        confirmed: ghosts.filter((g: any) => g.drone_classification === 'CONFIRMED_DRONE').length,
        probable: ghosts.filter((g: any) => g.drone_classification === 'PROBABLE_DRONE').length,
        suspected: ghosts.filter((g: any) => g.drone_classification === 'SUSPECTED_DRONE').length,
        possible: ghosts.filter((g: any) => g.drone_classification === 'POSSIBLE_DRONE').length,
        totalDetections: ghosts.reduce((s: number, g: any) => s + parseInt(g.detection_count || 0), 0),
      };

      return { ghosts, summary };
    }

    case 'denverLogisticsScan': {
      await sql`SET statement_timeout = '25s'`;

      // Find Denver-area flights (DEN = Denver) correlating with local drone activity
      const denverFlights = await sql.unsafe(`
        WITH denver_candidates AS (
          SELECT
            COALESCE(callsign, '') as callsign,
            COALESCE(registration, '') as registration,
            COALESCE(icao_code, '') as icao,
            COUNT(*) as detection_count,
            AVG(altitude) as avg_alt,
            AVG(speed) as avg_speed,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            COUNT(DISTINCT DATE(detection_timestamp)) as active_days,
            COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp) >= 20 OR EXTRACT(HOUR FROM detection_timestamp) < 6) as night_count
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '90 days'
            AND latitude BETWEEN 35.20 AND 35.60
            AND longitude BETWEEN -119.25 AND -118.75
            AND (
              callsign LIKE 'SKW%' OR callsign LIKE 'UAL%' OR callsign LIKE 'ASA%'
              OR callsign LIKE 'QXE%' OR callsign LIKE 'ENY%'
              OR callsign LIKE 'AAL%' OR callsign LIKE 'SWA%'
              OR callsign LIKE 'FDX%' OR callsign LIKE 'UPS%'
            )
          GROUP BY COALESCE(callsign,''), COALESCE(registration,''), COALESCE(icao_code,'')
          HAVING COUNT(*) >= 3
        )
        SELECT *,
          ROUND(night_count::numeric / NULLIF(detection_count,0) * 100, 1) as night_pct,
          CASE
            WHEN avg_alt < 2000 AND night_count > detection_count * 0.5 THEN 'HIGH_SUSPICION'
            WHEN night_count > detection_count * 0.7 THEN 'LOGISTICS_PATTERN'
            WHEN active_days > 30 THEN 'SUSTAINED_OPS'
            ELSE 'MONITOR'
          END as assessment
        FROM denver_candidates
        ORDER BY detection_count DESC
        LIMIT 50
      `);

      // Get hourly distribution to find nightly shuttle patterns
      const hourlyPattern = await sql.unsafe(`
        SELECT EXTRACT(HOUR FROM detection_timestamp)::int as hour,
               COUNT(*) as detections,
               COUNT(DISTINCT callsign) as unique_callsigns
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '90 days'
          AND latitude BETWEEN 35.20 AND 35.60
          AND longitude BETWEEN -119.25 AND -118.75
          AND (callsign LIKE 'SKW%' OR callsign LIKE 'UAL%' OR callsign LIKE 'ASA%'
               OR callsign LIKE 'QXE%' OR callsign LIKE 'ENY%')
        GROUP BY EXTRACT(HOUR FROM detection_timestamp)::int
        ORDER BY hour
      `);

      // Check for drone activity surge correlation
      const droneSurgeCorrelation = await sql.unsafe(`
        WITH commercial_arrivals AS (
          SELECT DATE(detection_timestamp) as flight_date,
                 COUNT(*) as commercial_count
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '90 days'
            AND latitude BETWEEN 35.20 AND 35.60
            AND longitude BETWEEN -119.25 AND -118.75
            AND (callsign LIKE 'SKW%' OR callsign LIKE 'UAL%' OR callsign LIKE 'ASA%')
          GROUP BY DATE(detection_timestamp)
        ),
        drone_activity AS (
          SELECT DATE(detection_timestamp) as flight_date,
                 COUNT(*) as drone_count
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '90 days'
            AND latitude BETWEEN 35.20 AND 35.60
            AND longitude BETWEEN -119.25 AND -118.75
            AND (speed < 50 OR altitude < 500)
            AND speed > 0 AND altitude > 0
          GROUP BY DATE(detection_timestamp)
        )
        SELECT
          c.flight_date,
          c.commercial_count,
          COALESCE(d.drone_count, 0) as drone_count,
          ROUND(COALESCE(d.drone_count,0)::numeric / NULLIF(c.commercial_count,0), 2) as ratio
        FROM commercial_arrivals c
        LEFT JOIN drone_activity d ON c.flight_date = d.flight_date
        ORDER BY c.flight_date DESC
        LIMIT 90
      `);

      return {
        flights: denverFlights,
        hourlyPattern,
        surgeCorrelation: droneSurgeCorrelation,
        summary: {
          totalFlights: denverFlights.length,
          highSuspicion: denverFlights.filter((f: any) => f.assessment === 'HIGH_SUSPICION').length,
          logisticsPattern: denverFlights.filter((f: any) => f.assessment === 'LOGISTICS_PATTERN').length,
        }
      };
    }

    case 'launchRecoveryPoints': {
      await sql`SET statement_timeout = '25s'`;
      await sql.unsafe(`CREATE TABLE IF NOT EXISTS drone_launch_recovery_points (id SERIAL PRIMARY KEY, latitude NUMERIC NOT NULL, longitude NUMERIC NOT NULL, location_name TEXT, location_type TEXT DEFAULT 'unknown', first_observed TIMESTAMPTZ DEFAULT NOW(), last_observed TIMESTAMPTZ DEFAULT NOW(), observation_count INT DEFAULT 1, associated_registrations TEXT[], associated_callsigns TEXT[], avg_launch_altitude_ft NUMERIC, avg_recovery_altitude_ft NUMERIC, operational_hours TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
      const points = await sql`SELECT * FROM drone_launch_recovery_points ORDER BY observation_count DESC LIMIT 100`;
      return { points, count: points.length };
    }

    case 'schemaFragmentationAnalysis': {
      await sql`SET statement_timeout = '25s'`;

      // Domain keyword clusters
      const CLUSTERS: Record<string, string[]> = {
        'Surveillance': ['flight', 'detection', 'tracking', 'adsb', 'opensky', 'radar', 'transponder', 'squawk'],
        'Biometric': ['biometric', 'heart', 'hrv', 'stress', 'ecg', 'health', 'vitals', 'collapse'],
        'Aircraft Registry': ['aircraft', 'registry', 'faa', 'fleet', 'icao', 'registration'],
        'Entity/Shell': ['shell', 'company', 'operator', 'entity', 'corporate', 'enterprise'],
        'Legal': ['legal', 'violation', 'exhibit', 'complaint', 'filing', 'ada', 'rico', 'tro', 'damages'],
        'Forensic': ['forensic', 'evidence', 'chain', 'merkle', 'custody', 'hash'],
        'Drone': ['drone', 'uav', 'unmanned', 'rf_signal'],
        'Agent/AI': ['agent', 'session', 'chat', 'hypothesis', 'sentinel', 'watchtower'],
        'OCR/Media': ['ocr', 'screenshot', 'photo', 'image', 'media', 'scan'],
        'Timeline': ['timeline', 'chrono', 'unified', 'narrative', 'daily'],
        'Geographic': ['location', 'geo', 'coordinate', 'map', 'cluster', 'hq'],
      };

      // 1. Get all tables with row counts and column lists
      const allTables = await sql`
        SELECT 
          c.relname as table_name,
          GREATEST(c.reltuples, 0)::bigint as row_count,
          pg_total_relation_size(c.oid) as size_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.reltuples DESC
      `;

      const allColumns = await sql`
        SELECT table_name, 
               array_agg(column_name ORDER BY ordinal_position) as columns,
               array_agg(data_type ORDER BY ordinal_position) as col_types
        FROM information_schema.columns
        WHERE table_schema = 'public'
        GROUP BY table_name
      `;

      // 2. Staleness info
      const staleness = await sql`
        SELECT relname as table_name,
               last_autoanalyze,
               last_autovacuum,
               n_live_tup
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
      `;

      // 3. Join key audit - which tables have common join keys
      const joinKeys = await sql`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN ('registration', 'icao_code', 'n_number', 'tail_number', 
                              'hex_code', 'mode_s_hex', 'evidence_hash', 'sha256_hash',
                              'aircraft_id', 'entity_id', 'forensic_event_id')
        ORDER BY column_name, table_name
      `;

      // Build column map for Jaccard computation
      const colMap: Record<string, string[]> = {};
      for (const row of allColumns) {
        colMap[row.table_name] = row.columns;
      }

      // Build table info map
      const tableInfo: Record<string, { row_count: number; size_bytes: number }> = {};
      for (const t of allTables) {
        tableInfo[t.table_name] = { row_count: Number(t.row_count), size_bytes: Number(t.size_bytes) };
      }

      // Build staleness map
      const stalenessMap: Record<string, any> = {};
      for (const s of staleness) {
        stalenessMap[s.table_name] = {
          last_autoanalyze: s.last_autoanalyze,
          n_live_tup: Number(s.n_live_tup),
        };
      }

      // Cluster tables
      const clusters: Record<string, Array<{
        table_name: string;
        row_count: number;
        size_bytes: number;
        columns: string[];
        stale: boolean;
        empty: boolean;
      }>> = {};
      const unclustered: string[] = [];

      const tableNames = allTables.map((t: any) => t.table_name);
      for (const tName of tableNames) {
        let assigned = false;
        const lower = tName.toLowerCase();
        for (const [cluster, keywords] of Object.entries(CLUSTERS)) {
          if (keywords.some(kw => lower.includes(kw))) {
            if (!clusters[cluster]) clusters[cluster] = [];
            const info = tableInfo[tName] || { row_count: 0, size_bytes: 0 };
            const st = stalenessMap[tName];
            clusters[cluster].push({
              table_name: tName,
              row_count: info.row_count,
              size_bytes: info.size_bytes,
              columns: colMap[tName] || [],
              stale: st ? (!st.last_autoanalyze || st.n_live_tup === 0) : true,
              empty: info.row_count === 0,
            });
            assigned = true;
            break;
          }
        }
        if (!assigned) unclustered.push(tName);
      }

      // Compute Jaccard similarity within each cluster to find duplicates
      const clusterResults: Array<{
        cluster: string;
        table_count: number;
        total_rows: number;
        total_size_bytes: number;
        fragmentation_score: number;
        canonical_table: string;
        empty_tables: string[];
        duplicate_pairs: Array<{ a: string; b: string; jaccard: number }>;
        tables: Array<{ table_name: string; row_count: number; columns: string[]; empty: boolean; stale: boolean }>;
      }> = [];

      for (const [clusterName, tables] of Object.entries(clusters)) {
        const totalRows = tables.reduce((s, t) => s + t.row_count, 0);
        const totalSize = tables.reduce((s, t) => s + t.size_bytes, 0);
        const canonical = tables.reduce((best, t) => t.row_count > best.row_count ? t : best, tables[0]);
        const emptyTables = tables.filter(t => t.empty).map(t => t.table_name);

        // Jaccard pairs (top overlaps)
        const pairs: Array<{ a: string; b: string; jaccard: number }> = [];
        for (let i = 0; i < tables.length; i++) {
          for (let j = i + 1; j < tables.length; j++) {
            const colsA = new Set(tables[i].columns);
            const colsB = new Set(tables[j].columns);
            const intersection = [...colsA].filter(c => colsB.has(c)).length;
            const union = new Set([...colsA, ...colsB]).size;
            const jaccard = union > 0 ? Math.round((intersection / union) * 100) / 100 : 0;
            if (jaccard >= 0.3) {
              pairs.push({ a: tables[i].table_name, b: tables[j].table_name, jaccard });
            }
          }
        }
        pairs.sort((a, b) => b.jaccard - a.jaccard);

        // Fragmentation score: more tables + more empty + more duplicates = higher
        const nonCanonicalSmall = tables.filter(t => t.table_name !== canonical.table_name && t.row_count < 100).length;
        const fragScore = Math.min(100, Math.round(
          (tables.length > 1 ? 20 : 0) +
          (tables.length > 5 ? 20 : tables.length > 3 ? 10 : 0) +
          (emptyTables.length / Math.max(tables.length, 1)) * 30 +
          (pairs.filter(p => p.jaccard > 0.6).length * 10) +
          (nonCanonicalSmall / Math.max(tables.length, 1)) * 20
        ));

        clusterResults.push({
          cluster: clusterName,
          table_count: tables.length,
          total_rows: totalRows,
          total_size_bytes: totalSize,
          fragmentation_score: fragScore,
          canonical_table: canonical.table_name,
          empty_tables: emptyTables,
          duplicate_pairs: pairs.slice(0, 10),
          tables: tables.map(t => ({
            table_name: t.table_name,
            row_count: t.row_count,
            columns: t.columns,
            empty: t.empty,
            stale: t.stale,
          })),
        });
      }

      clusterResults.sort((a, b) => b.fragmentation_score - a.fragmentation_score);

      // Join key summary
      const joinKeyMap: Record<string, string[]> = {};
      for (const jk of joinKeys) {
        if (!joinKeyMap[jk.column_name]) joinKeyMap[jk.column_name] = [];
        joinKeyMap[jk.column_name].push(jk.table_name);
      }

      // Summary stats
      const totalTables = tableNames.length;
      const totalEmpty = allTables.filter((t: any) => Number(t.row_count) === 0).length;
      const totalRows = allTables.reduce((s: number, t: any) => s + Number(t.row_count), 0);
      const avgFragScore = clusterResults.length > 0
        ? Math.round(clusterResults.reduce((s, c) => s + c.fragmentation_score, 0) / clusterResults.length)
        : 0;

      return {
        summary: {
          total_tables: totalTables,
          empty_tables: totalEmpty,
          total_rows: totalRows,
          clustered_tables: totalTables - unclustered.length,
          unclustered_tables: unclustered.length,
          avg_fragmentation_score: avgFragScore,
          cluster_count: clusterResults.length,
        },
        clusters: clusterResults,
        join_keys: joinKeyMap,
        unclustered: unclustered.slice(0, 50),
      };
    }

    default:
      return null;
  }
}
