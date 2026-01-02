import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TableInfo {
  name: string;
  rows: number;
}

interface RegistrationIssue {
  value: string | null;
  count: number;
  validation: { valid: boolean; corrected?: string; issue?: string };
}

// Validate aircraft registration format
function validateRegistration(reg: string | null): { valid: boolean; corrected?: string; issue?: string } {
  if (!reg) return { valid: false, issue: 'NULL_REGISTRATION' };
  
  const upper = reg.toUpperCase().trim();
  
  // Known bad patterns
  const invalidPatterns = ['UNKNOWN', 'NUMBER', 'ENERGY', 'N/A', 'NONE', 'ERROR'];
  if (invalidPatterns.some(p => upper.includes(p))) {
    return { valid: false, issue: 'INVALID_PATTERN' };
  }
  
  // Standard N-number format: N + 1-5 alphanumeric
  const nNumberPattern = /^N[0-9A-Z]{1,5}$/;
  if (nNumberPattern.test(upper)) {
    return { valid: true };
  }
  
  // Common OCR errors: Z→2, O→0, S→5, I→1
  const corrected = upper
    .replace(/^NZ/, 'N2')
    .replace(/O/g, '0')
    .replace(/^NS/, 'N5')
    .replace(/I(?=[0-9])/g, '1');
  
  if (nNumberPattern.test(corrected) && corrected !== upper) {
    return { valid: false, corrected, issue: 'OCR_CORRECTION_AVAILABLE' };
  }
  
  return { valid: false, issue: 'MALFORMED_REGISTRATION' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
  
  if (!databaseUrl) {
    return new Response(
      JSON.stringify({ error: 'Database connection not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let sql: ReturnType<typeof postgres> | null = null;
  
  try {
    const body = await req.json();
    const { action } = body;
    
    sql = postgres(databaseUrl, {
      ssl: 'require',
      max: 1,
      idle_timeout: 30,
    });

    let result;

    switch (action) {
      case 'getAuditSummary': {
        // Get overall database health metrics
        const tableCount = await sql`
          SELECT COUNT(*) as count FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' AND n.nspname = 'public'
        `;
        
        const totalRecords = await sql`
          SELECT COALESCE(SUM(c.reltuples)::bigint, 0) as total
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' AND n.nspname = 'public'
        `;
        
        // Check hash coverage
        const tablesWithHash = await sql`
          SELECT COUNT(DISTINCT table_name) as count
          FROM information_schema.columns 
          WHERE table_schema = 'public' AND column_name = 'sha256_hash'
        `;
        
        // Get tables missing hash column
        const tablesMissingHash = await sql`
          SELECT c.relname as table_name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' AND n.nspname = 'public'
          AND c.relname NOT IN (
            SELECT DISTINCT table_name FROM information_schema.columns 
            WHERE table_schema = 'public' AND column_name = 'sha256_hash'
          )
          ORDER BY c.reltuples DESC
          LIMIT 50
        `;
        
        result = {
          tableCount: parseInt(tableCount[0]?.count || '0'),
          totalRecords: parseInt(totalRecords[0]?.total || '0'),
          tablesWithHash: parseInt(tablesWithHash[0]?.count || '0'),
          tablesMissingHash: tablesMissingHash.map((t) => (t as Record<string, unknown>).table_name as string),
          hashCoverage: tableCount[0]?.count > 0 
            ? Math.round((tablesWithHash[0]?.count / tableCount[0]?.count) * 100) 
            : 0
        };
        break;
      }

      case 'auditOcrTables': {
        // Audit OCR-related tables for data quality issues
        const ocrTables = [
          'screenshot_ocr_data',
          'ocr_aircraft_holding_patterns', 
          'ocr_extracted_text',
          'ocr_processing_results'
        ];
        
        const auditResults = [];
        
        for (const tableName of ocrTables) {
          try {
            // Check if table exists
            const exists = await sql`
              SELECT EXISTS (
                SELECT 1 FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = ${tableName}
              ) as exists
            `;
            
            if (!exists[0]?.exists) continue;
            
            // Get column info
            const columns = await sql`
              SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = ${tableName}
            `;
            const columnNames = columns.map((c) => (c as Record<string, unknown>).column_name as string);
            
            // Count total records
            const countResult = await sql.unsafe(`SELECT COUNT(*) as count FROM ${tableName}`);
            const totalRecords = parseInt(countResult[0]?.count || '0');
            
            // Check for NULL timestamps if timestamp column exists
            let nullTimestamps = 0;
            const timestampCols = columnNames.filter((c: string) => 
              c.includes('timestamp') || c.includes('created') || c.includes('date')
            );
            
            if (timestampCols.length > 0) {
              const nullCheck = await sql.unsafe(`
                SELECT COUNT(*) as count FROM ${tableName} 
                WHERE ${timestampCols[0]} IS NULL
              `);
              nullTimestamps = parseInt(nullCheck[0]?.count || '0');
            }
            
            // Check for registration issues if registration column exists
            const registrationIssues: RegistrationIssue[] = [];
            const regCol = columnNames.find((c: string) => 
              c.includes('registration') || c.includes('tail') || c === 'icao24'
            );
            
            if (regCol) {
              const badRegs = await sql.unsafe(`
                SELECT DISTINCT ${regCol} as reg, COUNT(*) as count
                FROM ${tableName}
                WHERE ${regCol} IS NULL 
                  OR ${regCol} ILIKE '%UNKNOWN%'
                  OR ${regCol} ILIKE '%NUMBER%'
                  OR ${regCol} ILIKE '%ENERGY%'
                  OR LENGTH(${regCol}) < 2
                GROUP BY ${regCol}
                ORDER BY count DESC
                LIMIT 20
              `);
              
              for (const r of badRegs) {
                registrationIssues.push({
                  value: r.reg,
                  count: parseInt(r.count),
                  validation: validateRegistration(r.reg)
                });
              }
            }
            
            auditResults.push({
              table: tableName,
              totalRecords,
              nullTimestamps,
              registrationIssues,
              hasHashColumn: columnNames.includes('sha256_hash'),
              status: nullTimestamps === 0 && registrationIssues.length === 0 ? 'CLEAN' : 'NEEDS_ATTENTION'
            });
            
          } catch (tableError) {
            console.error(`Error auditing ${tableName}:`, tableError);
            auditResults.push({
              table: tableName,
              error: tableError instanceof Error ? tableError.message : 'Unknown error',
              status: 'ERROR'
            });
          }
        }
        
        result = auditResults;
        break;
      }

      case 'auditJosiahCorrelations': {
        // Verify Josiah correlations have valid source references
        const correlationTables = [
          'josiah_reflections_rows',
          'josiah_unified_embeddings',
          'josiah_timeline'
        ];
        
        const verificationResults = [];
        
        for (const tableName of correlationTables) {
          try {
            const exists = await sql`
              SELECT EXISTS (
                SELECT 1 FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = ${tableName}
              ) as exists
            `;
            
            if (!exists[0]?.exists) continue;
            
            const countResult = await sql.unsafe(`SELECT COUNT(*) as count FROM ${tableName}`);
            const totalRecords = parseInt(countResult[0]?.count || '0');
            
            // Sample records for verification
            const samples = await sql.unsafe(`
              SELECT * FROM ${tableName} 
              ORDER BY RANDOM() 
              LIMIT 5
            `);
            
            verificationResults.push({
              table: tableName,
              totalRecords,
              sampleCount: samples.length,
              status: totalRecords > 0 ? 'VERIFIED' : 'EMPTY'
            });
            
          } catch (err) {
            verificationResults.push({
              table: tableName,
              error: err instanceof Error ? err.message : 'Unknown error',
              status: 'ERROR'
            });
          }
        }
        
        result = verificationResults;
        break;
      }

      case 'getEvidenceDomains': {
        // Categorize all tables by evidence domain
        const domains: Record<string, TableInfo[]> = {
          flight_tracking: [],
          biometric: [],
          josiah_ai: [],
          ocr_screenshots: [],
          forensic_files: [],
          legal_violations: [],
          aircraft_registry: [],
          shell_companies: [],
          kcso_evidence: [],
          coordination_ops: [],
          other: []
        };
        
        const tables = await sql`
          SELECT c.relname as table_name, c.reltuples::bigint as row_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' AND n.nspname = 'public'
          ORDER BY c.reltuples DESC
        `;
        
        for (const t of tables) {
          const name = (t.table_name as string).toLowerCase();
          const info: TableInfo = { name: t.table_name as string, rows: parseInt(t.row_count as string || '0') };
          
          if (name.includes('flight') || name.includes('detection') || name.includes('adsb') || name.includes('radar')) {
            domains.flight_tracking.push(info);
          } else if (name.includes('biometric') || name.includes('heart') || name.includes('ecg') || name.includes('stress')) {
            domains.biometric.push(info);
          } else if (name.includes('josiah') || name.includes('reflection') || name.includes('embedding')) {
            domains.josiah_ai.push(info);
          } else if (name.includes('ocr') || name.includes('screenshot') || name.includes('image')) {
            domains.ocr_screenshots.push(info);
          } else if (name.includes('forensic') || name.includes('file') || name.includes('catalog')) {
            domains.forensic_files.push(info);
          } else if (name.includes('legal') || name.includes('violation') || name.includes('ada')) {
            domains.legal_violations.push(info);
          } else if (name.includes('aircraft') || name.includes('registry') || name.includes('operator')) {
            domains.aircraft_registry.push(info);
          } else if (name.includes('shell') || name.includes('company') || name.includes('enterprise')) {
            domains.shell_companies.push(info);
          } else if (name.includes('kcso') || name.includes('sheriff')) {
            domains.kcso_evidence.push(info);
          } else if (name.includes('coordin') || name.includes('operation') || name.includes('correlation')) {
            domains.coordination_ops.push(info);
          } else {
            domains.other.push(info);
          }
        }
        
        // Calculate totals per domain
        const summary: Record<string, { tableCount: number; totalRows: number; tables: TableInfo[] }> = {};
        for (const [domain, tableList] of Object.entries(domains)) {
          summary[domain] = {
            tableCount: tableList.length,
            totalRows: tableList.reduce((sum, t) => sum + t.rows, 0),
            tables: tableList
          };
        }
        
        result = summary;
        break;
      }

      case 'getTimelineRange': {
        // Get the date range of evidence
        const ranges = [];
        
        // Check various timestamp tables - use active tables only
        const timestampQueries = [
          { table: 'live_flight_detections_rows', column: 'detection_timestamp' },
          { table: 'josiah_timeline', column: 'timestamp' },
          { table: 'biometric_monitoring', column: 'timestamp' },
          { table: 'forensic_log_catalog', column: 'created_at' }
        ];
        
        for (const { table, column } of timestampQueries) {
          try {
            const range = await sql.unsafe(`
              SELECT 
                MIN(${column}) as earliest,
                MAX(${column}) as latest,
                COUNT(*) as count
              FROM ${table}
              WHERE ${column} IS NOT NULL
            `);
            
            if (range[0]?.earliest) {
              ranges.push({
                table,
                earliest: range[0].earliest,
                latest: range[0].latest,
                count: parseInt(range[0].count || '0')
              });
            }
          } catch (_e) {
            // Table might not exist
          }
        }
        
        result = ranges;
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await sql.end();

    return new Response(
      JSON.stringify({ data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Audit error:', err);
    if (sql) {
      try { await sql.end(); } catch (_e) { /* ignore */ }
    }
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
