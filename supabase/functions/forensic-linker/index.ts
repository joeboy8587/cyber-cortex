import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.2";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type LinkageStats = {
  forensicEvents: number;
  entities: number;
  chainLinks: number;
  totalFlights: number;
  linkedFlights: number;
  totalBiometrics: number;
  linkedBiometrics: number;
  flightCoverage: string;
  biometricCoverage: string;
};

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400, details?: Json) {
  return new Response(JSON.stringify({ error: message, details }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getNeonClient() {
  const neonUrl = Deno.env.get("NEON_DATABASE_URL");
  if (!neonUrl) throw new Error("NEON_DATABASE_URL not configured");
  
  const client = new Client(neonUrl);
  await client.connect();
  return client;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return fail("Backend not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)", 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    const params = (body ?? {}) as Record<string, unknown>;

    console.log("[forensic-linker] action=", action);

    if (!action) return fail("Missing action");

    if (action === "getStats") {
      // Get Lovable Cloud counts
      const [eventsRes, entitiesRes, linksRes] = await Promise.all([
        supabase.from("master_forensic_events").select("forensic_event_id", { count: "exact", head: true }),
        supabase.from("entity_registry").select("entity_id", { count: "exact", head: true }),
        supabase.from("evidence_chain_links").select("link_id", { count: "exact", head: true }),
      ]);

      if (eventsRes.error) return fail(eventsRes.error.message, 500);
      if (entitiesRes.error) return fail(entitiesRes.error.message, 500);
      if (linksRes.error) return fail(linksRes.error.message, 500);

      // Get Neon source counts
      let totalFlights = 0;
      let totalBiometrics = 0;
      
      try {
        const neon = await getNeonClient();
        
        const flightCount = await neon.queryObject<{ count: string }>(
          `SELECT COUNT(*)::text as count FROM live_flight_detections_rows`
        );
        totalFlights = parseInt(flightCount.rows[0]?.count || "0", 10);
        
        const bioCount = await neon.queryObject<{ count: string }>(
          `SELECT COUNT(*)::text as count FROM biometric_monitoring`
        );
        totalBiometrics = parseInt(bioCount.rows[0]?.count || "0", 10);
        
        await neon.end();
      } catch (e) {
        console.log("[forensic-linker] Neon query error:", e);
      }

      // Count linked records from chain_links
      const linkedFlightsRes = await supabase
        .from("evidence_chain_links")
        .select("link_id", { count: "exact", head: true })
        .eq("source_table", "live_flight_detections_rows");
      
      const linkedBioRes = await supabase
        .from("evidence_chain_links")
        .select("link_id", { count: "exact", head: true })
        .eq("source_table", "biometric_monitoring");

      const linkedFlights = linkedFlightsRes.count ?? 0;
      const linkedBiometrics = linkedBioRes.count ?? 0;

      const stats: LinkageStats = {
        forensicEvents: eventsRes.count ?? 0,
        entities: entitiesRes.count ?? 0,
        chainLinks: linksRes.count ?? 0,
        totalFlights,
        linkedFlights,
        totalBiometrics,
        linkedBiometrics,
        flightCoverage: totalFlights > 0 ? ((linkedFlights / totalFlights) * 100).toFixed(1) : "0",
        biometricCoverage: totalBiometrics > 0 ? ((linkedBiometrics / totalBiometrics) * 100).toFixed(1) : "0",
      };

      return ok(stats);
    }

    if (action === "getJobStatus") {
      const jobsRes = await supabase
        .from("correlation_job_status")
        .select("job_id, job_type, target_table, processed_records, linked_records, status, started_at, completed_at")
        .order("created_at", { ascending: false })
        .limit(25);

      if (jobsRes.error) return fail(jobsRes.error.message, 500);
      return ok({ jobs: jobsRes.data ?? [] });
    }

    if (action === "getTopEvents") {
      const limit = typeof params.limit === "number" ? params.limit : 10;

      const eventsRes = await supabase
        .from("master_forensic_events")
        .select(
          "forensic_event_id, event_timestamp, event_type, primary_entity_id, confidence_score, bradford_hill_score, factor_count, is_physical_verified, summary"
        )
        .order("bradford_hill_score", { ascending: false, nullsFirst: false })
        .limit(Math.min(Math.max(limit, 1), 50));

      if (eventsRes.error) return fail(eventsRes.error.message, 500);

      const events = eventsRes.data ?? [];

      const withCounts = await Promise.all(
        events.map(async (e) => {
          const countRes = await supabase
            .from("evidence_chain_links")
            .select("link_id", { count: "exact", head: true })
            .eq("forensic_event_id", e.forensic_event_id);

          return { ...e, link_count: countRes.count ?? 0 };
        })
      );

      return ok({ events: withCounts });
    }

    if (action === "backfillFlights") {
      const batchSize = typeof params.batchSize === "number" ? params.batchSize : 100;
      
      // Create job record
      const jobRes = await supabase
        .from("correlation_job_status")
        .insert({
          job_type: "backfill_flights",
          target_table: "live_flight_detections_rows",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select("job_id")
        .single();
      
      if (jobRes.error) return fail(jobRes.error.message, 500);
      const jobId = jobRes.data.job_id;

      try {
        const neon = await getNeonClient();
        
        // Get flights from Neon - use flexible column names
        const flightsResult = await neon.queryObject<{
          id: string;
          aircraft_id: string;
          latitude: number;
          longitude: number;
          altitude: number;
          detected_at: string;
          operator: string;
        }>(`
          SELECT id, 
                 COALESCE(n_number, registration, callsign, hex_code, 'UNKNOWN') as aircraft_id,
                 COALESCE(latitude, lat, 0) as latitude, 
                 COALESCE(longitude, lng, lon, 0) as longitude, 
                 COALESCE(altitude, alt, 0) as altitude, 
                 COALESCE(detected_at, timestamp, created_at, now()) as detected_at,
                 COALESCE(operator, airline, 'Unknown') as operator
          FROM live_flight_detections_rows 
          ORDER BY COALESCE(detected_at, timestamp, created_at) DESC NULLS LAST
          LIMIT ${batchSize}
        `);

        await neon.end();
        
        let processed = 0;
        let linked = 0;

        for (const flight of flightsResult.rows) {
          processed++;
          
          // Create forensic event
          const eventRes = await supabase
            .from("master_forensic_events")
            .insert({
              event_timestamp: flight.detected_at,
              event_type: "flight",
              primary_entity_id: flight.aircraft_id,
              primary_entity_type: "aircraft",
              geo_lat: flight.latitude,
              geo_lng: flight.longitude,
              confidence_score: 85,
              summary: `Flight ${flight.aircraft_id} detected at ${flight.altitude}ft`,
              linked_records: [{ table: "live_flight_detections_rows", id: flight.id }],
            })
            .select("forensic_event_id")
            .single();

          if (eventRes.data) {
            // Create chain link
            await supabase.from("evidence_chain_links").insert({
              forensic_event_id: eventRes.data.forensic_event_id,
              source_table: "live_flight_detections_rows",
              source_id: flight.id,
              link_type: "temporal",
              link_confidence: 85,
            });
            linked++;
          }
        }

        // Update job status
        await supabase
          .from("correlation_job_status")
          .update({
            status: "completed",
            processed_records: processed,
            linked_records: linked,
            completed_at: new Date().toISOString(),
          })
          .eq("job_id", jobId);

        return ok({ jobId, processed, linked });
      } catch (e) {
        await supabase
          .from("correlation_job_status")
          .update({ status: "failed", error_message: (e as Error).message })
          .eq("job_id", jobId);
        throw e;
      }
    }

    if (action === "backfillBiometrics") {
      const batchSize = typeof params.batchSize === "number" ? params.batchSize : 100;
      
      const jobRes = await supabase
        .from("correlation_job_status")
        .insert({
          job_type: "backfill_biometrics",
          target_table: "biometric_monitoring",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select("job_id")
        .single();
      
      if (jobRes.error) return fail(jobRes.error.message, 500);
      const jobId = jobRes.data.job_id;

      try {
        const neon = await getNeonClient();
        
        const bioResult = await neon.queryObject<{
          id: string;
          heart_rate: number;
          stress_level: number;
          event_timestamp: string;
        }>(`
          SELECT id, 
                 COALESCE(heart_rate, hr_avg, 0) as heart_rate,
                 COALESCE(stress_level, 0) as stress_level,
                 COALESCE(measurement_timestamp, event_timestamp, created_at) as event_timestamp
          FROM biometric_monitoring 
          ORDER BY COALESCE(measurement_timestamp, event_timestamp, created_at) DESC 
          LIMIT ${batchSize}
        `);

        await neon.end();
        
        let processed = 0;
        let linked = 0;

        for (const bio of bioResult.rows) {
          processed++;
          
          const eventRes = await supabase
            .from("master_forensic_events")
            .insert({
              event_timestamp: bio.event_timestamp,
              event_type: "biometric",
              primary_entity_type: "individual",
              confidence_score: 90,
              summary: `Biometric: HR ${bio.heart_rate}, Stress ${bio.stress_level}`,
              linked_records: [{ table: "biometric_monitoring", id: bio.id }],
              is_physical_verified: true,
            })
            .select("forensic_event_id")
            .single();

          if (eventRes.data) {
            await supabase.from("evidence_chain_links").insert({
              forensic_event_id: eventRes.data.forensic_event_id,
              source_table: "biometric_monitoring",
              source_id: bio.id,
              link_type: "biometric",
              link_confidence: 90,
            });
            linked++;
          }
        }

        await supabase
          .from("correlation_job_status")
          .update({
            status: "completed",
            processed_records: processed,
            linked_records: linked,
            completed_at: new Date().toISOString(),
          })
          .eq("job_id", jobId);

        return ok({ jobId, processed, linked });
      } catch (e) {
        await supabase
          .from("correlation_job_status")
          .update({ status: "failed", error_message: (e as Error).message })
          .eq("job_id", jobId);
        throw e;
      }
    }

    if (action === "backfillJosiah") {
      const batchSize = typeof params.batchSize === "number" ? params.batchSize : 50;
      
      const jobRes = await supabase
        .from("correlation_job_status")
        .insert({
          job_type: "backfill_josiah",
          target_table: "josiah_reflections_rows",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select("job_id")
        .single();
      
      if (jobRes.error) return fail(jobRes.error.message, 500);
      const jobId = jobRes.data.job_id;

      try {
        const neon = await getNeonClient();
        
        const josiahResult = await neon.queryObject<{
          id: string;
          content: string;
          created_at: string;
        }>(`
          SELECT id, 
                 COALESCE(reflection_text, content, '') as content,
                 COALESCE(created_at, now()) as created_at
          FROM josiah_reflections_rows 
          ORDER BY created_at DESC 
          LIMIT ${batchSize}
        `);

        await neon.end();
        
        let processed = 0;
        let linked = 0;

        for (const entry of josiahResult.rows) {
          processed++;
          
          const eventRes = await supabase
            .from("master_forensic_events")
            .insert({
              event_timestamp: entry.created_at,
              event_type: "witness",
              primary_entity_type: "individual",
              confidence_score: 95,
              summary: entry.content?.substring(0, 200) || "Josiah witness entry",
              linked_records: [{ table: "josiah_reflections_rows", id: entry.id }],
            })
            .select("forensic_event_id")
            .single();

          if (eventRes.data) {
            await supabase.from("evidence_chain_links").insert({
              forensic_event_id: eventRes.data.forensic_event_id,
              source_table: "josiah_reflections_rows",
              source_id: entry.id,
              link_type: "witness",
              link_confidence: 95,
            });
            linked++;
          }
        }

        await supabase
          .from("correlation_job_status")
          .update({
            status: "completed",
            processed_records: processed,
            linked_records: linked,
            completed_at: new Date().toISOString(),
          })
          .eq("job_id", jobId);

        return ok({ jobId, processed, linked });
      } catch (e) {
        await supabase
          .from("correlation_job_status")
          .update({ status: "failed", error_message: (e as Error).message })
          .eq("job_id", jobId);
        throw e;
      }
    }

    if (action === "runFullBackfill") {
      // Run all backfills in sequence
      const results: Record<string, unknown> = {};
      
      for (const backfillAction of ["backfillFlights", "backfillBiometrics", "backfillJosiah"]) {
        try {
          const response = await fetch(req.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: backfillAction, batchSize: 100 }),
          });
          results[backfillAction] = await response.json();
        } catch (e) {
          results[backfillAction] = { error: (e as Error).message };
        }
      }
      
      return ok(results);
    }

    if (action === "calculateBradfordHill") {
      // Update Bradford-Hill scores for events with multiple links
      const eventsRes = await supabase
        .from("master_forensic_events")
        .select("forensic_event_id, factor_count, confidence_score")
        .is("bradford_hill_score", null)
        .limit(100);

      if (eventsRes.error) return fail(eventsRes.error.message, 500);

      let updated = 0;
      for (const event of eventsRes.data || []) {
        const linksRes = await supabase
          .from("evidence_chain_links")
          .select("link_type, link_confidence")
          .eq("forensic_event_id", event.forensic_event_id);

        const links = linksRes.data || [];
        const factorCount = links.length;
        const avgConfidence = links.reduce((s, l) => s + (l.link_confidence || 0), 0) / (links.length || 1);
        
        // Bradford-Hill score: factor count * avg confidence / 10
        const bhScore = (factorCount * avgConfidence) / 10;

        await supabase
          .from("master_forensic_events")
          .update({ bradford_hill_score: bhScore, factor_count: factorCount })
          .eq("forensic_event_id", event.forensic_event_id);
        
        updated++;
      }

      return ok({ updated });
    }

    if (action === "resolveEntities") {
      // Extract unique entities from forensic events
      const eventsRes = await supabase
        .from("master_forensic_events")
        .select("primary_entity_id, primary_entity_type, event_timestamp")
        .not("primary_entity_id", "is", null)
        .limit(500);

      if (eventsRes.error) return fail(eventsRes.error.message, 500);

      const entityMap = new Map<string, { type: string; firstSeen: string; lastSeen: string }>();
      
      for (const e of eventsRes.data || []) {
        const key = `${e.primary_entity_type}:${e.primary_entity_id}`;
        const existing = entityMap.get(key);
        if (!existing) {
          entityMap.set(key, {
            type: e.primary_entity_type || "aircraft",
            firstSeen: e.event_timestamp,
            lastSeen: e.event_timestamp,
          });
        } else {
          if (e.event_timestamp < existing.firstSeen) existing.firstSeen = e.event_timestamp;
          if (e.event_timestamp > existing.lastSeen) existing.lastSeen = e.event_timestamp;
        }
      }

      let created = 0;
      for (const [key, data] of entityMap) {
        const [type, id] = key.split(":");
        
        const existing = await supabase
          .from("entity_registry")
          .select("entity_id")
          .eq("canonical_identifier", id)
          .single();

        if (!existing.data) {
          await supabase.from("entity_registry").insert({
            canonical_identifier: id,
            entity_type: type as "aircraft" | "operator" | "agency" | "shell_company" | "contractor" | "individual",
            first_seen: data.firstSeen,
            last_seen: data.lastSeen,
          });
          created++;
        }
      }

      return ok({ resolved: entityMap.size, created });
    }

    return fail(`Unknown action '${action}'`, 400);
  } catch (err) {
    console.error("[forensic-linker] Unhandled error", err);
    return fail("Unhandled error", 500, { message: (err as Error)?.message });
  }
});
