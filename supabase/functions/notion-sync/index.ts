import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Compute SHA-256 hash
async function computeSHA256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
    const { action, events, reflections } = await req.json();
    
    sql = postgres(databaseUrl, {
      ssl: 'require',
      max: 1,
      idle_timeout: 30,
    });

    let result;

    switch (action) {
      case 'syncWTPREvents': {
        // Sync WTPR events from Notion to NeonDB flight_events table
        if (!events || !Array.isArray(events)) {
          throw new Error('Events array required');
        }

        // Check if flight_events table exists and has necessary columns
        const tableCheck = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = 'flight_events' AND table_schema = 'public'
        `;
        
        const columns = tableCheck.map(c => c.column_name);
        const inserted: string[] = [];
        const skipped: string[] = [];
        const errors: { event: string; error: string }[] = [];

        for (const event of events) {
          try {
            // Check if event already exists by WTPR ID or similar identifier
            const existing = await sql`
              SELECT id FROM flight_events 
              WHERE event_id = ${event.event_id} 
              OR (registration = ${event.registration} AND timestamp = ${event.timestamp})
              LIMIT 1
            `;

            if (existing.length > 0) {
              skipped.push(event.event_id || event.registration);
              continue;
            }

            // Compute SHA-256 hash for chain of custody
            const dataString = [
              event.event_id || '',
              event.registration || '',
              event.timestamp || '',
              event.altitude || '',
              event.zone || '',
              event.event_type || '',
              event.description || '',
              event.source || 'notion'
            ].join('|');
            
            const sha256_hash = await computeSHA256(dataString);

            // Insert new event
            await sql`
              INSERT INTO flight_events (
                event_id, registration, timestamp, altitude_ft, 
                zone, event_type, description, source, sha256_hash, created_at
              ) VALUES (
                ${event.event_id || null},
                ${event.registration || null},
                ${event.timestamp || null},
                ${event.altitude || null},
                ${event.zone || null},
                ${event.event_type || null},
                ${event.description || null},
                ${'notion'},
                ${sha256_hash},
                NOW()
              )
            `;
            
            inserted.push(event.event_id || event.registration);
          } catch (e) {
            errors.push({ 
              event: event.event_id || event.registration, 
              error: (e as Error).message 
            });
          }
        }

        result = {
          action: 'syncWTPREvents',
          inserted: inserted.length,
          skipped: skipped.length,
          errors: errors.length,
          insertedEvents: inserted,
          skippedEvents: skipped,
          errorDetails: errors,
          message: `Synced ${inserted.length} WTPR events from Notion (${skipped.length} already existed)`
        };
        break;
      }

      case 'syncJosiahReflections': {
        // Sync Josiah reflections from Notion to NeonDB
        if (!reflections || !Array.isArray(reflections)) {
          throw new Error('Reflections array required');
        }

        // Check/create josiah_reflections table if needed
        const tableExists = await sql`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'josiah_reflections'
          ) as exists
        `;

        if (!tableExists[0].exists) {
          await sql`
            CREATE TABLE josiah_reflections (
              id SERIAL PRIMARY KEY,
              reflection_id TEXT UNIQUE,
              title TEXT,
              content TEXT,
              reflection_date TIMESTAMPTZ,
              category TEXT,
              tags TEXT[],
              notion_url TEXT,
              sha256_hash TEXT,
              synced_at TIMESTAMPTZ DEFAULT NOW(),
              created_at TIMESTAMPTZ DEFAULT NOW()
            )
          `;
          await sql`CREATE INDEX idx_josiah_reflections_sha256 ON josiah_reflections(sha256_hash)`;
          await sql`CREATE INDEX idx_josiah_reflections_date ON josiah_reflections(reflection_date)`;
        }

        // Ensure sha256_hash column exists
        const hasHashCol = await sql`
          SELECT COUNT(*) as count FROM information_schema.columns 
          WHERE table_name = 'josiah_reflections' AND column_name = 'sha256_hash'
        `;
        
        if (parseInt(hasHashCol[0].count) === 0) {
          await sql`ALTER TABLE josiah_reflections ADD COLUMN sha256_hash TEXT`;
          await sql`CREATE INDEX idx_josiah_reflections_sha256 ON josiah_reflections(sha256_hash)`;
        }

        const inserted: string[] = [];
        const updated: string[] = [];
        const errors: { reflection: string; error: string }[] = [];

        for (const reflection of reflections) {
          try {
            // Compute SHA-256 hash
            const dataString = [
              reflection.reflection_id || '',
              reflection.title || '',
              reflection.content || '',
              reflection.reflection_date || '',
              reflection.category || '',
              JSON.stringify(reflection.tags || [])
            ].join('|');
            
            const sha256_hash = await computeSHA256(dataString);

            // Upsert reflection
            const existing = await sql`
              SELECT id FROM josiah_reflections 
              WHERE reflection_id = ${reflection.reflection_id}
              LIMIT 1
            `;

            if (existing.length > 0) {
              await sql`
                UPDATE josiah_reflections SET
                  title = ${reflection.title || null},
                  content = ${reflection.content || null},
                  reflection_date = ${reflection.reflection_date || null},
                  category = ${reflection.category || null},
                  tags = ${reflection.tags || []},
                  notion_url = ${reflection.notion_url || null},
                  sha256_hash = ${sha256_hash},
                  synced_at = NOW()
                WHERE reflection_id = ${reflection.reflection_id}
              `;
              updated.push(reflection.reflection_id);
            } else {
              await sql`
                INSERT INTO josiah_reflections (
                  reflection_id, title, content, reflection_date,
                  category, tags, notion_url, sha256_hash, synced_at
                ) VALUES (
                  ${reflection.reflection_id},
                  ${reflection.title || null},
                  ${reflection.content || null},
                  ${reflection.reflection_date || null},
                  ${reflection.category || null},
                  ${reflection.tags || []},
                  ${reflection.notion_url || null},
                  ${sha256_hash},
                  NOW()
                )
              `;
              inserted.push(reflection.reflection_id);
            }
          } catch (e) {
            errors.push({ 
              reflection: reflection.reflection_id || reflection.title, 
              error: (e as Error).message 
            });
          }
        }

        result = {
          action: 'syncJosiahReflections',
          inserted: inserted.length,
          updated: updated.length,
          errors: errors.length,
          insertedReflections: inserted,
          updatedReflections: updated,
          errorDetails: errors,
          message: `Synced ${inserted.length + updated.length} Josiah reflections (${inserted.length} new, ${updated.length} updated)`
        };
        break;
      }

      case 'getGapAnalysis': {
        // Analyze gaps between Notion and NeonDB
        
        // Get NeonDB flight_events date range
        const flightRange = await sql`
          SELECT 
            MIN(timestamp) as earliest,
            MAX(timestamp) as latest,
            COUNT(*) as count
          FROM flight_events
        `;

        // Get NeonDB josiah_reflections stats
        const reflectionStats = await sql`
          SELECT 
            MIN(reflection_date) as earliest,
            MAX(reflection_date) as latest,
            COUNT(*) as count
          FROM josiah_reflections
        `;

        result = {
          flightEvents: {
            earliest: flightRange[0]?.earliest,
            latest: flightRange[0]?.latest,
            count: parseInt(flightRange[0]?.count || '0')
          },
          josiahReflections: {
            earliest: reflectionStats[0]?.earliest,
            latest: reflectionStats[0]?.latest,
            count: parseInt(reflectionStats[0]?.count || '0')
          },
          message: 'Gap analysis complete - compare with Notion data ranges'
        };
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
    const error = err as Error;
    console.error('Notion sync error:', error);
    if (sql) {
      try { await sql.end(); } catch (e) { console.error('Error closing connection:', e); }
    }
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
