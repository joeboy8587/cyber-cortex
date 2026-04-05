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

    default:
      return null;
  }
}
