import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize forensic tables in Neon
async function initializeForensicTables(sql: ReturnType<typeof postgres>) {
  console.log('[forensic-linker] Checking/creating forensic tables in Neon...');
  
  // Create entity_type enum if not exists
  await sql`
    DO $$ BEGIN
      CREATE TYPE entity_type AS ENUM ('aircraft', 'operator', 'agency', 'shell_company', 'contractor', 'individual');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `;

  // Create forensic_event_type enum if not exists
  await sql`
    DO $$ BEGIN
      CREATE TYPE forensic_event_type AS ENUM ('flight', 'biometric', 'witness', 'ocr', 'legal', 'alert', 'multi_factor');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `;

  // Create link_type enum if not exists
  await sql`
    DO $$ BEGIN
      CREATE TYPE link_type AS ENUM ('temporal', 'causal', 'witness', 'documentary', 'biometric', 'spatial');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `;

  // Create master_forensic_events table
  await sql`
    CREATE TABLE IF NOT EXISTS master_forensic_events (
      forensic_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_timestamp TIMESTAMPTZ NOT NULL,
      event_type forensic_event_type NOT NULL,
      primary_entity_type entity_type,
      primary_entity_id TEXT,
      geo_lat DOUBLE PRECISION,
      geo_lng DOUBLE PRECISION,
      confidence_score INTEGER DEFAULT 50,
      bradford_hill_score NUMERIC,
      chain_of_custody_hash TEXT,
      linked_records JSONB DEFAULT '[]'::jsonb,
      temporal_cluster_id UUID,
      is_physical_verified BOOLEAN DEFAULT false,
      factor_count INTEGER DEFAULT 1,
      summary TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Create entity_registry table
  await sql`
    CREATE TABLE IF NOT EXISTS entity_registry (
      entity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type entity_type NOT NULL,
      canonical_identifier TEXT NOT NULL,
      aliases TEXT[] DEFAULT '{}',
      source_tables JSONB DEFAULT '[]'::jsonb,
      first_seen TIMESTAMPTZ,
      last_seen TIMESTAMPTZ,
      threat_classification TEXT,
      linked_forensic_events UUID[] DEFAULT '{}',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(entity_type, canonical_identifier)
    )
  `;

  // Create evidence_chain_links table
  await sql`
    CREATE TABLE IF NOT EXISTS evidence_chain_links (
      link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      forensic_event_id UUID REFERENCES master_forensic_events(forensic_event_id),
      source_table TEXT NOT NULL,
      source_id TEXT NOT NULL,
      link_type link_type NOT NULL,
      link_confidence INTEGER DEFAULT 50,
      link_hash TEXT,
      linked_by TEXT DEFAULT 'system',
      linked_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Create correlation_job_status table
  await sql`
    CREATE TABLE IF NOT EXISTS correlation_job_status (
      job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_type TEXT NOT NULL,
      target_table TEXT,
      status TEXT DEFAULT 'pending',
      total_records INTEGER,
      processed_records INTEGER DEFAULT 0,
      linked_records INTEGER DEFAULT 0,
      error_message TEXT,
      last_cursor TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Create indexes for performance
  await sql`CREATE INDEX IF NOT EXISTS idx_mfe_event_timestamp ON master_forensic_events(event_timestamp)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_mfe_event_type ON master_forensic_events(event_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_mfe_primary_entity ON master_forensic_events(primary_entity_type, primary_entity_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ecl_forensic_event ON evidence_chain_links(forensic_event_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ecl_source ON evidence_chain_links(source_table, source_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_er_canonical ON entity_registry(entity_type, canonical_identifier)`;
  
  console.log('[forensic-linker] Forensic tables initialized successfully');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const neonUrl = Deno.env.get('NEON_DATABASE_URL');
  if (!neonUrl) {
    return new Response(JSON.stringify({ error: 'NEON_DATABASE_URL not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const sql = postgres(neonUrl, { ssl: 'require' });

  try {
    const { action, ...params } = await req.json();
    console.log(`[forensic-linker] Action: ${action}`, params);

    // Initialize tables on first call or explicit request
    if (action === 'initTables' || action === 'getStats') {
      await initializeForensicTables(sql);
    }

    let result;

    switch (action) {
      case 'getStats': {
        // Get current linkage statistics
        const [forensicEvents] = await sql`SELECT COUNT(*) as count FROM master_forensic_events`;
        const [entities] = await sql`SELECT COUNT(*) as count FROM entity_registry`;
        const [chainLinks] = await sql`SELECT COUNT(*) as count FROM evidence_chain_links`;
        const [flights] = await sql`SELECT COUNT(*) as count FROM live_flight_detections_rows`;
        const [biometrics] = await sql`SELECT COUNT(*) as count FROM biometric_monitoring`;
        
        // Get linked counts
        const [linkedFlights] = await sql`
          SELECT COUNT(DISTINCT source_id) as count 
          FROM evidence_chain_links 
          WHERE source_table = 'live_flight_detections_rows'
        `;
        const [linkedBiometrics] = await sql`
          SELECT COUNT(DISTINCT source_id) as count 
          FROM evidence_chain_links 
          WHERE source_table = 'biometric_monitoring'
        `;

        result = {
          forensicEvents: parseInt(forensicEvents.count),
          entities: parseInt(entities.count),
          chainLinks: parseInt(chainLinks.count),
          totalFlights: parseInt(flights.count),
          linkedFlights: parseInt(linkedFlights.count),
          totalBiometrics: parseInt(biometrics.count),
          linkedBiometrics: parseInt(linkedBiometrics.count),
          flightCoverage: flights.count > 0 ? (linkedFlights.count / flights.count * 100).toFixed(2) : 0,
          biometricCoverage: biometrics.count > 0 ? (linkedBiometrics.count / biometrics.count * 100).toFixed(2) : 0
        };
        break;
      }

      case 'backfillFlights': {
        // Process flights in batches and create forensic events
        const batchSize = params.batchSize || 1000;
        const offset = params.offset || 0;

        // Create or get job status
        let jobId = params.jobId;
        if (!jobId) {
          const [job] = await sql`
            INSERT INTO correlation_job_status (job_type, target_table, status, started_at)
            VALUES ('backfillFlights', 'live_flight_detections_rows', 'running', now())
            RETURNING job_id
          `;
          jobId = job.job_id;
        }

        // Fetch batch of flights
        const flights = await sql`
          SELECT id, registration, detection_timestamp, latitude, longitude, 
                 altitude, operator, aircraft_type, callsign
          FROM live_flight_detections_rows
          WHERE id NOT IN (
            SELECT source_id::uuid FROM evidence_chain_links 
            WHERE source_table = 'live_flight_detections_rows'
          )
          ORDER BY detection_timestamp
          LIMIT ${batchSize}
          OFFSET ${offset}
        `;

        let created = 0;
        for (const flight of flights) {
          // Create forensic event
          const [event] = await sql`
            INSERT INTO master_forensic_events (
              event_timestamp, event_type, primary_entity_type, primary_entity_id,
              geo_lat, geo_lng, confidence_score, summary
            ) VALUES (
              ${flight.detection_timestamp}, 'flight', 'aircraft', ${flight.registration},
              ${flight.latitude}, ${flight.longitude}, 70,
              ${`Flight detection: ${flight.registration} - ${flight.operator || 'Unknown operator'}`}
            )
            RETURNING forensic_event_id
          `;

          // Create chain link
          await sql`
            INSERT INTO evidence_chain_links (
              forensic_event_id, source_table, source_id, link_type, link_confidence
            ) VALUES (
              ${event.forensic_event_id}, 'live_flight_detections_rows', 
              ${flight.id.toString()}, 'temporal', 70
            )
          `;

          // Register entity if not exists
          await sql`
            INSERT INTO entity_registry (entity_type, canonical_identifier, first_seen, last_seen, source_tables)
            VALUES ('aircraft', ${flight.registration}, ${flight.detection_timestamp}, ${flight.detection_timestamp}, 
                    ${JSON.stringify(['live_flight_detections_rows'])})
            ON CONFLICT (entity_type, canonical_identifier) 
            DO UPDATE SET 
              last_seen = GREATEST(entity_registry.last_seen, ${flight.detection_timestamp}),
              source_tables = entity_registry.source_tables || ${JSON.stringify(['live_flight_detections_rows'])}
          `;

          created++;
        }

        // Update job status
        await sql`
          UPDATE correlation_job_status 
          SET processed_records = processed_records + ${created},
              linked_records = linked_records + ${created},
              last_cursor = ${(offset + batchSize).toString()}
          WHERE job_id = ${jobId}
        `;

        const hasMore = flights.length === batchSize;
        if (!hasMore) {
          await sql`
            UPDATE correlation_job_status 
            SET status = 'completed', completed_at = now()
            WHERE job_id = ${jobId}
          `;
        }

        result = { 
          jobId, 
          processed: created, 
          offset: offset + batchSize, 
          hasMore,
          message: `Created ${created} forensic events from flights`
        };
        break;
      }

      case 'backfillBiometrics': {
        // Process biometrics and link to existing forensic events
        const batchSize = params.batchSize || 500;
        const timeWindowMinutes = params.timeWindowMinutes || 5;

        let jobId = params.jobId;
        if (!jobId) {
          const [job] = await sql`
            INSERT INTO correlation_job_status (job_type, target_table, status, started_at)
            VALUES ('backfillBiometrics', 'biometric_monitoring', 'running', now())
            RETURNING job_id
          `;
          jobId = job.job_id;
        }

        // Fetch unlinked biometrics
        const biometrics = await sql`
          SELECT id, measurement_timestamp, heart_rate, hrv_ms, stress_level
          FROM biometric_monitoring
          WHERE id NOT IN (
            SELECT source_id::uuid FROM evidence_chain_links 
            WHERE source_table = 'biometric_monitoring'
          )
          ORDER BY measurement_timestamp
          LIMIT ${batchSize}
        `;

        let linked = 0;
        let newEvents = 0;

        for (const bio of biometrics) {
          // Find forensic events within time window
          const events = await sql`
            SELECT forensic_event_id, event_timestamp, primary_entity_id
            FROM master_forensic_events
            WHERE event_type = 'flight'
              AND ABS(EXTRACT(EPOCH FROM (event_timestamp - ${bio.measurement_timestamp}))) <= ${timeWindowMinutes * 60}
            ORDER BY ABS(EXTRACT(EPOCH FROM (event_timestamp - ${bio.measurement_timestamp})))
            LIMIT 5
          `;

          if (events.length > 0) {
            // Link to closest event
            const closestEvent = events[0];
            
            await sql`
              INSERT INTO evidence_chain_links (
                forensic_event_id, source_table, source_id, link_type, link_confidence
              ) VALUES (
                ${closestEvent.forensic_event_id}, 'biometric_monitoring', 
                ${bio.id.toString()}, 'biometric', 
                ${bio.heart_rate > 100 ? 90 : 70}
              )
            `;

            // Update forensic event
            await sql`
              UPDATE master_forensic_events 
              SET is_physical_verified = true,
                  factor_count = factor_count + 1,
                  confidence_score = LEAST(confidence_score + 10, 100)
              WHERE forensic_event_id = ${closestEvent.forensic_event_id}
            `;

            linked++;
          } else {
            // Create new biometric-only event
            const [event] = await sql`
              INSERT INTO master_forensic_events (
                event_timestamp, event_type, confidence_score, is_physical_verified, summary
              ) VALUES (
                ${bio.measurement_timestamp}, 'biometric', 60, true,
                ${`Biometric reading: HR ${bio.heart_rate}, HRV ${bio.hrv_ms}ms, Stress ${bio.stress_level}`}
              )
              RETURNING forensic_event_id
            `;

            await sql`
              INSERT INTO evidence_chain_links (
                forensic_event_id, source_table, source_id, link_type, link_confidence
              ) VALUES (
                ${event.forensic_event_id}, 'biometric_monitoring', 
                ${bio.id.toString()}, 'biometric', 80
              )
            `;

            newEvents++;
          }
        }

        // Update job status
        await sql`
          UPDATE correlation_job_status 
          SET processed_records = processed_records + ${biometrics.length},
              linked_records = linked_records + ${linked + newEvents}
          WHERE job_id = ${jobId}
        `;

        const hasMore = biometrics.length === batchSize;
        if (!hasMore) {
          await sql`
            UPDATE correlation_job_status 
            SET status = 'completed', completed_at = now()
            WHERE job_id = ${jobId}
          `;
        }

        result = { 
          jobId, 
          processed: biometrics.length,
          linkedToExisting: linked,
          newEventsCreated: newEvents,
          hasMore,
          message: `Processed ${biometrics.length} biometrics: ${linked} linked, ${newEvents} new events`
        };
        break;
      }

      case 'backfillJosiah': {
        // Link Josiah reflections to forensic events
        const batchSize = params.batchSize || 200;
        const timeWindowMinutes = params.timeWindowMinutes || 30;

        const reflections = await sql`
          SELECT id, timestamp, content, aircraft_detected, biometric_stress_detected
          FROM josiah_reflections_rows
          WHERE id NOT IN (
            SELECT source_id::uuid FROM evidence_chain_links 
            WHERE source_table = 'josiah_reflections_rows'
          )
          LIMIT ${batchSize}
        `;

        let linked = 0;
        for (const ref of reflections) {
          // Find forensic events within time window
          const events = await sql`
            SELECT forensic_event_id 
            FROM master_forensic_events
            WHERE ABS(EXTRACT(EPOCH FROM (event_timestamp - ${ref.timestamp}))) <= ${timeWindowMinutes * 60}
            ORDER BY ABS(EXTRACT(EPOCH FROM (event_timestamp - ${ref.timestamp})))
            LIMIT 1
          `;

          if (events.length > 0) {
            await sql`
              INSERT INTO evidence_chain_links (
                forensic_event_id, source_table, source_id, link_type, link_confidence
              ) VALUES (
                ${events[0].forensic_event_id}, 'josiah_reflections_rows', 
                ${ref.id.toString()}, 'witness', 85
              )
            `;

            await sql`
              UPDATE master_forensic_events 
              SET factor_count = factor_count + 1,
                  confidence_score = LEAST(confidence_score + 15, 100)
              WHERE forensic_event_id = ${events[0].forensic_event_id}
            `;

            linked++;
          } else {
            // Create witness-only event
            const [event] = await sql`
              INSERT INTO master_forensic_events (
                event_timestamp, event_type, confidence_score, summary
              ) VALUES (
                ${ref.timestamp}, 'witness', 75,
                ${`Josiah witness log: ${(ref.content || '').substring(0, 100)}...`}
              )
              RETURNING forensic_event_id
            `;

            await sql`
              INSERT INTO evidence_chain_links (
                forensic_event_id, source_table, source_id, link_type, link_confidence
              ) VALUES (
                ${event.forensic_event_id}, 'josiah_reflections_rows', 
                ${ref.id.toString()}, 'witness', 85
              )
            `;

            linked++;
          }
        }

        result = { 
          processed: reflections.length, 
          linked,
          hasMore: reflections.length === batchSize,
          message: `Linked ${linked} Josiah reflections`
        };
        break;
      }

      case 'resolveEntities': {
        // Unify entities across tables
        const entityTables = [
          { table: 'aircraft_profiles', idCol: 'registration', type: 'aircraft' },
          { table: 'operator_profiles', idCol: 'operator_name', type: 'operator' },
          { table: 'shell_company_matrix', idCol: 'company_name', type: 'shell_company' },
          { table: 'aircraft_registry_enhanced_rows', idCol: 'n_number', type: 'aircraft' }
        ];

        let resolved = 0;
        for (const { table, idCol, type } of entityTables) {
          try {
            const entities = await sql`
              SELECT DISTINCT ${sql(idCol)} as identifier
              FROM ${sql(table)}
              WHERE ${sql(idCol)} IS NOT NULL
            `;

            for (const entity of entities) {
              await sql`
                INSERT INTO entity_registry (entity_type, canonical_identifier, source_tables)
                VALUES (${type}::entity_type, ${entity.identifier}, ${JSON.stringify([table])})
                ON CONFLICT (entity_type, canonical_identifier) 
                DO UPDATE SET source_tables = 
                  CASE 
                    WHEN NOT (entity_registry.source_tables @> ${JSON.stringify([table])}::jsonb)
                    THEN entity_registry.source_tables || ${JSON.stringify([table])}::jsonb
                    ELSE entity_registry.source_tables
                  END
              `;
            resolved++;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(`[forensic-linker] Table ${table} not found or error:`, message);
        }
        }

        result = { resolved, message: `Resolved ${resolved} entities across tables` };
        break;
      }

      case 'calculateBradfordHill': {
        // Calculate Bradford Hill scores for forensic events with multiple factors
        const events = await sql`
          SELECT forensic_event_id, factor_count, is_physical_verified, 
                 primary_entity_id, event_timestamp
          FROM master_forensic_events
          WHERE factor_count >= 2
            AND bradford_hill_score IS NULL
          LIMIT 500
        `;

        let scored = 0;
        for (const event of events) {
          // Count linked evidence
          const [linkCount] = await sql`
            SELECT COUNT(*) as count, 
                   COUNT(DISTINCT link_type) as type_count
            FROM evidence_chain_links
            WHERE forensic_event_id = ${event.forensic_event_id}
          `;

          // Calculate Bradford Hill score components
          let score = 0;
          
          // Strength: more links = higher score
          score += Math.min(parseInt(linkCount.count) * 5, 25);
          
          // Consistency: multiple evidence types
          score += parseInt(linkCount.type_count) * 10;
          
          // Biological gradient: physical verification
          if (event.is_physical_verified) score += 20;
          
          // Temporal: factor count
          score += event.factor_count * 5;
          
          // Plausibility: capped at 100
          score = Math.min(score, 100);

          await sql`
            UPDATE master_forensic_events 
            SET bradford_hill_score = ${score}
            WHERE forensic_event_id = ${event.forensic_event_id}
          `;

          scored++;
        }

        result = { scored, message: `Calculated Bradford Hill scores for ${scored} events` };
        break;
      }

      case 'getTopEvents': {
        // Get top forensic events by score
        const limit = params.limit || 20;
        
        const events = await sql`
          SELECT 
            mfe.forensic_event_id,
            mfe.event_timestamp,
            mfe.event_type,
            mfe.primary_entity_id,
            mfe.confidence_score,
            mfe.bradford_hill_score,
            mfe.factor_count,
            mfe.is_physical_verified,
            mfe.summary,
            (SELECT COUNT(*) FROM evidence_chain_links WHERE forensic_event_id = mfe.forensic_event_id) as link_count
          FROM master_forensic_events mfe
          WHERE mfe.bradford_hill_score IS NOT NULL
          ORDER BY mfe.bradford_hill_score DESC, mfe.factor_count DESC
          LIMIT ${limit}
        `;

        result = { events };
        break;
      }

      case 'getJobStatus': {
        const jobs = await sql`
          SELECT * FROM correlation_job_status
          ORDER BY created_at DESC
          LIMIT 10
        `;
        result = { jobs };
        break;
      }

      case 'runFullBackfill': {
        // Orchestrate full backfill across all sources
        const results = [];

        // Step 1: Flights
        console.log('[forensic-linker] Starting flight backfill...');
        let flightOffset = 0;
        let flightHasMore = true;
        let totalFlights = 0;
        while (flightHasMore && totalFlights < 10000) { // Cap at 10k per run
          const flightResult = await sql`
            SELECT id, registration, detection_timestamp, latitude, longitude
            FROM live_flight_detections_rows
            WHERE id NOT IN (
              SELECT source_id::uuid FROM evidence_chain_links 
              WHERE source_table = 'live_flight_detections_rows'
            )
            ORDER BY detection_timestamp
            LIMIT 500
          `;

          for (const flight of flightResult) {
            const [event] = await sql`
              INSERT INTO master_forensic_events (
                event_timestamp, event_type, primary_entity_type, primary_entity_id,
                geo_lat, geo_lng, confidence_score, summary
              ) VALUES (
                ${flight.detection_timestamp}, 'flight', 'aircraft', ${flight.registration},
                ${flight.latitude}, ${flight.longitude}, 70,
                ${`Flight: ${flight.registration}`}
              )
              RETURNING forensic_event_id
            `;

            await sql`
              INSERT INTO evidence_chain_links (
                forensic_event_id, source_table, source_id, link_type, link_confidence
              ) VALUES (
                ${event.forensic_event_id}, 'live_flight_detections_rows', 
                ${flight.id.toString()}, 'temporal', 70
              )
            `;

            totalFlights++;
          }

          flightHasMore = flightResult.length === 500;
          flightOffset += 500;
        }
        results.push({ step: 'flights', processed: totalFlights });

        // Step 2: Biometrics correlation
        console.log('[forensic-linker] Starting biometric correlation...');
        const bioResult = await sql`
          SELECT id, measurement_timestamp, heart_rate
          FROM biometric_monitoring
          WHERE id NOT IN (
            SELECT source_id::uuid FROM evidence_chain_links 
            WHERE source_table = 'biometric_monitoring'
          )
          LIMIT 2000
        `;

        let bioLinked = 0;
        for (const bio of bioResult) {
          const events = await sql`
            SELECT forensic_event_id 
            FROM master_forensic_events
            WHERE event_type = 'flight'
              AND ABS(EXTRACT(EPOCH FROM (event_timestamp - ${bio.measurement_timestamp}))) <= 300
            LIMIT 1
          `;

          if (events.length > 0) {
            await sql`
              INSERT INTO evidence_chain_links (
                forensic_event_id, source_table, source_id, link_type, link_confidence
              ) VALUES (
                ${events[0].forensic_event_id}, 'biometric_monitoring', 
                ${bio.id.toString()}, 'biometric', 80
              )
            `;

            await sql`
              UPDATE master_forensic_events 
              SET is_physical_verified = true, factor_count = factor_count + 1
              WHERE forensic_event_id = ${events[0].forensic_event_id}
            `;

            bioLinked++;
          }
        }
        results.push({ step: 'biometrics', processed: bioResult.length, linked: bioLinked });

        // Step 3: Calculate Bradford Hill scores
        console.log('[forensic-linker] Calculating Bradford Hill scores...');
        const [bhResult] = await sql`
          UPDATE master_forensic_events 
          SET bradford_hill_score = 
            LEAST(100, 
              factor_count * 15 + 
              CASE WHEN is_physical_verified THEN 25 ELSE 0 END +
              confidence_score * 0.3
            )
          WHERE bradford_hill_score IS NULL
          RETURNING COUNT(*) as updated
        `;
        results.push({ step: 'bradford_hill', updated: bhResult?.updated || 0 });

        result = { 
          success: true, 
          results,
          message: `Full backfill complete: ${totalFlights} flights, ${bioLinked} bio correlations`
        };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    await sql.end();
    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('[forensic-linker] Error:', error);
    try { await sql.end(); } catch {}
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return new Response(JSON.stringify({ 
      error: message,
      stack
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
