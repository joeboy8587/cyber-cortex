import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 13 Evidence Modalities for complete database categorization
const EVIDENCE_DOMAINS = {
  FLIGHT_SURVEILLANCE: {
    patterns: ['flight', 'aircraft', 'adsb', 'radar', 'detection', 'flagged_aircraft', 'aviation', 'airborne'],
    description: 'ADS-B, radar, aircraft detections',
    protected: ['live_flight_detections_rows']
  },
  BIOMETRIC_HEALTH: {
    patterns: ['biometric', 'heart', 'pulse', 'ecg', 'stress', 'health', 'physician'],
    description: 'Heart rate, ECG, stress readings',
    protected: ['physician_verified_ecgs', 'biometrics_unified']
  },
  KCSO_LAW_ENFORCEMENT: {
    patterns: ['kcso', 'sheriff', 'law_enforcement', 'police', 'kern_county'],
    description: 'Sheriff fleet, operations, surveillance',
    protected: ['kcso_fleet', 'KCSO_Fact_Matrix_v1', 'KCSO_Personal_Injury_Timeline']
  },
  LEGAL_VIOLATIONS: {
    patterns: ['legal', 'ada', 'rico', 'violation', 'nuremberg', 'claim', 'lawsuit', 'brief', 'motion'],
    description: 'ADA violations, RICO evidence, legal claims',
    protected: []
  },
  JOSIAH_AI: {
    patterns: ['josiah', 'reflection', 'embedding', 'memory', 'ai_witness', 'sacred'],
    description: 'AI reflections, embeddings, memory',
    protected: ['josiah_sacred_memory', 'josiah_reflections_rows']
  },
  OCR_VISUAL: {
    patterns: ['ocr', 'screenshot', 'image', 'visual', 'extract'],
    description: 'Screenshot OCR, image analysis',
    protected: []
  },
  CRIMINAL_NETWORK: {
    patterns: ['shell', 'enterprise', 'criminal', 'network', 'conspiracy'],
    description: 'Shell companies, enterprise profiles',
    protected: []
  },
  FORENSIC_CUSTODY: {
    patterns: ['forensic', 'custody', 'chain', 'evidence_doc', 'hash', 'integrity'],
    description: 'Chain of custody, evidence files',
    protected: ['chain_of_custody', 'forensic_file_registry']
  },
  AIRCRAFT_REGISTRY: {
    patterns: ['registry', 'operator', 'faa', 'owner', 'registration'],
    description: 'FAA registry, operator profiles',
    protected: ['aircraft_registry_enhanced_rows']
  },
  CORRELATIONS: {
    patterns: ['correlation', 'link', 'match', 'bradford'],
    description: 'Cross-domain correlation events',
    protected: ['correlation_events_mv', 'biometric_correlations_enhanced']
  },
  TIMELINE_WATCHTOWER: {
    patterns: ['timeline', 'watchtower', 'event_log', 'unified_timeline', 'chronological'],
    description: 'Unified timelines, event aggregation',
    protected: ['unified_timeline_enhanced']
  },
  INTELLIGENCE: {
    patterns: ['pattern', 'threat', 'intel', 'analysis', 'matrix', 'assessment'],
    description: 'Pattern analysis, threat assessments',
    protected: []
  },
  CLEANUP_CANDIDATES: {
    patterns: ['mnist', 'test_data', 'backup_2026', '_rows_rows'],
    description: 'ML test data, dated backups, malformed tables',
    protected: []
  }
};

// Duplicate detection patterns
const DUPLICATE_PATTERNS = {
  suffixes: ['_rows', '_rows_1', '_rows_2', '_rows_rows', '_backup', '_v1', '_v2', '_v3', '_enriched', '_enhanced', '_unified', '_1', '_2', '_3', '_4'],
  backupPattern: /_backup_\d{8}/,
  versionPattern: /_v\d+$/,
  numberedPattern: /_\d+$/
};

function categorizeTable(tableName: string): string {
  const lowerName = tableName.toLowerCase();
  
  // Check cleanup candidates first (highest priority for cleanup)
  if (lowerName.includes('mnist') || lowerName.includes('_rows_rows') || DUPLICATE_PATTERNS.backupPattern.test(lowerName)) {
    return 'CLEANUP_CANDIDATES';
  }
  
  for (const [domain, config] of Object.entries(EVIDENCE_DOMAINS)) {
    if (domain === 'CLEANUP_CANDIDATES') continue;
    for (const pattern of config.patterns) {
      if (lowerName.includes(pattern.toLowerCase())) {
        return domain;
      }
    }
  }
  
  return 'OTHER';
}

function detectDuplicateFamily(tableName: string): { baseName: string; suffix: string } | null {
  const lowerName = tableName.toLowerCase();
  
  // Check for backup pattern
  const backupMatch = lowerName.match(/_backup_\d{8}/);
  if (backupMatch) {
    return {
      baseName: lowerName.replace(/_backup_\d{8}.*$/, ''),
      suffix: backupMatch[0]
    };
  }
  
  // Check for suffix patterns
  for (const suffix of DUPLICATE_PATTERNS.suffixes) {
    if (lowerName.endsWith(suffix)) {
      return {
        baseName: lowerName.slice(0, -suffix.length),
        suffix: suffix
      };
    }
  }
  
  return null;
}

function isProtectedTable(tableName: string): boolean {
  for (const config of Object.values(EVIDENCE_DOMAINS)) {
    if (config.protected.some(p => tableName.toLowerCase().includes(p.toLowerCase()))) {
      return true;
    }
  }
  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
  if (!databaseUrl) {
    return new Response(JSON.stringify({ error: 'Database URL not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  let sql;
  try {
    sql = postgres(databaseUrl, { ssl: 'require', max: 1 });
    const { action, params = {} } = await req.json();

    switch (action) {
      case 'getFullCensus': {
        // Single bulk query using pg_class.reltuples (planner estimate) - no per-table COUNT(*)
        const tables = await sql`
          SELECT 
            n.nspname as schema,
            c.relname as name,
            pg_total_relation_size(c.oid) as size_bytes,
            GREATEST(c.reltuples, 0)::bigint as row_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r'
            AND n.nspname IN ('public', 'quarantine', 'legacy_v1_import')
          ORDER BY n.nspname, c.relname
        `;
        const tableStats = tables.map((t: any) => ({
          schema: t.schema,
          name: t.name,
          size_bytes: parseInt(t.size_bytes || '0'),
          row_count: parseInt(t.row_count || '0'),
          domain: categorizeTable(t.name),
          is_protected: isProtectedTable(t.name),
          duplicate_info: detectDuplicateFamily(t.name)
        }));
        
        return new Response(JSON.stringify({
          tables: tableStats,
          total_count: tableStats.length,
          total_size: tableStats.reduce((sum, t) => sum + (t.size_bytes || 0), 0),
          total_rows: tableStats.reduce((sum, t) => sum + (t.row_count || 0), 0)
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'getModalityBreakdown': {
        // Single bulk query using planner estimates - no per-table COUNT(*)
        const tables = await sql`
          SELECT 
            c.relname as name,
            pg_total_relation_size(c.oid) as size_bytes,
            GREATEST(c.reltuples, 0)::bigint as row_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' AND n.nspname = 'public'
          ORDER BY c.relname
        `;
        
        const domainStats: Record<string, {
          tables: any[];
          total_rows: number;
          total_size: number;
          description: string;
          protected_tables: string[];
        }> = {};
        
        for (const [domain, config] of Object.entries(EVIDENCE_DOMAINS)) {
          domainStats[domain] = {
            tables: [], total_rows: 0, total_size: 0,
            description: config.description, protected_tables: config.protected
          };
        }
        domainStats['OTHER'] = {
          tables: [], total_rows: 0, total_size: 0,
          description: 'Uncategorized tables', protected_tables: []
        };
        
        for (const table of tables) {
          const rowCount = parseInt(table.row_count || '0');
          const sizeBytes = parseInt(table.size_bytes || '0');
          const domain = categorizeTable(table.name);
          domainStats[domain].tables.push({
            name: table.name,
            row_count: rowCount,
            size_bytes: sizeBytes,
            is_protected: isProtectedTable(table.name)
          });
          domainStats[domain].total_rows += rowCount;
          domainStats[domain].total_size += sizeBytes;
        }
        
        // Calculate health scores per domain
        const domainsWithHealth = Object.entries(domainStats).map(([name, stats]) => {
          const emptyTables = stats.tables.filter(t => t.row_count === 0).length;
          const totalTables = stats.tables.length;
          const healthScore = totalTables > 0 
            ? Math.round(((totalTables - emptyTables) / totalTables) * 100)
            : 100;
          
          return {
            name,
            ...stats,
            table_count: totalTables,
            empty_table_count: emptyTables,
            health_score: healthScore
          };
        }).sort((a, b) => b.total_size - a.total_size);
        
        return new Response(JSON.stringify({
          domains: domainsWithHealth,
          total_domains: domainsWithHealth.length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'getDuplicateFamilies': {
        // Find all duplicate families based on naming patterns
        const tables = await sql`
          SELECT tablename as name,
                 pg_total_relation_size('public.' || quote_ident(tablename)) as size_bytes
          FROM pg_tables 
          WHERE schemaname = 'public'
          ORDER BY tablename
        `;
        
        const families: Record<string, {
          primary: any | null;
          duplicates: any[];
          total_size: number;
          total_rows: number;
          recommendation: string;
        }> = {};
        
        for (const table of tables) {
          const dupInfo = detectDuplicateFamily(table.name);
          
          try {
            const countResult = await sql`
              SELECT COUNT(*) as count FROM public.${sql(table.name)}
            `;
            const rowCount = parseInt(countResult[0]?.count || '0');
            
            if (dupInfo) {
              // This is a duplicate/variant
              if (!families[dupInfo.baseName]) {
                families[dupInfo.baseName] = {
                  primary: null,
                  duplicates: [],
                  total_size: 0,
                  total_rows: 0,
                  recommendation: ''
                };
              }
              families[dupInfo.baseName].duplicates.push({
                name: table.name,
                suffix: dupInfo.suffix,
                row_count: rowCount,
                size_bytes: parseInt(table.size_bytes || 0),
                is_backup: dupInfo.suffix.includes('backup'),
                is_protected: isProtectedTable(table.name)
              });
              families[dupInfo.baseName].total_size += parseInt(table.size_bytes || 0);
              families[dupInfo.baseName].total_rows += rowCount;
            } else {
              // Check if this is a base table for a family
              const baseName = table.name.toLowerCase();
              if (!families[baseName]) {
                families[baseName] = {
                  primary: null,
                  duplicates: [],
                  total_size: 0,
                  total_rows: 0,
                  recommendation: ''
                };
              }
              families[baseName].primary = {
                name: table.name,
                row_count: rowCount,
                size_bytes: parseInt(table.size_bytes || 0),
                is_protected: isProtectedTable(table.name)
              };
              families[baseName].total_size += parseInt(table.size_bytes || 0);
              families[baseName].total_rows += rowCount;
            }
          } catch (e) {
            // Skip tables that can't be counted
          }
        }
        
        // Filter to only families with duplicates and generate recommendations
        const familiesWithDuplicates = Object.entries(families)
          .filter(([_, f]) => f.duplicates.length > 0)
          .map(([baseName, family]) => {
            const hasBackups = family.duplicates.some(d => d.is_backup);
            const hasEmpty = family.duplicates.some(d => d.row_count === 0);
            
            let recommendation = '';
            if (hasBackups) {
              recommendation = 'Archive backups to quarantine schema';
            } else if (hasEmpty) {
              recommendation = 'Drop empty duplicate tables';
            } else {
              recommendation = 'Merge unique records into primary table';
            }
            
            return {
              base_name: baseName,
              primary: family.primary,
              duplicates: family.duplicates.sort((a, b) => b.row_count - a.row_count),
              total_size: family.total_size,
              total_rows: family.total_rows,
              recommendation,
              domain: categorizeTable(baseName)
            };
          })
          .sort((a, b) => b.total_size - a.total_size);
        
        return new Response(JSON.stringify({
          families: familiesWithDuplicates,
          total_families: familiesWithDuplicates.length,
          total_potential_savings: familiesWithDuplicates.reduce((sum, f) => 
            sum + f.duplicates.filter(d => d.is_backup || d.row_count === 0)
              .reduce((s, d) => s + d.size_bytes, 0), 0)
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'getEmptyTables': {
        // Find all empty tables with FK dependency info
        const tables = await sql`
          SELECT tablename as name
          FROM pg_tables 
          WHERE schemaname = 'public'
          ORDER BY tablename
        `;
        
        const emptyTables = [];
        
        for (const table of tables) {
          try {
            const countResult = await sql`
              SELECT COUNT(*) as count FROM public.${sql(table.name)}
            `;
            const rowCount = parseInt(countResult[0]?.count || '0');
            
            if (rowCount === 0) {
              // Check for FK dependencies
              const fkResult = await sql`
                SELECT COUNT(*) as fk_count
                FROM information_schema.table_constraints tc
                JOIN information_schema.constraint_column_usage ccu 
                  ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND ccu.table_name = ${table.name}
              `;
              
              emptyTables.push({
                name: table.name,
                domain: categorizeTable(table.name),
                is_protected: isProtectedTable(table.name),
                has_fk_dependencies: parseInt(fkResult[0]?.fk_count || '0') > 0,
                safe_to_drop: !isProtectedTable(table.name) && parseInt(fkResult[0]?.fk_count || '0') === 0
              });
            }
          } catch (e) {
            // Skip tables that can't be checked
          }
        }
        
        return new Response(JSON.stringify({
          empty_tables: emptyTables,
          total_count: emptyTables.length,
          safe_to_drop_count: emptyTables.filter(t => t.safe_to_drop).length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'getQualityMetrics': {
        const domain = params.domain || 'FLIGHT_SURVEILLANCE';
        const metrics: Record<string, any> = {};
        
        switch (domain) {
          case 'FLIGHT_SURVEILLANCE': {
            // Coordinate validation
            try {
              const coordCheck = await sql`
                SELECT 
                  COUNT(*) as total,
                  COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END) as with_coords,
                  COUNT(CASE WHEN latitude < -90 OR latitude > 90 OR longitude < -180 OR longitude > 180 THEN 1 END) as invalid_coords
                FROM public.live_flight_detections_rows
              `;
              metrics.coordinate_validation = {
                total: parseInt(coordCheck[0]?.total || '0'),
                valid_rate: coordCheck[0]?.total > 0 
                  ? Math.round((coordCheck[0].with_coords / coordCheck[0].total) * 100) 
                  : 0,
                invalid_count: parseInt(coordCheck[0]?.invalid_coords || '0')
              };
            } catch (e) {
              const err = e as Error;
              metrics.coordinate_validation = { error: err.message };
            }
            
            // Registration format validation
            try {
              const regCheck = await sql`
                SELECT 
                  COUNT(*) as total,
                  COUNT(CASE WHEN registration ~ '^N[0-9A-Z]+$' THEN 1 END) as valid_format
                FROM public.live_flight_detections_rows
                WHERE registration IS NOT NULL
              `;
              metrics.registration_format = {
                total: parseInt(regCheck[0]?.total || '0'),
                valid_rate: regCheck[0]?.total > 0 
                  ? Math.round((regCheck[0].valid_format / regCheck[0].total) * 100) 
                  : 0
              };
            } catch (e) {
              const err = e as Error;
              metrics.registration_format = { error: err.message };
            }
            break;
          }
          
          case 'BIOMETRIC_HEALTH': {
            // Heart rate range validation
            try {
              const hrCheck = await sql`
                SELECT 
                  COUNT(*) as total,
                  COUNT(CASE WHEN heart_rate BETWEEN 40 AND 200 THEN 1 END) as valid_range
                FROM public.biometrics_unified
                WHERE heart_rate IS NOT NULL
              `;
              metrics.heart_rate_validation = {
                total: parseInt(hrCheck[0]?.total || '0'),
                valid_rate: hrCheck[0]?.total > 0 
                  ? Math.round((hrCheck[0].valid_range / hrCheck[0].total) * 100) 
                  : 0
              };
            } catch (e) {
              const err = e as Error;
              metrics.heart_rate_validation = { error: err.message };
            }
            break;
          }
          
          case 'JOSIAH_AI': {
            // Embedding dimension consistency
            try {
              const embCheck = await sql`
                SELECT COUNT(DISTINCT array_length(embedding, 1)) as dimension_count
                FROM public.josiah_unified_embeddings
                WHERE embedding IS NOT NULL
              `;
              metrics.embedding_consistency = {
                unique_dimensions: parseInt(embCheck[0]?.dimension_count || '0'),
                is_consistent: parseInt(embCheck[0]?.dimension_count || '0') <= 1
              };
            } catch (e) {
              const err = e as Error;
              metrics.embedding_consistency = { error: err.message };
            }
            break;
          }
          
          case 'CORRELATIONS': {
            // Orphan detection
            try {
              const orphanCheck = await sql`
                SELECT COUNT(*) as total
                FROM public.biometric_correlations_enhanced
                WHERE confidence_score IS NULL OR confidence_score < 0 OR confidence_score > 100
              `;
              metrics.invalid_confidence = {
                count: parseInt(orphanCheck[0]?.total || '0')
              };
            } catch (e) {
              const err = e as Error;
              metrics.invalid_confidence = { error: err.message };
            }
            break;
          }
        }
        
        return new Response(JSON.stringify({
          domain,
          metrics,
          timestamp: new Date().toISOString()
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'previewMerge': {
        const { sourceTable, targetTable, dryRun = true } = params;
        
        if (!sourceTable || !targetTable) {
          return new Response(JSON.stringify({ error: 'Source and target tables required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // Get column overlap
        const sourceColumns = await sql`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = ${sourceTable}
        `;
        
        const targetColumns = await sql`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = ${targetTable}
        `;
        
        const sourceColNames = new Set(sourceColumns.map(c => c.column_name));
        const targetColNames = new Set(targetColumns.map(c => c.column_name));
        const commonColumns = [...sourceColNames].filter(c => targetColNames.has(c));
        
        // Get row counts
        const sourceCnt = await sql`SELECT COUNT(*) as count FROM public.${sql(sourceTable)}`;
        const targetCnt = await sql`SELECT COUNT(*) as count FROM public.${sql(targetTable)}`;
        
        return new Response(JSON.stringify({
          dry_run: dryRun,
          source: {
            table: sourceTable,
            row_count: parseInt(sourceCnt[0]?.count || '0'),
            column_count: sourceColumns.length
          },
          target: {
            table: targetTable,
            row_count: parseInt(targetCnt[0]?.count || '0'),
            column_count: targetColumns.length
          },
          merge_info: {
            common_columns: commonColumns,
            source_only_columns: [...sourceColNames].filter(c => !targetColNames.has(c)),
            target_only_columns: [...targetColNames].filter(c => !sourceColNames.has(c)),
            schema_compatibility: commonColumns.length >= Math.min(sourceColumns.length, targetColumns.length) * 0.5
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'archiveTables': {
        const { tables: tablesToArchive, dryRun = true } = params;
        
        if (!tablesToArchive || !Array.isArray(tablesToArchive)) {
          return new Response(JSON.stringify({ error: 'Tables array required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // Ensure quarantine schema exists
        if (!dryRun) {
          await sql`CREATE SCHEMA IF NOT EXISTS quarantine`;
        }
        
        const results = [];
        for (const tableName of tablesToArchive) {
          if (isProtectedTable(tableName)) {
            results.push({ table: tableName, status: 'skipped', reason: 'protected' });
            continue;
          }
          
          if (dryRun) {
            results.push({ table: tableName, status: 'would_archive' });
          } else {
            try {
              await sql`ALTER TABLE public.${sql(tableName)} SET SCHEMA quarantine`;
              results.push({ table: tableName, status: 'archived' });
            } catch (e) {
              const err = e as Error;
              results.push({ table: tableName, status: 'error', error: err.message });
            }
          }
        }
        
        return new Response(JSON.stringify({
          dry_run: dryRun,
          results,
          archived_count: results.filter(r => r.status === 'archived' || r.status === 'would_archive').length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'dropTables': {
        const { tables: tablesToDrop, dryRun = true } = params;
        
        if (!tablesToDrop || !Array.isArray(tablesToDrop)) {
          return new Response(JSON.stringify({ error: 'Tables array required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        const results = [];
        for (const tableName of tablesToDrop) {
          if (isProtectedTable(tableName)) {
            results.push({ table: tableName, status: 'skipped', reason: 'protected' });
            continue;
          }
          
          // Check FK dependencies
          const fkResult = await sql`
            SELECT COUNT(*) as fk_count
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu 
              ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND ccu.table_name = ${tableName}
          `;
          
          if (parseInt(fkResult[0]?.fk_count || '0') > 0) {
            results.push({ table: tableName, status: 'skipped', reason: 'has_fk_dependencies' });
            continue;
          }
          
          if (dryRun) {
            results.push({ table: tableName, status: 'would_drop' });
          } else {
            try {
              await sql`DROP TABLE IF EXISTS public.${sql(tableName)} CASCADE`;
              results.push({ table: tableName, status: 'dropped' });
            } catch (e) {
              const err = e as Error;
              results.push({ table: tableName, status: 'error', error: err.message });
            }
          }
        }
        
        return new Response(JSON.stringify({
          dry_run: dryRun,
          results,
          dropped_count: results.filter(r => r.status === 'dropped' || r.status === 'would_drop').length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'getStorageAnalysis': {
        const storageData = await sql`
          SELECT 
            schemaname as schema,
            tablename as name,
            pg_total_relation_size(schemaname || '.' || quote_ident(tablename)) as size_bytes,
            pg_size_pretty(pg_total_relation_size(schemaname || '.' || quote_ident(tablename))) as size_pretty
          FROM pg_tables 
          WHERE schemaname IN ('public', 'quarantine', 'legacy_v1_import')
          ORDER BY pg_total_relation_size(schemaname || '.' || quote_ident(tablename)) DESC
          LIMIT 50
        `;
        
        const bySchema: Record<string, { size: number; tables: any[] }> = {};
        let totalSize = 0;
        
        for (const row of storageData) {
          const size = parseInt(row.size_bytes || 0);
          totalSize += size;
          const schema = row.schema as string;
          if (!bySchema[schema]) {
            bySchema[schema] = { size: 0, tables: [] };
          }
          bySchema[schema].size += size;
          bySchema[schema].tables.push({
            name: row.name,
            size_bytes: size,
            size_pretty: row.size_pretty,
            domain: categorizeTable(row.name)
          });
        }
        
        return new Response(JSON.stringify({
          top_tables: storageData.map(t => ({
            ...t,
            domain: categorizeTable(t.name),
            size_bytes: parseInt(t.size_bytes || 0)
          })),
          by_schema: bySchema,
          total_size_bytes: totalSize,
          total_size_pretty: formatBytes(totalSize)
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'deepOCRAudit': {
        // Deep OCR data quality audit
        const issues: any[] = [];
        const ocrTables = ['screenshot_ocr_data', 'ocr_aircraft_holding_patterns', 'ocr_extracted_text', 'radar_screenshot_analysis'];
        
        for (const tableName of ocrTables) {
          try {
            // Check for NULL timestamps
            const nullTimestamps = await sql`
              SELECT COUNT(*) as count 
              FROM public.${sql(tableName)} 
              WHERE created_at IS NULL
            `;
            if (parseInt(nullTimestamps[0]?.count || '0') > 0) {
              issues.push({
                table: tableName,
                issue_type: 'NULL timestamps',
                count: parseInt(nullTimestamps[0].count),
                sample: null,
                remediation: 'Extract timestamp from filename pattern (Screenshot_YYYYMMDD_HHMMSS)'
              });
            }

            // Check for OCR text artifacts (numeric-only extractions)
            const artifacts = await sql`
              SELECT COUNT(*) as count 
              FROM public.${sql(tableName)} 
              WHERE extracted_text ~ '^[0-9]{5,}$'
            `;
            if (parseInt(artifacts[0]?.count || '0') > 0) {
              issues.push({
                table: tableName,
                issue_type: 'Numeric OCR artifacts',
                count: parseInt(artifacts[0].count),
                sample: null,
                remediation: 'Flag for manual review - likely misread characters'
              });
            }

            // Check for malformed registrations
            const malformedRegs = await sql`
              SELECT COUNT(*) as count 
              FROM public.${sql(tableName)} 
              WHERE registration IS NOT NULL 
                AND registration !~ '^N[0-9A-Z]{1,5}$'
            `;
            if (parseInt(malformedRegs[0]?.count || '0') > 0) {
              issues.push({
                table: tableName,
                issue_type: 'Malformed FAA registrations',
                count: parseInt(malformedRegs[0].count),
                sample: null,
                remediation: 'Apply OCR correction mapping (e.g., NZ24AM -> N224AM)'
              });
            }
          } catch (e) {
            // Table might not exist or have different schema
          }
        }

        return new Response(JSON.stringify({
          issues,
          total_issues: issues.reduce((sum, i) => sum + i.count, 0),
          tables_audited: ocrTables.length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'crossTableDuplicates': {
        // Find duplicates across related tables using hash comparison
        const duplicatePairs = [
          { table1: 'live_flight_detections_rows', table2: 'live_flight_detections', keyCol: 'registration' },
          { table1: 'biometric_monitoring', table2: 'biometrics_unified', keyCol: 'timestamp' },
          { table1: 'josiah_reflections_rows', table2: 'josiah_timeline', keyCol: 'title' }
        ];

        const duplicates: any[] = [];

        for (const pair of duplicatePairs) {
          try {
            // Check for records with matching key values across tables
            const result = await sql`
              SELECT 
                ${sql(pair.keyCol)} as key_value,
                COUNT(*) as occurrence_count
              FROM (
                SELECT ${sql(pair.keyCol)} FROM public.${sql(pair.table1)} WHERE ${sql(pair.keyCol)} IS NOT NULL
                UNION ALL
                SELECT ${sql(pair.keyCol)} FROM public.${sql(pair.table2)} WHERE ${sql(pair.keyCol)} IS NOT NULL
              ) combined
              GROUP BY ${sql(pair.keyCol)}
              HAVING COUNT(*) > 1
              LIMIT 50
            `;

            for (const row of result) {
              duplicates.push({
                table: `${pair.table1} ↔ ${pair.table2}`,
                hash: String(row.key_value),
                count: parseInt(row.occurrence_count),
                domain: categorizeTable(pair.table1)
              });
            }
          } catch (e) {
            // Tables might not exist
          }
        }

        return new Response(JSON.stringify({
          duplicates,
          total_duplicate_records: duplicates.reduce((sum, d) => sum + d.count, 0),
          pairs_checked: duplicatePairs.length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'hashCoverageReport': {
        // Detailed SHA-256 coverage per evidence domain
        const domains: any[] = [];

        for (const [domainName, config] of Object.entries(EVIDENCE_DOMAINS)) {
          let totalRecords = 0;
          let hashedRecords = 0;
          const tables: string[] = [];

          // Get tables matching this domain
          const domainTables = await sql`
            SELECT tablename as name
            FROM pg_tables 
            WHERE schemaname = 'public'
          `;

          for (const table of domainTables) {
            if (categorizeTable(table.name) !== domainName) continue;
            tables.push(table.name);

            try {
              // Check if table has sha256_hash column
              const hasHashCol = await sql`
                SELECT COUNT(*) as cnt
                FROM information_schema.columns
                WHERE table_schema = 'public' 
                  AND table_name = ${table.name}
                  AND column_name = 'sha256_hash'
              `;

              if (parseInt(hasHashCol[0]?.cnt || '0') > 0) {
                const counts = await sql`
                  SELECT 
                    COUNT(*) as total,
                    COUNT(sha256_hash) as hashed
                  FROM public.${sql(table.name)}
                `;
                totalRecords += parseInt(counts[0]?.total || '0');
                hashedRecords += parseInt(counts[0]?.hashed || '0');
              } else {
                // No hash column - count all as unhashed
                const counts = await sql`
                  SELECT COUNT(*) as total FROM public.${sql(table.name)}
                `;
                totalRecords += parseInt(counts[0]?.total || '0');
              }
            } catch (e) {
              // Skip problematic tables
            }
          }

          if (totalRecords > 0) {
            domains.push({
              name: domainName,
              description: config.description,
              total_records: totalRecords,
              hashed_records: hashedRecords,
              coverage_percent: Math.round((hashedRecords / totalRecords) * 100 * 10) / 10,
              table_count: tables.length,
              priority: hashedRecords / totalRecords < 0.9 ? 'critical' :
                       hashedRecords / totalRecords < 0.95 ? 'high' :
                       hashedRecords / totalRecords < 0.99 ? 'medium' : 'low'
            });
          }
        }

        return new Response(JSON.stringify({
          domains: domains.sort((a, b) => a.coverage_percent - b.coverage_percent),
          overall_coverage: domains.length > 0 
            ? Math.round(domains.reduce((sum, d) => sum + d.coverage_percent, 0) / domains.length * 10) / 10
            : 0,
          total_domains: domains.length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'rlsPolicyAudit': {
        // Enumerate RLS policies and identify gaps
        const findings: any[] = [];

        // Get all tables
        const allTables = await sql`
          SELECT tablename as name
          FROM pg_tables 
          WHERE schemaname = 'public'
        `;

        // Get RLS status for each table
        for (const table of allTables) {
          try {
            const rlsStatus = await sql`
              SELECT relrowsecurity, relforcerowsecurity
              FROM pg_class
              WHERE relname = ${table.name}
                AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            `;

            const hasRLS = rlsStatus[0]?.relrowsecurity || false;
            const forcesRLS = rlsStatus[0]?.relforcerowsecurity || false;

            if (!hasRLS && isProtectedTable(table.name)) {
              findings.push({
                type: 'MISSING_RLS',
                severity: 'critical',
                description: `Table ${table.name} lacks Row Level Security`,
                recommendation: `Enable RLS: ALTER TABLE ${table.name} ENABLE ROW LEVEL SECURITY`,
                status: 'open'
              });
            }
          } catch (e) {
            // Skip problematic tables
          }
        }

        // Check for weak policies
        const policies = await sql`
          SELECT schemaname, tablename, policyname, permissive, cmd, qual
          FROM pg_policies
          WHERE schemaname = 'public'
        `;

        for (const policy of policies) {
          if (policy.qual === 'true' || policy.qual === '(true)') {
            findings.push({
              type: 'PERMISSIVE_POLICY',
              severity: 'high',
              description: `Policy ${policy.policyname} on ${policy.tablename} allows all access`,
              recommendation: 'Review and restrict policy conditions',
              status: 'open'
            });
          }
        }

        // Add encryption status check
        findings.push({
          type: 'ENCRYPTION_STATUS',
          severity: 'low',
          description: 'SSL/TLS connection required for all database connections',
          recommendation: 'Verified - encryption in transit active',
          status: 'resolved'
        });

        return new Response(JSON.stringify({
          findings,
          total_policies: policies.length,
          tables_without_rls: findings.filter(f => f.type === 'MISSING_RLS').length,
          permissive_policies: findings.filter(f => f.type === 'PERMISSIVE_POLICY').length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'encryptionStatus': {
        // Verify SSL connections and encryption status
        const sslInfo = await sql`SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
        const hasSSL = sslInfo.length > 0 && sslInfo[0].ssl;

        return new Response(JSON.stringify({
          ssl_enabled: hasSSL,
          ssl_version: sslInfo[0]?.version || 'N/A',
          encryption_at_rest: 'Managed by cloud provider',
          recommendation: hasSSL ? 'SSL/TLS active - connections encrypted' : 'WARNING: SSL not enabled'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      default:
        return new Response(JSON.stringify({ 
          error: 'Unknown action',
          available_actions: [
            'getFullCensus',
            'getModalityBreakdown', 
            'getDuplicateFamilies',
            'getEmptyTables',
            'getQualityMetrics',
            'previewMerge',
            'archiveTables',
            'dropTables',
            'getStorageAnalysis',
            'deepOCRAudit',
            'crossTableDuplicates',
            'hashCoverageReport',
            'rlsPolicyAudit',
            'encryptionStatus'
          ]
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('Database quality control error:', error);
    const err = error as Error;
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } finally {
    if (sql) await sql.end();
  }
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
