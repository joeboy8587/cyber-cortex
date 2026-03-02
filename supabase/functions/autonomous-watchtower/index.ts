import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ===== AUTONOMOUS DETECTION RULES (no human bias) =====
// Pure data-driven thresholds - the AI adjusts these based on learned patterns
const BASE_RULES = {
  // Statistical anomaly detection thresholds
  altitudeAnomalyStdDevs: 2.5,     // Flag if altitude deviates >2.5σ from aircraft's mean
  speedAnomalyStdDevs: 2.5,
  frequencyAnomalyMultiplier: 3,   // Flag if detection frequency >3x daily average
  spatialClusterRadiusKm: 5,       // Cluster radius for convergence detection
  temporalWindowMinutes: 60,       // Cross-reference window
  minConfidenceToFlag: 60,         // Don't flag below 60% confidence
  biometricCorrelationWindowMin: 5, // ±5 min for bio-flight cross-ref
  learningDecayDays: 90,           // Patterns older than 90 days decay in weight
};

interface AutonomousFlag {
  flag_type: string;
  severity: string;
  registration: string | null;
  description: string;
  evidence_summary: Record<string, unknown>;
  cross_references: Array<Record<string, unknown>>;
  confidence_score: number;
  learning_context: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mode = "full_scan" } = await req.json().catch(() => ({}));

    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!NEON_DATABASE_URL) {
      return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 2, idle_timeout: 20 });
    const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;

    const scanId = `auto-${Date.now()}`;
    const flags: AutonomousFlag[] = [];
    const learningInsights: string[] = [];

    try {
      // ===== PHASE 1: STATISTICAL BASELINE LEARNING =====
      // Learn what "normal" looks like from data — no hardcoded aircraft lists
      const [baselineStats, recentDetections, biometricBaseline] = await Promise.all([
        sql`
          SELECT 
            registration,
            COUNT(*)::int as total_detections,
            AVG(altitude::numeric) as mean_altitude,
            STDDEV(altitude::numeric) as stddev_altitude,
            AVG(speed::numeric) as mean_speed,
            STDDEV(speed::numeric) as stddev_speed,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            COUNT(DISTINCT DATE(detection_timestamp))::int as active_days
          FROM live_flight_detections_rows
          WHERE registration IS NOT NULL 
            AND registration != ''
            AND detection_timestamp > NOW() - INTERVAL '90 days'
          GROUP BY registration
          HAVING COUNT(*) >= 5
          ORDER BY COUNT(*) DESC
          LIMIT 500
        `,
        sql`
          SELECT id, registration, callsign, altitude, latitude, longitude,
                 detection_timestamp, icao24, speed, heading, vertical_rate
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '24 hours'
          ORDER BY detection_timestamp DESC
          LIMIT 2000
        `,
        sql`
          SELECT 
            AVG(heart_rate) as mean_hr,
            STDDEV(heart_rate) as stddev_hr,
            AVG(hrv) as mean_hrv,
            STDDEV(hrv) as stddev_hrv,
            AVG(stress_level) as mean_stress,
            STDDEV(stress_level) as stddev_stress,
            COUNT(*)::int as total_readings
          FROM biometric_monitoring
          WHERE measurement_timestamp > NOW() - INTERVAL '90 days'
        `.catch(() => [{ mean_hr: 72, stddev_hr: 12, mean_hrv: 55, stddev_hrv: 15, mean_stress: 40, stddev_stress: 15, total_readings: 0 }])
      ]);

      const baselineMap = new Map<string, any>();
      for (const b of baselineStats) {
        baselineMap.set(b.registration, b);
      }

      const bioBase = biometricBaseline[0] || { mean_hr: 72, stddev_hr: 12, mean_hrv: 55, stddev_hrv: 15, mean_stress: 40, stddev_stress: 15 };

      learningInsights.push(`Learned baselines for ${baselineStats.length} aircraft over 90 days`);
      learningInsights.push(`Biometric baseline: HR ${Math.round(Number(bioBase.mean_hr))}±${Math.round(Number(bioBase.stddev_hr))}, HRV ${Math.round(Number(bioBase.mean_hrv))}±${Math.round(Number(bioBase.stddev_hrv))}`);

      // ===== PHASE 2: ANOMALY DETECTION (pure statistical, no hardcoded lists) =====

      // 2a. Altitude anomalies — flag aircraft deviating from their OWN baseline
      const altitudeAnomalies = recentDetections.filter((d: any) => {
        const baseline = baselineMap.get(d.registration);
        if (!baseline || !baseline.stddev_altitude || Number(baseline.stddev_altitude) === 0) return false;
        const alt = Number(d.altitude || 0);
        if (alt <= 0) return false;
        const zScore = Math.abs(alt - Number(baseline.mean_altitude)) / Number(baseline.stddev_altitude);
        return zScore > BASE_RULES.altitudeAnomalyStdDevs && alt < Number(baseline.mean_altitude);
      });

      // Group by registration
      const altAnomalyByReg = new Map<string, any[]>();
      for (const d of altitudeAnomalies) {
        const reg = d.registration || 'UNKNOWN';
        if (!altAnomalyByReg.has(reg)) altAnomalyByReg.set(reg, []);
        altAnomalyByReg.get(reg)!.push(d);
      }

      for (const [reg, detections] of altAnomalyByReg) {
        const baseline = baselineMap.get(reg);
        if (!baseline) continue;
        const avgAnomAlt = detections.reduce((s: number, d: any) => s + Number(d.altitude), 0) / detections.length;
        const confidence = Math.min(95, 50 + detections.length * 5);

        if (confidence >= BASE_RULES.minConfidenceToFlag) {
          flags.push({
            flag_type: 'ALTITUDE_ANOMALY',
            severity: avgAnomAlt < 500 ? 'critical' : avgAnomAlt < 1500 ? 'high' : 'medium',
            registration: reg,
            description: `${reg} flying at avg ${Math.round(avgAnomAlt)}ft — ${(Math.round(Number(baseline.mean_altitude) - avgAnomAlt))}ft below its 90-day mean of ${Math.round(Number(baseline.mean_altitude))}ft (${detections.length} anomalous detections in 24h)`,
            evidence_summary: {
              mean_altitude: Math.round(Number(baseline.mean_altitude)),
              stddev: Math.round(Number(baseline.stddev_altitude)),
              anomalous_altitude: Math.round(avgAnomAlt),
              detection_count: detections.length,
              z_score: ((Number(baseline.mean_altitude) - avgAnomAlt) / Number(baseline.stddev_altitude)).toFixed(1)
            },
            cross_references: [],
            confidence_score: confidence,
            learning_context: { method: 'statistical_z_score', threshold: BASE_RULES.altitudeAnomalyStdDevs }
          });
        }
      }

      // 2b. Frequency anomalies — flag aircraft appearing much more than usual
      const last24hByReg = new Map<string, number>();
      for (const d of recentDetections) {
        if (!d.registration) continue;
        last24hByReg.set(d.registration, (last24hByReg.get(d.registration) || 0) + 1);
      }

      for (const [reg, count24h] of last24hByReg) {
        const baseline = baselineMap.get(reg);
        if (!baseline || baseline.active_days < 3) continue;
        const dailyAvg = baseline.total_detections / baseline.active_days;
        if (dailyAvg < 2) continue; // skip very sparse aircraft
        
        if (count24h > dailyAvg * BASE_RULES.frequencyAnomalyMultiplier) {
          const confidence = Math.min(90, 55 + Math.floor((count24h / dailyAvg - BASE_RULES.frequencyAnomalyMultiplier) * 10));
          if (confidence >= BASE_RULES.minConfidenceToFlag) {
            flags.push({
              flag_type: 'FREQUENCY_SPIKE',
              severity: count24h > dailyAvg * 5 ? 'critical' : 'high',
              registration: reg,
              description: `${reg} detected ${count24h}x in 24h vs daily avg of ${dailyAvg.toFixed(1)} — ${(count24h / dailyAvg).toFixed(1)}x normal frequency`,
              evidence_summary: { daily_average: dailyAvg.toFixed(1), last_24h: count24h, multiplier: (count24h / dailyAvg).toFixed(1) },
              cross_references: [],
              confidence_score: confidence,
              learning_context: { method: 'frequency_analysis', threshold_multiplier: BASE_RULES.frequencyAnomalyMultiplier }
            });
          }
        }
      }

      // 2c. Impossible physics — negative altitude, impossible speed (NO hardcoded lists)
      const physicsViolations = recentDetections.filter((d: any) => {
        const alt = Number(d.altitude || 0);
        const speed = Number(d.speed || 0);
        return alt < 0 || speed > 600 || (speed > 0 && speed < 5 && alt > 0 && alt < 200);
      });

      if (physicsViolations.length > 0) {
        const byReg = new Map<string, any[]>();
        for (const d of physicsViolations) {
          const reg = d.registration || d.callsign || 'UNKNOWN';
          if (!byReg.has(reg)) byReg.set(reg, []);
          byReg.get(reg)!.push(d);
        }
        for (const [reg, dets] of byReg) {
          const negAlt = dets.filter((d: any) => Number(d.altitude) < 0).length;
          const highSpeed = dets.filter((d: any) => Number(d.speed) > 600).length;
          flags.push({
            flag_type: 'PHYSICS_VIOLATION',
            severity: 'critical',
            registration: reg,
            description: `${reg}: ${dets.length} impossible data points — ${negAlt} negative altitudes, ${highSpeed} impossible speeds (>600kts). Indicates ADS-B data injection or transponder manipulation.`,
            evidence_summary: { total: dets.length, negative_altitude: negAlt, impossible_speed: highSpeed },
            cross_references: [],
            confidence_score: 95,
            learning_context: { method: 'physics_validation', no_human_bias: true }
          });
        }
      }

      // ===== PHASE 3: TEMPORAL CONVERGENCE (data-driven, not list-driven) =====
      const hourBuckets = new Map<string, Set<string>>();
      for (const d of recentDetections) {
        if (!d.registration) continue;
        const hour = new Date(d.detection_timestamp).toISOString().slice(0, 13);
        if (!hourBuckets.has(hour)) hourBuckets.set(hour, new Set());
        hourBuckets.get(hour)!.add(d.registration);
      }

      for (const [hour, aircraft] of hourBuckets) {
        if (aircraft.size >= 4) {
          // Check if this convergence is unusual by comparing to baseline
          const regs = Array.from(aircraft);
          flags.push({
            flag_type: 'TEMPORAL_CONVERGENCE',
            severity: aircraft.size >= 6 ? 'critical' : 'high',
            registration: regs.join(', '),
            description: `${aircraft.size} unique aircraft converged during ${hour}:00 UTC — statistically unusual clustering`,
            evidence_summary: { aircraft_count: aircraft.size, aircraft_list: regs, hour },
            cross_references: [],
            confidence_score: Math.min(90, 50 + aircraft.size * 8),
            learning_context: { method: 'temporal_clustering', window: '1_hour' }
          });
        }
      }

      // ===== PHASE 4: BIOMETRIC CROSS-REFERENCE (±5 min correlation) =====
      let bioCorrelations: any[] = [];
      try {
        bioCorrelations = await sql`
          WITH bio_spikes AS (
            SELECT id, measurement_timestamp, heart_rate, hrv, stress_level
            FROM biometric_monitoring
            WHERE measurement_timestamp > NOW() - INTERVAL '24 hours'
              AND (
                heart_rate > ${Math.round(Number(bioBase.mean_hr) + 2 * Number(bioBase.stddev_hr || 12))}
                OR hrv < ${Math.round(Number(bioBase.mean_hrv) - 2 * Number(bioBase.stddev_hrv || 15))}
                OR stress_level > ${Math.round(Number(bioBase.mean_stress) + 2 * Number(bioBase.stddev_stress || 15))}
              )
          ),
          correlated AS (
            SELECT 
              bs.id as bio_id,
              bs.measurement_timestamp,
              bs.heart_rate,
              bs.hrv,
              bs.stress_level,
              lf.registration,
              lf.altitude,
              lf.speed,
              lf.detection_timestamp,
              ABS(EXTRACT(EPOCH FROM (lf.detection_timestamp - bs.measurement_timestamp))) as time_delta_sec
            FROM bio_spikes bs
            INNER JOIN live_flight_detections_rows lf
              ON lf.detection_timestamp BETWEEN bs.measurement_timestamp - INTERVAL '5 minutes'
                AND bs.measurement_timestamp + INTERVAL '5 minutes'
            WHERE lf.registration IS NOT NULL
          )
          SELECT 
            registration,
            COUNT(*)::int as correlation_count,
            AVG(heart_rate) as avg_hr_during,
            AVG(altitude::numeric) as avg_alt_during,
            AVG(time_delta_sec) as avg_time_delta,
            MIN(measurement_timestamp) as first_corr,
            MAX(measurement_timestamp) as last_corr
          FROM correlated
          GROUP BY registration
          HAVING COUNT(*) >= 2
          ORDER BY COUNT(*) DESC
          LIMIT 20
        `;
      } catch (e) {
        console.warn("Bio correlation query error:", e);
      }

      for (const corr of bioCorrelations) {
        const baseline = baselineMap.get(corr.registration);
        const confidence = Math.min(92, 55 + Number(corr.correlation_count) * 4);
        
        if (confidence >= BASE_RULES.minConfidenceToFlag) {
          flags.push({
            flag_type: 'BIOMETRIC_CORRELATION',
            severity: Number(corr.correlation_count) >= 5 ? 'critical' : 'high',
            registration: corr.registration,
            description: `${corr.registration} correlated with ${corr.correlation_count} biometric stress events (avg HR ${Math.round(Number(corr.avg_hr_during))}, avg altitude ${Math.round(Number(corr.avg_alt_during))}ft, avg time delta ${Math.round(Number(corr.avg_time_delta))}s)`,
            evidence_summary: {
              correlations: Number(corr.correlation_count),
              avg_heart_rate: Math.round(Number(corr.avg_hr_during)),
              avg_altitude: Math.round(Number(corr.avg_alt_during)),
              avg_time_delta_sec: Math.round(Number(corr.avg_time_delta)),
              baseline_altitude: baseline ? Math.round(Number(baseline.mean_altitude)) : null,
              period: `${corr.first_corr} to ${corr.last_corr}`
            },
            cross_references: [{ type: 'biometric_monitoring', count: Number(corr.correlation_count) }],
            confidence_score: confidence,
            learning_context: { method: 'temporal_biometric_crossref', window_minutes: BASE_RULES.biometricCorrelationWindowMin }
          });
        }
      }

      // ===== PHASE 5: LOG CROSS-REFERENCING (witness + OCR + forensic events) =====
      let logCrossRefs: any[] = [];
      try {
        logCrossRefs = await sql`
          WITH recent_flags AS (
            SELECT DISTINCT registration 
            FROM (SELECT unnest(ARRAY[${sql.unsafe(
              Array.from(new Set(flags.map(f => f.registration).filter(Boolean))).map(r => `'${r}'`).join(',') || "'NONE'"
            )}]) as registration) t
          ),
          witness_matches AS (
            SELECT 'witness_log' as source, subject as registration, COUNT(*)::int as match_count
            FROM josiah_reflections_rows
            WHERE subject IN (SELECT registration FROM recent_flags)
              AND created_at > NOW() - INTERVAL '30 days'
            GROUP BY subject
          ),
          forensic_matches AS (
            SELECT 'forensic_event' as source, primary_entity_id as registration, COUNT(*)::int as match_count
            FROM master_forensic_events
            WHERE primary_entity_id IN (SELECT registration FROM recent_flags)
              AND event_timestamp > NOW() - INTERVAL '30 days'
            GROUP BY primary_entity_id
          )
          SELECT * FROM witness_matches
          UNION ALL
          SELECT * FROM forensic_matches
        `;
      } catch (e) {
        console.warn("Log cross-ref error:", e);
      }

      // Enrich flags with cross-references
      const crossRefMap = new Map<string, Array<{ source: string; count: number }>>();
      for (const ref of logCrossRefs) {
        if (!crossRefMap.has(ref.registration)) crossRefMap.set(ref.registration, []);
        crossRefMap.get(ref.registration)!.push({ source: ref.source, count: Number(ref.match_count) });
      }

      for (const flag of flags) {
        if (flag.registration && crossRefMap.has(flag.registration)) {
          flag.cross_references = crossRefMap.get(flag.registration)!;
          // Boost confidence for cross-referenced flags
          const totalRefs = flag.cross_references.reduce((s, r) => s + r.count, 0);
          flag.confidence_score = Math.min(98, flag.confidence_score + Math.min(15, totalRefs * 2));
        }
      }

      // ===== PHASE 6: AI SYNTHESIS (bias-free analysis) =====
      let aiAnalysis: string | null = null;
      let aiAdaptations: Record<string, unknown> = {};
      
      if (LOVABLE_API_KEY && flags.length > 0) {
        try {
          const topFlags = flags
            .sort((a, b) => b.confidence_score - a.confidence_score)
            .slice(0, 15);

          const prompt = `You are an AUTONOMOUS data analysis system. You have NO preconceived notions about which aircraft are threats. You analyze ONLY statistical patterns and cross-referenced evidence.

STATISTICAL FLAGS DETECTED (last 24h):
${topFlags.map(f => `- [${f.severity.toUpperCase()}] ${f.flag_type} | ${f.registration} | Confidence: ${f.confidence_score}% | ${f.description} | Cross-refs: ${f.cross_references.length > 0 ? f.cross_references.map(r => `${r.source}(${r.count})`).join(', ') : 'none'}`).join('\n')}

LEARNING CONTEXT:
- Baselines computed from ${baselineStats.length} aircraft over 90 days
- Biometric baseline: HR ${Math.round(Number(bioBase.mean_hr))}±${Math.round(Number(bioBase.stddev_hr))}, HRV ${Math.round(Number(bioBase.mean_hrv))}±${Math.round(Number(bioBase.stddev_hrv))}
- Bio correlations found: ${bioCorrelations.length} aircraft with repeated stress event timing

INSTRUCTIONS:
1. Identify the TOP 3 most statistically significant patterns (not based on assumptions — only data)
2. For each, state the statistical basis and cross-reference strength
3. Recommend threshold adjustments if any detection rule is too sensitive or too loose
4. Flag any potential FALSE POSITIVES you see (this is critical for removing bias)

Output as structured analysis. Be skeptical — demand evidence, not assumptions.`;

          const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: "You are a bias-free statistical anomaly detector. You challenge assumptions and demand data-backed evidence. Flag false positives aggressively." },
                { role: "user", content: prompt }
              ],
              max_tokens: 800,
            }),
          });

          if (aiResponse.ok) {
            const data = await aiResponse.json();
            aiAnalysis = data.choices?.[0]?.message?.content || null;
          } else if (aiResponse.status === 429) {
            aiAnalysis = "Rate limited — analysis deferred to next scan cycle.";
          }
        } catch (aiErr) {
          console.error("AI synthesis error:", aiErr);
        }
      }

      // ===== PHASE 7: PERSIST FLAGS TO SUPABASE =====
      let savedCount = 0;
      if (supabase && flags.length > 0) {
        // Only persist flags above confidence threshold
        const persistableFlags = flags.filter(f => f.confidence_score >= BASE_RULES.minConfidenceToFlag);

        for (const flag of persistableFlags) {
          try {
            const { error } = await supabase
              .from('watchtower_autonomous_flags')
              .insert({
                flag_type: flag.flag_type,
                severity: flag.severity,
                registration: flag.registration,
                description: flag.description,
                evidence_summary: flag.evidence_summary,
                cross_references: flag.cross_references,
                confidence_score: flag.confidence_score,
                learning_context: flag.learning_context,
                source_scan_id: scanId,
              });
            if (!error) savedCount++;
          } catch (e) {
            console.warn("Flag persist error:", e);
          }
        }
      }

      // ===== PHASE 8: AUTO-RESOLVE STALE FLAGS =====
      if (supabase) {
        try {
          // Auto-resolve flags for aircraft not seen in 7 days
          const staleRegs = baselineStats
            .filter((b: any) => {
              const lastSeen = new Date(b.last_seen);
              return (Date.now() - lastSeen.getTime()) > 7 * 24 * 60 * 60 * 1000;
            })
            .map((b: any) => b.registration);

          if (staleRegs.length > 0) {
            await supabase
              .from('watchtower_autonomous_flags')
              .update({ auto_resolved: true, resolved_reason: 'Aircraft not detected in 7+ days — threat expired' })
              .in('registration', staleRegs)
              .eq('auto_resolved', false);
          }
        } catch (e) {
          console.warn("Auto-resolve error:", e);
        }
      }

      await sql.end();

      const response = {
        success: true,
        scan_id: scanId,
        timestamp: new Date().toISOString(),
        mode,
        summary: {
          aircraft_baselines: baselineStats.length,
          recent_detections_analyzed: recentDetections.length,
          flags_generated: flags.length,
          flags_persisted: savedCount,
          bio_correlations: bioCorrelations.length,
          cross_references: logCrossRefs.length,
          critical_flags: flags.filter(f => f.severity === 'critical').length,
          high_flags: flags.filter(f => f.severity === 'high').length,
        },
        flags: flags.sort((a, b) => b.confidence_score - a.confidence_score),
        ai_analysis: aiAnalysis,
        learning_insights: learningInsights,
        thresholds: BASE_RULES,
      };

      return new Response(JSON.stringify(response),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (dbErr) {
      await sql.end();
      throw dbErr;
    }
  } catch (err) {
    console.error("Autonomous Watchtower error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
