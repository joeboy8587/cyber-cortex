import postgres from "npm:postgres@3.4.4";

type SQL = ReturnType<typeof postgres>;

export async function handleAction7(action: string, body: Record<string, any>, sql: SQL): Promise<unknown> {
  switch (action) {
    // ==================== FULL ARCHIVE CENSUS ====================
    case 'fullArchiveCensus': {
      await sql.unsafe(`SET statement_timeout = '25s'`);

      const allTables = await sql.unsafe(`
        SELECT 
          c.relname as table_name,
          GREATEST(c.reltuples, 0)::bigint as row_count,
          pg_total_relation_size(c.oid)::bigint as size_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.reltuples DESC
      `);

      const allColumns = await sql.unsafe(`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `);

      const columnMap: Record<string, string[]> = {};
      for (const col of allColumns) {
        if (!columnMap[col.table_name]) columnMap[col.table_name] = [];
        columnMap[col.table_name].push(col.column_name);
      }

      const JOIN_KEYS = [
        'registration', 'icao_code', 'hex_id', 'hex', 'mode_s_hex', 'mode_s_code',
        'callsign', 'tail_number', 'n_number',
        'operator', 'operator_name', 'registrant_name',
        'entity_id', 'forensic_event_id', 'detection_id', 'session_id',
        'case_id', 'exhibit_id', 'link_id',
        'detection_timestamp', 'event_timestamp', 'measurement_timestamp', 'created_at',
        'latitude', 'longitude', 'geo_lat', 'geo_lng',
        'altitude', 'speed', 'heading',
        'threat_score', 'anomaly_score', 'confidence_score',
        'taxonomy_tag', 'threat_type', 'violation_type',
        'sha256_hash', 'chain_hash', 'record_hash',
        'user_id', 'source_table', 'source_id'
      ];

      const DOMAIN_RULES: [string, RegExp][] = [
        ['Flight Detection', /flight|detection|adsb|radar|transponder|squawk|unfiltered/i],
        ['Biometric', /biometric|heart|ecg|stress|health|medical|hrv/i],
        ['Correlation', /correlation|link|bridge|stitch|merge|join/i],
        ['OCR/Visual', /ocr|image|photo|visual|camera|snapshot/i],
        ['Legal/ADA/RICO', /legal|ada|rico|civil|complaint|filing|damages|tro|fca|faa_complaint/i],
        ['KCSO', /kcso|kern|sheriff|law_enforcement/i],
        ['Aircraft Registry', /registry|faa|airworth|certificate|registrant/i],
        ['Operator', /operator|company|enterprise|shell|corporate/i],
        ['Agent/Josiah', /agent|josiah|chat|session|reflection/i],
        ['Forensic', /forensic|evidence|exhibit|chain_of_custody|merkle|custody/i],
        ['Shell Company', /shell|front|llc|corporate_structure/i],
        ['Military', /military|mil_|dod|government|posse/i],
        ['Drone', /drone|rf_signal|uav|uas/i],
        ['Infrastructure', /infrastructure|facility|location|hq|unmask/i],
        ['Taxonomy', /taxonomy|classification|tag|category|tier/i],
        ['Watchtower', /watchtower|sentinel|alert|flag|monitor/i],
        ['Timeline', /timeline|chrono|daily|event_import|narrative/i],
      ];

      function classifyTable(name: string): string {
        for (const [domain, regex] of DOMAIN_RULES) {
          if (regex.test(name)) return domain;
        }
        return 'Other';
      }

      const manifest = allTables.map((t: any) => {
        const cols = columnMap[t.table_name] || [];
        const joinKeys = cols.filter(c => JOIN_KEYS.includes(c));
        return {
          table_name: t.table_name,
          row_count: Number(t.row_count),
          size_bytes: Number(t.size_bytes),
          domain: classifyTable(t.table_name),
          column_count: cols.length,
          columns: cols,
          join_keys: joinKeys,
        };
      });

      const domainMap: Record<string, { tables: number; records: number; size: number; tableNames: string[] }> = {};
      for (const t of manifest) {
        if (!domainMap[t.domain]) domainMap[t.domain] = { tables: 0, records: 0, size: 0, tableNames: [] };
        domainMap[t.domain].tables++;
        domainMap[t.domain].records += t.row_count;
        domainMap[t.domain].size += t.size_bytes;
        domainMap[t.domain].tableNames.push(t.table_name);
      }

      const linkageMatrix: { domain_a: string; domain_b: string; shared_keys: string[]; linkable_tables: number }[] = [];
      const domains = Object.keys(domainMap);
      for (let i = 0; i < domains.length; i++) {
        for (let j = i + 1; j < domains.length; j++) {
          const tablesA = manifest.filter((t: any) => t.domain === domains[i]);
          const tablesB = manifest.filter((t: any) => t.domain === domains[j]);
          const keysA = new Set(tablesA.flatMap((t: any) => t.join_keys));
          const keysB = new Set(tablesB.flatMap((t: any) => t.join_keys));
          const shared = [...keysA].filter(k => keysB.has(k));
          if (shared.length > 0) {
            let linkable = 0;
            for (const ta of tablesA) {
              for (const tb of tablesB) {
                if (ta.join_keys.some((k: string) => tb.join_keys.includes(k))) linkable++;
              }
            }
            linkageMatrix.push({ domain_a: domains[i], domain_b: domains[j], shared_keys: shared, linkable_tables: linkable });
          }
        }
      }

      const fragmentClusters: { tables: string[]; overlap_pct: number; shared_columns: string[] }[] = [];
      const checked = new Set<string>();
      for (let i = 0; i < manifest.length; i++) {
        for (let j = i + 1; j < manifest.length; j++) {
          const a = manifest[i];
          const b = manifest[j];
          if (a.columns.length < 3 || b.columns.length < 3) continue;
          const setB = new Set(b.columns);
          const intersection = a.columns.filter((c: string) => setB.has(c));
          const union = new Set([...a.columns, ...b.columns]);
          const jaccard = intersection.length / union.size;
          if (jaccard >= 0.8) {
            const key = [a.table_name, b.table_name].sort().join('|');
            if (!checked.has(key)) {
              checked.add(key);
              fragmentClusters.push({
                tables: [a.table_name, b.table_name],
                overlap_pct: Math.round(jaccard * 100),
                shared_columns: intersection,
              });
            }
          }
        }
      }

      return {
        totalTables: manifest.length,
        totalRecords: manifest.reduce((s: number, t: any) => s + t.row_count, 0),
        totalSizeBytes: manifest.reduce((s: number, t: any) => s + t.size_bytes, 0),
        domainMap,
        linkageMatrix: linkageMatrix.sort((a, b) => b.shared_keys.length - a.shared_keys.length),
        fragmentClusters: fragmentClusters.sort((a, b) => b.overlap_pct - a.overlap_pct).slice(0, 50),
        tables: manifest,
      };
    }

    // ==================== CROSS DOMAIN QUERY ====================
    case 'crossDomainQuery': {
      const domainA = body.domainA;
      const domainB = body.domainB;
      const tablesA = body.tablesA;
      const tablesB = body.tablesB;
      const joinKey = body.joinKey || 'registration';
      const queryLimit = Math.min(body.limit || 50, 200);

      if (!tablesA?.[0] || !tablesB?.[0]) {
        return { error: 'tablesA and tablesB arrays are required' };
      }

      const safeA = tablesA[0].replace(/[^a-zA-Z0-9_]/g, '');
      const safeB = tablesB[0].replace(/[^a-zA-Z0-9_]/g, '');
      const safeKey = joinKey.replace(/[^a-zA-Z0-9_]/g, '');

      await sql.unsafe(`SET statement_timeout = '15s'`);

      const colCheck = await sql.unsafe(`
        SELECT table_name, column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name IN ('${safeA}', '${safeB}')
          AND column_name = '${safeKey}'
      `);

      if (colCheck.length < 2) {
        const commonCols = await sql.unsafe(`
          SELECT a.column_name
          FROM information_schema.columns a
          JOIN information_schema.columns b ON a.column_name = b.column_name
          WHERE a.table_schema = 'public' AND b.table_schema = 'public'
            AND a.table_name = '${safeA}' AND b.table_name = '${safeB}'
            AND a.column_name NOT IN ('id', 'created_at', 'updated_at')
          ORDER BY a.column_name
        `);
        return {
          error: `Join key '${safeKey}' not found in both tables`,
          availableCommonColumns: commonCols.map((c: any) => c.column_name),
          suggestion: commonCols[0]?.column_name || null,
        };
      }

      const linked = await sql.unsafe(`
        SELECT 
          a.${safeKey} as join_value,
          '${safeA}' as source_a,
          '${safeB}' as source_b,
          COUNT(DISTINCT a.ctid)::int as records_a,
          COUNT(DISTINCT b.ctid)::int as records_b
        FROM ${safeA} a
        JOIN ${safeB} b ON a.${safeKey} = b.${safeKey}
        WHERE a.${safeKey} IS NOT NULL AND a.${safeKey} != ''
        GROUP BY a.${safeKey}
        ORDER BY (COUNT(DISTINCT a.ctid) + COUNT(DISTINCT b.ctid)) DESC
        LIMIT ${queryLimit}
      `);

      const sampleValue = linked[0]?.join_value;
      let sampleA: any[] = [];
      let sampleB: any[] = [];
      if (sampleValue) {
        [sampleA, sampleB] = await Promise.all([
          sql.unsafe(`SELECT * FROM ${safeA} WHERE ${safeKey} = '${sampleValue.replace(/'/g, "''")}' LIMIT 3`),
          sql.unsafe(`SELECT * FROM ${safeB} WHERE ${safeKey} = '${sampleValue.replace(/'/g, "''")}' LIMIT 3`),
        ]);
      }

      return {
        domainA, domainB,
        tableA: safeA, tableB: safeB,
        joinKey: safeKey,
        linkedEntities: linked,
        totalLinked: linked.length,
        sampleA, sampleB,
        sampleJoinValue: sampleValue || null,
      };
    }

    default:
      return null;
  }
}
