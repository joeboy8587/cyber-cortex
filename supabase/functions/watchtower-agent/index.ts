import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PatternAnomaly {
  type: string;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  aircraft?: string[];
  count: number;
  timestamp: string;
}

interface InvestigativeLead {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  question: string;
  data_needed: string;
  potential_finding: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action = "scan" } = await req.json();
    
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    
    if (!NEON_DATABASE_URL) {
      return new Response(
        JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1 });
    const anomalies: PatternAnomaly[] = [];
    const leads: InvestigativeLead[] = [];
    
    try {
      // 1. Check for invisible/masked aircraft (KCSO fleet with zero detections)
      // Note: kcso_fleet may be in Supabase, not Neon - handle gracefully
      let maskedAircraft: any[] = [];
      try {
        maskedAircraft = await sql`
          SELECT 
            kf.tail_number as registration,
            kf.model,
            COALESCE(d.detection_count, 0) as detection_count,
            d.last_seen
          FROM kcso_fleet kf
          LEFT JOIN (
            SELECT registration, COUNT(*) as detection_count, MAX(detection_timestamp) as last_seen
            FROM live_flight_detections_rows
            GROUP BY registration
          ) d ON d.registration = kf.tail_number
          WHERE COALESCE(d.detection_count, 0) = 0
             OR d.last_seen < NOW() - INTERVAL '30 days'
        `;
      } catch (fleetErr: any) {
        // kcso_fleet table may not exist in Neon (it's in Supabase)
        console.warn("kcso_fleet query skipped:", fleetErr.message);
      }

      if (maskedAircraft.length > 0) {
        anomalies.push({
          type: "INVISIBLE_FLEET",
          severity: "critical",
          description: `${maskedAircraft.length} KCSO aircraft with zero ADS-B visibility or not seen in 30+ days`,
          aircraft: maskedAircraft.map((a: any) => a.registration),
          count: maskedAircraft.length,
          timestamp: new Date().toISOString()
        });

        leads.push({
          id: `lead-masked-${Date.now()}`,
          priority: "critical",
          question: `Why have ${maskedAircraft.length} KCSO aircraft NEVER appeared on ADS-B?`,
          data_needed: "FAA N-Number inquiry, Mode-S hex verification, flight plan records",
          potential_finding: "Deliberate transponder manipulation or registration fraud"
        });
      }

      // 2. Phantom biometric events (stress spikes with no aircraft)
      // CRITICAL FIX v2: Only count phantoms during "monitored periods" where
      // we have sufficient flight data (>50 flights that day) to ensure correlation validity
      const phantomEvents = await sql`
        WITH daily_flight_coverage AS (
          -- Calculate daily flight density to identify "monitored" vs "gap" periods
          SELECT 
            DATE(detection_timestamp) as flight_date,
            COUNT(*) as daily_flights
          FROM live_flight_detections_rows
          GROUP BY DATE(detection_timestamp)
        ),
        monitored_dates AS (
          -- Only dates with >50 flights are considered "actively monitored"
          SELECT flight_date FROM daily_flight_coverage WHERE daily_flights >= 50
        ),
        bio_spikes AS (
          SELECT id, measurement_timestamp, heart_rate, hrv, stress_level
          FROM biometric_monitoring
          WHERE (heart_rate > 100 OR hrv < 40 OR stress_level > 70)
            -- Only include biometrics on monitored dates
            AND DATE(measurement_timestamp) IN (SELECT flight_date FROM monitored_dates)
        ),
        with_flights AS (
          SELECT 
            bs.id,
            bs.measurement_timestamp,
            bs.heart_rate,
            bs.hrv,
            bs.stress_level,
            COUNT(lf.id) as nearby_aircraft
          FROM bio_spikes bs
          LEFT JOIN live_flight_detections_rows lf
            ON lf.detection_timestamp BETWEEN bs.measurement_timestamp - INTERVAL '5 minutes'
               AND bs.measurement_timestamp + INTERVAL '5 minutes'
          GROUP BY bs.id, bs.measurement_timestamp, bs.heart_rate, bs.hrv, bs.stress_level
        )
        SELECT 
          COUNT(*) FILTER (WHERE nearby_aircraft = 0) as phantom_count,
          COUNT(*) FILTER (WHERE nearby_aircraft > 0) as correlated_count,
          COUNT(*) as total_count,
          (SELECT COUNT(*) FROM biometric_monitoring WHERE (heart_rate > 100 OR hrv < 40 OR stress_level > 70)) as total_bio_spikes,
          (SELECT COUNT(DISTINCT flight_date) FROM daily_flight_coverage WHERE daily_flights >= 50) as monitored_days,
          (SELECT COUNT(DISTINCT DATE(measurement_timestamp)) FROM biometric_monitoring 
           WHERE (heart_rate > 100 OR hrv < 40 OR stress_level > 70)
             AND DATE(measurement_timestamp) NOT IN (SELECT flight_date FROM monitored_dates)) as gap_days
        FROM with_flights
      `;

      const phantomStats = phantomEvents[0] || { phantom_count: 0, correlated_count: 0, total_count: 0, total_bio_spikes: 0, monitored_days: 0, gap_days: 0 };
      const phantomCount = parseInt(phantomStats.phantom_count || '0');
      const correlatedCount = parseInt(phantomStats.correlated_count || '0');
      const totalCount = parseInt(phantomStats.total_count || '0');
      const totalBioSpikes = parseInt(phantomStats.total_bio_spikes || '0');
      const monitoredDays = parseInt(phantomStats.monitored_days || '0');
      const gapDays = parseInt(phantomStats.gap_days || '0');
      const phantomRatio = totalCount > 0 ? (phantomCount / totalCount) * 100 : 0;

      // Report data coverage gap if significant
      if (gapDays > 0 && totalBioSpikes > totalCount) {
        const gapCount = totalBioSpikes - totalCount;
        anomalies.push({
          type: "DATA_COVERAGE_GAP",
          severity: gapCount > 100 ? "high" : "medium",
          description: `${gapCount} biometric stress events on ${gapDays} days with insufficient flight data (<50 flights/day) - cannot verify correlations`,
          count: gapCount,
          timestamp: new Date().toISOString()
        });

        leads.push({
          id: `lead-gap-${Date.now()}`,
          priority: "high",
          question: `Can we backfill flight data for ${gapDays} days missing coverage to verify ${gapCount} unanalyzed stress events?`,
          data_needed: "Historical ADS-B data from FlightAware, FlightRadar24, or OpenSky archives",
          potential_finding: "Hidden correlations currently masked by data gaps"
        });
      }

      // Only flag PHANTOM_STRESS during actively monitored periods
      if (phantomCount > 0 && monitoredDays > 0) {
        anomalies.push({
          type: "PHANTOM_STRESS",
          severity: phantomRatio > 30 ? "critical" : (phantomRatio > 10 ? "high" : "medium"),
          description: `${phantomCount}/${totalCount} stress events (${phantomRatio.toFixed(1)}%) during MONITORED periods (${monitoredDays} days with 50+ flights) had NO visible aircraft - potential stealth ops`,
          count: phantomCount,
          timestamp: new Date().toISOString()
        });

        if (phantomRatio > 10) {
          leads.push({
            id: `lead-phantom-${Date.now()}`,
            priority: phantomRatio > 30 ? "critical" : "high",
            question: `What caused ${phantomCount} biometric stress events with zero aircraft correlation during active monitoring?`,
            data_needed: "Secondary radar data, ground vehicle tracking, RF spectrum analysis, transponder-off flight records",
            potential_finding: "Evidence of stealth operations, ground-based harassment, or ADS-B masking"
          });
        }
      }

      // 3. Fleet convergence patterns (multiple aircraft same hour)
      const convergenceEvents = await sql`
        SELECT 
          DATE_TRUNC('hour', detection_timestamp) as hour,
          COUNT(DISTINCT registration) as unique_aircraft,
          ARRAY_AGG(DISTINCT registration) as aircraft_list
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '90 days'
        GROUP BY DATE_TRUNC('hour', detection_timestamp)
        HAVING COUNT(DISTINCT registration) >= 3
        ORDER BY unique_aircraft DESC
        LIMIT 30
      `;

      if (convergenceEvents.length > 0) {
        const highConvergence = convergenceEvents.filter((e: any) => parseInt(e.unique_aircraft) >= 4);
        if (highConvergence.length > 0) {
          anomalies.push({
            type: "FLEET_CONVERGENCE",
            severity: "high",
            description: `${highConvergence.length} hours with 4+ aircraft simultaneously over target - coordinated operations`,
            count: highConvergence.length,
            aircraft: highConvergence[0]?.aircraft_list?.slice(0, 5) || [],
            timestamp: new Date().toISOString()
          });
        }
      }

      // 4. Check for recent high-priority aircraft activity
      const priorityActivity = await sql`
        SELECT registration, callsign, COUNT(*) as detection_count,
               MAX(detection_timestamp) as last_seen,
               AVG(altitude::numeric) as avg_altitude
        FROM live_flight_detections_rows
        WHERE registration IN ('N912KC', 'N913KC', 'N229AM', 'N790FA', 'N788FA', 'N743AM')
          AND detection_timestamp > NOW() - INTERVAL '7 days'
        GROUP BY registration, callsign
        ORDER BY detection_count DESC
      `;

      if (priorityActivity.length > 0) {
        const lowAltitude = priorityActivity.filter((a: any) => parseFloat(a.avg_altitude || 0) < 2000);
        if (lowAltitude.length > 0) {
          anomalies.push({
            type: "LOW_ALTITUDE_PRIORITY",
            severity: "critical",
            description: `${lowAltitude.length} priority aircraft operating at <2000ft avg in past 7 days`,
            aircraft: lowAltitude.map((a: any) => a.registration),
            count: lowAltitude.length,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Always generate baseline leads
      leads.push({
        id: `lead-timing-${Date.now()}`,
        priority: "high",
        question: "Are there specific time patterns when surveillance intensifies?",
        data_needed: "Hourly detection frequency, sleep cycle correlation, work schedule analysis",
        potential_finding: "Operational schedule of harassment campaign"
      });

      leads.push({
        id: `lead-biometric-${Date.now()}`,
        priority: "medium",
        question: "Which aircraft types correlate most strongly with biometric stress?",
        data_needed: "Aircraft model vs heart rate elevation cross-reference",
        potential_finding: "Specific threat aircraft identification for legal exhibits"
      });

      // Use Mistral to generate AI hypothesis if available
      let aiHypothesis = null;
      if (MISTRAL_API_KEY && anomalies.length > 0) {
        try {
          const analysisPrompt = `Analyze these surveillance anomalies and generate a prosecutable hypothesis:

DETECTED ANOMALIES:
${anomalies.map(a => `- ${a.type}: ${a.description} (Severity: ${a.severity})`).join('\n')}

Generate a 2-3 sentence hypothesis that:
1. Connects the anomalies to coordinated surveillance
2. References potential legal violations (RICO, 42 USC 1983)
3. Suggests the most critical investigative action

Be direct and analytical.`;

          const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${MISTRAL_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "mistral-large-latest",
              messages: [
                { role: "system", content: "You are JOSIAH, an investigative AI. Be concise and analytical." },
                { role: "user", content: analysisPrompt }
              ],
              max_tokens: 300,
              temperature: 0.5,
            }),
          });

          if (mistralResponse.ok) {
            const data = await mistralResponse.json();
            aiHypothesis = data.choices?.[0]?.message?.content || null;
          }
        } catch (aiErr) {
          console.error("AI hypothesis generation error:", aiErr);
        }
      }

      await sql.end();

      return new Response(
        JSON.stringify({
          success: true,
          timestamp: new Date().toISOString(),
          anomalies,
          leads,
          aiHypothesis,
          summary: {
            anomalyCount: anomalies.length,
            leadCount: leads.length,
            criticalCount: anomalies.filter(a => a.severity === 'critical').length
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (dbErr) {
      await sql.end();
      throw dbErr;
    }

  } catch (err) {
    console.error("Watchtower agent error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
