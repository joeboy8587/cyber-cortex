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
              OR (registration = ${event.registration} AND detection_timestamp = ${event.timestamp})
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

            // Insert new event (match actual flight_events schema)
            await sql`
              INSERT INTO flight_events (
                event_id,
                registration,
                detection_timestamp,
                altitude_feet,
                zone,
                event_type,
                notes,
                detection_method,
                sha256_hash,
                created_at
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
        // Sync Josiah reflections from Notion to existing josiah_reflections_rows table
        if (!reflections || !Array.isArray(reflections)) {
          throw new Error('Reflections array required');
        }

        const inserted: string[] = [];
        const updated: string[] = [];
        const errors: { reflection: string; error: string }[] = [];

        for (const reflection of reflections) {
          try {
            const reflectionId = String(reflection.reflection_id || '').trim();
            if (!reflectionId) {
              throw new Error('reflection_id is required');
            }

            // Compute SHA-256 hash
            const dataString = [
              reflectionId,
              reflection.title || '',
              reflection.content || '',
              reflection.reflection_date || '',
              reflection.category || '',
              JSON.stringify(reflection.tags || [])
            ].join('|');

            const sha256_hash = await computeSHA256(dataString);

            // Upsert into josiah_reflections_rows
            const existing = await sql`
              SELECT id FROM josiah_reflections_rows
              WHERE id = ${reflectionId}
              LIMIT 1
            `;

            const mapped = {
              id: reflectionId,
              reflection_content: reflection.content || null,
              trigger_type: reflection.category || null,
              created_at: reflection.reflection_date || null,
              source: 'notion',
              sha256_hash,
            };

            if (existing.length > 0) {
              await sql`
                UPDATE josiah_reflections_rows SET
                  reflection_content = ${mapped.reflection_content},
                  trigger_type = ${mapped.trigger_type},
                  created_at = ${mapped.created_at},
                  source = ${mapped.source},
                  sha256_hash = ${mapped.sha256_hash}
                WHERE id = ${reflectionId}
              `;
              updated.push(reflectionId);
            } else {
              await sql`
                INSERT INTO josiah_reflections_rows (
                  id,
                  reflection_content,
                  trigger_type,
                  created_at,
                  source,
                  sha256_hash
                ) VALUES (
                  ${mapped.id},
                  ${mapped.reflection_content},
                  ${mapped.trigger_type},
                  ${mapped.created_at},
                  ${mapped.source},
                  ${mapped.sha256_hash}
                )
              `;
              inserted.push(reflectionId);
            }
          } catch (e) {
            errors.push({
              reflection: reflection?.reflection_id || reflection?.title || 'unknown',
              error: (e as Error).message,
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
            MIN(detection_timestamp) as earliest,
            MAX(detection_timestamp) as latest,
            COUNT(*) as count
          FROM flight_events
        `;

        // Get NeonDB josiah_reflections_rows stats
        const reflectionStats = await sql`
          SELECT 
            MIN(created_at) as earliest,
            MAX(created_at) as latest,
            COUNT(*) as count
          FROM josiah_reflections_rows
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
