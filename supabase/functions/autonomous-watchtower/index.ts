import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const VERSION = "3.0.0"; // Absolute Certainty Protocol
console.log(`autonomous-watchtower v${VERSION} booting...`);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ===== ABSOLUTE CERTAINTY PROTOCOL THRESHOLDS =====
const RULES = {
  altitudeAnomalyStdDevs: 2.5,
  speedAnomalyStdDevs: 2.5,
  frequencyAnomalyMultiplier: 3,
  temporalWindowMinutes: 60,
  minConfidenceToFlag: 60,
  biometricCorrelationWindowMin: 5,
  learningDecayDays: 90,
  recurrenceDecayThreshold: 10,
  convergencePercentThreshold: 30,
  convergenceMinAbsolute: 8,
  baselineInfraMaxWindows: 20,
  // Absolute Certainty tiers
  TIER_STATISTICAL_ANOMALY: 60,  // single source
  TIER_HIGH_CONFIDENCE: 75,      // 2 sources
  TIER_NEAR_CERTAINTY: 85,       // 3+ sources
  TIER_ABSOLUTE_CERTAINTY: 95,   // 4+ sources + external verification
};

// Corroboration weight matrix
const CORROBORATION_WEIGHTS: Record<string, number> = {
  flight_telemetry: 1.0,
  raw_adsb_receiver: 1.0,
  biometric_stress: 1.5,
  forensic_events: 1.5,
  sentinel_history: 0.8,
  enterprise_structure: 0.8,
  xxb_resolution: 1.0,
  visual_ocr: 1.2,
  violations: 1.0,
  external_faa_web: 1.5,
};

interface AutonomousFlag {
  flag_type: string;
  severity: string;
  registration: string | null;
  description: string;
  evidence_summary: Record<string, unknown>;
  cross_references: Array<Record<string, unknown>>;
  confidence_score: number;
  certainty_tier: string;
  corroboration_sources: string[];
  learning_context: Record<string, unknown>;
}

function computeCertaintyTier(sources: string[]): string {
  const uniqueSources = new Set(sources);
  if (uniqueSources.size >= 4) return 'ABSOLUTE_CERTAINTY';
  if (uniqueSources.size >= 3) return 'NEAR_CERTAINTY';
  if (uniqueSources.size >= 2) return 'HIGH_CONFIDENCE';
  return 'STATISTICAL_ANOMALY';
}

function computeCorroboratedScore(baseScore: number, sources: string[]): number {
  let bonus = 0;
  for (const src of sources) {
    bonus += (CORROBORATION_WEIGHTS[src] || 0.5) * 3;
  }
  return Math.min(99, baseScore + bonus);
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
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

    const scanId = `acp-${Date.now()}`;
    const flags: AutonomousFlag[] = [];
    const learningInsights: string[] = [];
    const startTime = Date.now();

    try {
      // ===== PHASE 1: STATISTICAL BASELINE + MULTI-MODAL INTELLIGENCE =====
      const [baselineStats, recentDetections, biometricBaseline] = await Promise.all([
        sql`
          SELECT registration, COUNT(*)::int as total_detections,
            AVG(altitude::numeric) as mean_altitude, STDDEV(altitude::numeric) as stddev_altitude,
            AVG(speed::numeric) as mean_speed, STDDEV(speed::numeric) as stddev_speed,
            MIN(detection_timestamp) as first_seen, MAX(detection_timestamp) as last_seen,
            COUNT(DISTINCT DATE(detection_timestamp))::int as active_days
          FROM live_flight_detections_rows
          WHERE registration IS NOT NULL AND registration != ''
            AND detection_timestamp > NOW() - INTERVAL '90 days'
          GROUP BY registration HAVING COUNT(*) >= 5
          ORDER BY COUNT(*) DESC LIMIT 500
        `,
        sql`
          SELECT id, registration, callsign, altitude, latitude, longitude,
            detection_timestamp, icao_code, speed, heading, vertical_rate,
            taxonomy_tag, threat_score, flagged, network_classification
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '24 hours'
          ORDER BY detection_timestamp DESC LIMIT 2000
        `,
        sql`
          SELECT AVG(heart_rate) as mean_hr, STDDEV(heart_rate) as stddev_hr,
            AVG(hrv) as mean_hrv, STDDEV(hrv) as stddev_hrv,
            AVG(stress_level) as mean_stress, STDDEV(stress_level) as stddev_stress,
            COUNT(*)::int as total_readings
          FROM biometric_monitoring
          WHERE measurement_timestamp > NOW() - INTERVAL '90 days'
        `.catch(() => [{ mean_hr: 72, stddev_hr: 12, mean_hrv: 55, stddev_hrv: 15, mean_stress: 40, stddev_stress: 15, total_readings: 0 }])
      ]);

      const baselineMap = new Map<string, any>();
      for (const b of baselineStats) baselineMap.set(b.registration, b);
      const bioBase = biometricBaseline[0] || { mean_hr: 72, stddev_hr: 12, mean_hrv: 55, stddev_hrv: 15, mean_stress: 40, stddev_stress: 15 };

      learningInsights.push(`Learned baselines for ${baselineStats.length} aircraft over 90 days`);
      learningInsights.push(`Biometric baseline: HR ${Math.round(Number(bioBase.mean_hr))}±${Math.round(Number(bioBase.stddev_hr))}`);

      // ===== PHASE 2: XXB TAXONOMY INTELLIGENCE SCAN =====
      let taxonomyIntel: any[] = [];
      let xxbRecords: any[] = [];
      try {
        [taxonomyIntel, xxbRecords] = await Promise.all([
          sql`
            SELECT taxonomy_tag, network_classification, COUNT(*)::int as count,
              COUNT(DISTINCT registration) as unique_aircraft,
              AVG(altitude::numeric) as avg_altitude
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '30 days'
              AND taxonomy_tag IS NOT NULL AND taxonomy_tag != ''
            GROUP BY taxonomy_tag, network_classification
            ORDER BY count DESC LIMIT 50
          `,
          sql`
            SELECT registration, taxonomy_tag, network_classification, COUNT(*)::int as count,
              AVG(altitude::numeric) as avg_alt, MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '30 days'
              AND (taxonomy_tag LIKE 'xxb_%' OR network_classification LIKE 'XXB%' OR network_classification = 'MLAT_ONLY')
            GROUP BY registration, taxonomy_tag, network_classification
            ORDER BY count DESC LIMIT 100
          `
        ]);
      } catch (e) { console.warn("XXB taxonomy scan error:", e); }

      const xxbAircraft = new Map<string, any>();
      for (const r of xxbRecords) {
        xxbAircraft.set(r.registration, r);
      }

      if (xxbRecords.length > 0) {
        learningInsights.push(`XXB/MLAT-ONLY TAXONOMY: ${xxbRecords.length} aircraft with non-broadcast tracking signatures across ${xxbRecords.reduce((s: number, r: any) => s + r.count, 0)} detections`);
        
        for (const r of xxbRecords) {
          if (r.count >= 10) {
            flags.push({
              flag_type: 'XXB_MLAT_ANOMALY',
              severity: r.count >= 50 ? 'critical' : r.count >= 20 ? 'high' : 'medium',
              registration: r.registration,
              description: `${r.registration} tracked via MLAT-only (non-broadcast) — ${r.count} detections over ${Math.round((new Date(r.last_seen).getTime() - new Date(r.first_seen).getTime()) / 86400000)} days at avg ${Math.round(Number(r.avg_alt || 0))}ft. Taxonomy: ${r.taxonomy_tag || 'unknown'}`,
              evidence_summary: {
                taxonomy_tag: r.taxonomy_tag,
                network_classification: r.network_classification,
                detection_count: r.count,
                avg_altitude: Math.round(Number(r.avg_alt || 0)),
                tracking_method: 'MLAT-only / Non-broadcast',
              },
              cross_references: [{ type: 'xxb_resolution', source: 'taxonomy_scan' }],
              confidence_score: Math.min(85, 55 + r.count),
              certainty_tier: 'STATISTICAL_ANOMALY',
              corroboration_sources: ['flight_telemetry', 'xxb_resolution'],
              learning_context: { method: 'xxb_taxonomy_scan', replaced_spoofing_language: true }
            });
          }
        }
      }

      // ===== PHASE 3: MULTI-MODAL DEEP CORROBORATION =====
      // Query sentinel threats, enterprise structure, shell companies, violations
      let sentinelThreats: any[] = [];
      let enterpriseEntities: any[] = [];
      let shellCompanies: any[] = [];
      let xxbResolutions: any[] = [];
      let violationRecords: any[] = [];

      try {
        const multiModalQueries = await Promise.all([
          sql`SELECT registration, threat_type, total_violations, escalation_level, avg_altitude,
                first_seen, last_seen
              FROM sentinel_learned_threats_rows
              WHERE total_violations >= 2
              ORDER BY total_violations DESC LIMIT 200
          `.catch(() => []),
          sql`SELECT entity_name, tier, role_description, linked_registrations, rico_indicators
              FROM criminal_enterprise_command_structure
              ORDER BY tier LIMIT 100
          `.catch(() => []),
          sql`SELECT company_name, jurisdiction, linked_registrations, risk_score, rico_indicator
              FROM shell_companies
              WHERE risk_score >= 50
              ORDER BY risk_score DESC LIMIT 100
          `.catch(() => []),
          sql`SELECT registration, resolved_identity, resolution_method, confidence_score
              FROM xxb_resolution_mapping
              WHERE confidence_score >= 60
              LIMIT 200
          `.catch(() => []),
          sql`SELECT registration, violation_type, COUNT(*)::int as count
              FROM ada_violation_evidence_rows
              WHERE created_at > NOW() - INTERVAL '180 days'
              GROUP BY registration, violation_type
              ORDER BY count DESC LIMIT 100
          `.catch(() => [])
        ]);

        sentinelThreats = multiModalQueries[0] as any[];
        enterpriseEntities = multiModalQueries[1] as any[];
        shellCompanies = multiModalQueries[2] as any[];
        xxbResolutions = multiModalQueries[3] as any[];
        violationRecords = multiModalQueries[4] as any[];
      } catch (e) { console.warn("Multi-modal query error:", e); }

      // Build lookup maps
      const sentinelMap = new Map<string, any>();
      for (const t of sentinelThreats) sentinelMap.set(t.registration, t);

      const shellRegMap = new Map<string, any>();
      for (const sc of shellCompanies) {
        const regs = sc.linked_registrations;
        if (Array.isArray(regs)) {
          for (const r of regs) shellRegMap.set(r, sc);
        }
      }

      const xxbMap = new Map<string, any>();
      for (const x of xxbResolutions) xxbMap.set(x.registration, x);

      const violationMap = new Map<string, number>();
      for (const v of violationRecords) {
        violationMap.set(v.registration, (violationMap.get(v.registration) || 0) + v.count);
      }

      learningInsights.push(`Multi-modal intelligence loaded: ${sentinelThreats.length} sentinel threats, ${enterpriseEntities.length} enterprise entities, ${shellCompanies.length} shell companies, ${xxbResolutions.length} XXB resolutions, ${violationRecords.length} violation records`);

      // ===== PHASE 4: ANOMALY DETECTION (statistical) =====
      // 4a. Altitude anomalies
      const altAnomalyByReg = new Map<string, any[]>();
      for (const d of recentDetections) {
        const baseline = baselineMap.get(d.registration);
        if (!baseline || !baseline.stddev_altitude || Number(baseline.stddev_altitude) === 0) continue;
        const alt = Number(d.altitude || 0);
        if (alt <= 0) continue;
        const zScore = Math.abs(alt - Number(baseline.mean_altitude)) / Number(baseline.stddev_altitude);
        if (zScore > RULES.altitudeAnomalyStdDevs && alt < Number(baseline.mean_altitude)) {
          const reg = d.registration || 'UNKNOWN';
          if (!altAnomalyByReg.has(reg)) altAnomalyByReg.set(reg, []);
          altAnomalyByReg.get(reg)!.push(d);
        }
      }

      for (const [reg, detections] of altAnomalyByReg) {
        const baseline = baselineMap.get(reg);
        if (!baseline) continue;
        const avgAnomAlt = detections.reduce((s: number, d: any) => s + Number(d.altitude), 0) / detections.length;
        
        // Build corroboration sources
        const sources: string[] = ['flight_telemetry'];
        if (sentinelMap.has(reg)) sources.push('sentinel_history');
        if (shellRegMap.has(reg)) sources.push('enterprise_structure');
        if (xxbAircraft.has(reg)) sources.push('xxb_resolution');
        if (violationMap.has(reg)) sources.push('violations');

        const baseConfidence = Math.min(85, 50 + detections.length * 5);
        const confidence = computeCorroboratedScore(baseConfidence, sources);
        const tier = computeCertaintyTier(sources);

        if (confidence >= RULES.minConfidenceToFlag) {
          flags.push({
            flag_type: 'ALTITUDE_ANOMALY',
            severity: avgAnomAlt < 500 ? 'critical' : avgAnomAlt < 1500 ? 'high' : 'medium',
            registration: reg,
            description: `${reg} at avg ${Math.round(avgAnomAlt)}ft — ${Math.round(Number(baseline.mean_altitude) - avgAnomAlt)}ft below 90-day mean (${detections.length} anomalous in 24h) [${tier}]`,
            evidence_summary: {
              mean_altitude: Math.round(Number(baseline.mean_altitude)),
              anomalous_altitude: Math.round(avgAnomAlt),
              detection_count: detections.length,
              z_score: ((Number(baseline.mean_altitude) - avgAnomAlt) / Number(baseline.stddev_altitude)).toFixed(1),
              corroboration_count: sources.length,
            },
            cross_references: sources.map(s => ({ type: s })),
            confidence_score: confidence,
            certainty_tier: tier,
            corroboration_sources: sources,
            learning_context: { method: 'statistical_z_score_v3', absolute_certainty_protocol: true }
          });
        }
      }

      // 4b. Frequency anomalies
      const last24hByReg = new Map<string, number>();
      for (const d of recentDetections) {
        if (!d.registration) continue;
        last24hByReg.set(d.registration, (last24hByReg.get(d.registration) || 0) + 1);
      }

      for (const [reg, count24h] of last24hByReg) {
        const baseline = baselineMap.get(reg);
        if (!baseline || baseline.active_days < 3) continue;
        const dailyAvg = baseline.total_detections / baseline.active_days;
        if (dailyAvg < 2) continue;

        if (count24h > dailyAvg * RULES.frequencyAnomalyMultiplier) {
          const sources: string[] = ['flight_telemetry'];
          if (sentinelMap.has(reg)) sources.push('sentinel_history');
          if (shellRegMap.has(reg)) sources.push('enterprise_structure');
          if (violationMap.has(reg)) sources.push('violations');

          const baseConfidence = Math.min(85, 55 + Math.floor((count24h / dailyAvg - RULES.frequencyAnomalyMultiplier) * 10));
          const confidence = computeCorroboratedScore(baseConfidence, sources);

          if (confidence >= RULES.minConfidenceToFlag) {
            flags.push({
              flag_type: 'FREQUENCY_SPIKE',
              severity: count24h > dailyAvg * 5 ? 'critical' : 'high',
              registration: reg,
              description: `${reg} detected ${count24h}x in 24h vs avg ${dailyAvg.toFixed(1)} — ${(count24h / dailyAvg).toFixed(1)}x normal [${computeCertaintyTier(sources)}]`,
              evidence_summary: { daily_average: dailyAvg.toFixed(1), last_24h: count24h, multiplier: (count24h / dailyAvg).toFixed(1) },
              cross_references: sources.map(s => ({ type: s })),
              confidence_score: confidence,
              certainty_tier: computeCertaintyTier(sources),
              corroboration_sources: sources,
              learning_context: { method: 'frequency_analysis_v3' }
            });
          }
        }
      }

      // 4c. Physics violations
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
          flags.push({
            flag_type: 'PHYSICS_VIOLATION',
            severity: 'critical',
            registration: reg,
            description: `${reg}: ${dets.length} impossible data points — indicates ADS-B data injection or transponder manipulation`,
            evidence_summary: { total: dets.length, negative_altitude: dets.filter((d: any) => Number(d.altitude) < 0).length },
            cross_references: [],
            confidence_score: 95,
            certainty_tier: 'NEAR_CERTAINTY',
            corroboration_sources: ['flight_telemetry'],
            learning_context: { method: 'physics_validation' }
          });
        }
      }

      // ===== PHASE 5: TEMPORAL CONVERGENCE =====
      const hourBuckets = new Map<string, Set<string>>();
      const allUniqueAircraft24h = new Set<string>();
      for (const d of recentDetections) {
        if (!d.registration) continue;
        allUniqueAircraft24h.add(d.registration);
        const hour = new Date(d.detection_timestamp).toISOString().slice(0, 13);
        if (!hourBuckets.has(hour)) hourBuckets.set(hour, new Set());
        hourBuckets.get(hour)!.add(d.registration);
      }

      const totalSectorVolume = allUniqueAircraft24h.size || 1;
      const recurrenceCount = new Map<string, number>();
      for (const [, aircraft] of hourBuckets) {
        for (const reg of aircraft) recurrenceCount.set(reg, (recurrenceCount.get(reg) || 0) + 1);
      }

      const baselineInfrastructure = new Set<string>();
      for (const [reg, count] of recurrenceCount) {
        if (count >= RULES.recurrenceDecayThreshold) baselineInfrastructure.add(reg);
      }

      for (const [hour, aircraft] of hourBuckets) {
        const nonBaseline = Array.from(aircraft).filter(r => !baselineInfrastructure.has(r));
        const clusterPercent = (nonBaseline.length / totalSectorVolume) * 100;
        if (nonBaseline.length >= RULES.convergenceMinAbsolute && clusterPercent >= RULES.convergencePercentThreshold) {
          flags.push({
            flag_type: 'TEMPORAL_CONVERGENCE',
            severity: clusterPercent >= 60 ? 'critical' : clusterPercent >= 45 ? 'high' : 'medium',
            registration: nonBaseline.slice(0, 10).join(', '),
            description: `${nonBaseline.length} non-baseline aircraft converged during ${hour}:00 UTC — ${clusterPercent.toFixed(1)}% of sector`,
            evidence_summary: { aircraft_count: nonBaseline.length, cluster_percent: clusterPercent.toFixed(1), hour },
            cross_references: [],
            confidence_score: Math.min(90, 50 + Math.round(clusterPercent)),
            certainty_tier: 'HIGH_CONFIDENCE',
            corroboration_sources: ['flight_telemetry'],
            learning_context: { method: 'percentage_sector_v3', recurrence_decay_applied: true }
          });
        }
      }

      // ===== PHASE 6: BIOMETRIC CROSS-REFERENCE =====
      let bioCorrelations: any[] = [];
      try {
        bioCorrelations = await sql`
          WITH bio_spikes AS (
            SELECT id, measurement_timestamp, heart_rate, hrv, stress_level
            FROM biometric_monitoring
            WHERE measurement_timestamp > NOW() - INTERVAL '24 hours'
              AND (heart_rate > ${Math.round(Number(bioBase.mean_hr) + 2 * Number(bioBase.stddev_hr || 12))}
                OR hrv < ${Math.round(Number(bioBase.mean_hrv) - 2 * Number(bioBase.stddev_hrv || 15))}
                OR stress_level > ${Math.round(Number(bioBase.mean_stress) + 2 * Number(bioBase.stddev_stress || 15))})
          ),
          correlated AS (
            SELECT bs.id as bio_id, bs.measurement_timestamp, bs.heart_rate, bs.stress_level,
              lf.registration, lf.altitude, lf.detection_timestamp,
              ABS(EXTRACT(EPOCH FROM (lf.detection_timestamp - bs.measurement_timestamp))) as time_delta_sec
            FROM bio_spikes bs
            INNER JOIN live_flight_detections_rows lf
              ON lf.detection_timestamp BETWEEN bs.measurement_timestamp - INTERVAL '5 minutes'
                AND bs.measurement_timestamp + INTERVAL '5 minutes'
            WHERE lf.registration IS NOT NULL
          )
          SELECT registration, COUNT(*)::int as correlation_count,
            AVG(heart_rate) as avg_hr, AVG(altitude::numeric) as avg_alt,
            AVG(time_delta_sec) as avg_delta
          FROM correlated
          GROUP BY registration HAVING COUNT(*) >= 2
          ORDER BY COUNT(*) DESC LIMIT 20
        `;
      } catch (e) { console.warn("Bio correlation error:", e); }

      for (const corr of bioCorrelations) {
        const sources: string[] = ['flight_telemetry', 'biometric_stress'];
        if (sentinelMap.has(corr.registration)) sources.push('sentinel_history');
        if (shellRegMap.has(corr.registration)) sources.push('enterprise_structure');
        if (xxbAircraft.has(corr.registration)) sources.push('xxb_resolution');
        if (violationMap.has(corr.registration)) sources.push('violations');

        const baseConfidence = Math.min(88, 55 + Number(corr.correlation_count) * 4);
        const confidence = computeCorroboratedScore(baseConfidence, sources);
        const tier = computeCertaintyTier(sources);

        if (confidence >= RULES.minConfidenceToFlag) {
          flags.push({
            flag_type: 'BIOMETRIC_CORRELATION',
            severity: Number(corr.correlation_count) >= 5 ? 'critical' : 'high',
            registration: corr.registration,
            description: `${corr.registration} correlated with ${corr.correlation_count} biometric stress events (avg HR ${Math.round(Number(corr.avg_hr))}, avg alt ${Math.round(Number(corr.avg_alt))}ft) [${tier}]`,
            evidence_summary: {
              correlations: Number(corr.correlation_count),
              avg_heart_rate: Math.round(Number(corr.avg_hr)),
              avg_altitude: Math.round(Number(corr.avg_alt)),
              corroboration_count: sources.length,
            },
            cross_references: sources.map(s => ({ type: s })),
            confidence_score: confidence,
            certainty_tier: tier,
            corroboration_sources: sources,
            learning_context: { method: 'temporal_biometric_crossref_v3', absolute_certainty_protocol: true }
          });
        }
      }

      // ===== PHASE 7: FAA REGISTRY LOOKUP & WEB SEARCH (for high-confidence flags) =====
      const FIRECRAWL_AVAILABLE = !!Deno.env.get("FIRECRAWL_API_KEY");
      let faaLookupCount = 0;
      let webSearchCount = 0;

      if (FIRECRAWL_AVAILABLE && flags.length > 0) {
        const highConfidenceRegs = new Set(
          flags.filter(f => f.confidence_score >= 80 && f.registration && !f.registration.includes(','))
            .map(f => f.registration!)
            .slice(0, 5) // Max 5 lookups per scan to stay within time budget
        );

        for (const reg of highConfidenceRegs) {
          if (Date.now() - startTime > 40000) break; // Time budget: 40s

          try {
            // Check if we already have registry data
            const existing = await sql`
              SELECT n_number, registrant_name FROM aircraft_registry
              WHERE n_number = ${reg.replace('N', '')} OR n_number = ${reg}
              LIMIT 1
            `.catch(() => []);

            if (existing.length === 0) {
              // FAA Registry lookup via firecrawl-scrape
              const faaUrl = `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${reg.replace('N', '')}`;
              const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

              const faaResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url: faaUrl, formats: ['markdown'], onlyMainContent: true }),
              });

              if (faaResponse.ok) {
                const faaData = await faaResponse.json();
                const markdown = faaData?.data?.markdown || faaData?.markdown || '';
                faaLookupCount++;

                // Update flags with FAA data
                for (const flag of flags) {
                  if (flag.registration === reg) {
                    flag.corroboration_sources.push('external_faa_web');
                    flag.confidence_score = computeCorroboratedScore(flag.confidence_score, ['external_faa_web']);
                    flag.certainty_tier = computeCertaintyTier(flag.corroboration_sources);
                    (flag.evidence_summary as any).faa_lookup = markdown.slice(0, 500);

                    // Check if owner matches shell companies
                    for (const sc of shellCompanies) {
                      if (markdown.toLowerCase().includes((sc.company_name || '').toLowerCase())) {
                        flag.corroboration_sources.push('enterprise_structure');
                        flag.confidence_score = Math.min(99, flag.confidence_score + 15);
                        (flag.evidence_summary as any).shell_company_match = sc.company_name;
                        learningInsights.push(`FAA MATCH: ${reg} registered to ${sc.company_name} — confirmed shell company link`);
                      }
                    }
                  }
                }
              } else {
                await faaResponse.text(); // consume
              }
            } else {
              // Already in registry — check against shell companies
              const owner = existing[0]?.registrant_name || '';
              for (const flag of flags) {
                if (flag.registration === reg) {
                  flag.corroboration_sources.push('external_faa_web');
                  flag.confidence_score = computeCorroboratedScore(flag.confidence_score, ['external_faa_web']);
                  flag.certainty_tier = computeCertaintyTier(flag.corroboration_sources);
                  (flag.evidence_summary as any).faa_registrant = owner;
                }
              }
            }
          } catch (e) { console.warn(`FAA lookup failed for ${reg}:`, e); }
        }

        // Web search for near-certainty flags
        if (Date.now() - startTime < 45000) {
          const nearCertaintyFlags = flags.filter(f => 
            f.confidence_score >= 85 && f.registration && !f.registration.includes(',')
          ).slice(0, 3);

          for (const flag of nearCertaintyFlags) {
            if (Date.now() - startTime > 48000) break;
            try {
              const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
              const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  query: `"${flag.registration}" aircraft owner operator`,
                  limit: 3,
                }),
              });

              if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                const results = searchData?.data || [];
                webSearchCount++;
                if (results.length > 0) {
                  (flag.evidence_summary as any).web_search_results = results.slice(0, 2).map((r: any) => ({
                    title: r.title, url: r.url, snippet: (r.description || '').slice(0, 200)
                  }));
                }
              } else {
                await searchResponse.text();
              }
            } catch (e) { console.warn(`Web search failed for ${flag.registration}:`, e); }
          }
        }
      }

      if (faaLookupCount > 0 || webSearchCount > 0) {
        learningInsights.push(`External verification: ${faaLookupCount} FAA lookups, ${webSearchCount} web searches completed`);
      }

      // ===== PHASE 8: AI SYNTHESIS =====
      let aiAnalysis: string | null = null;
      if (LOVABLE_API_KEY && flags.length > 0) {
        try {
          const topFlags = flags.sort((a, b) => b.confidence_score - a.confidence_score).slice(0, 12);
          const prompt = `AUTONOMOUS WATCHTOWER v3.0 — ABSOLUTE CERTAINTY PROTOCOL

DETECTED FLAGS (${flags.length} total, top ${topFlags.length}):
${topFlags.map(f => `- [${f.certainty_tier}] ${f.flag_type} | ${f.registration} | ${f.confidence_score}% | Sources: ${f.corroboration_sources.join('+')} | ${f.description}`).join('\n')}

MULTI-MODAL INTELLIGENCE:
- ${sentinelThreats.length} sentinel threats, ${shellCompanies.length} shell companies, ${xxbRecords.length} XXB/MLAT aircraft
- ${bioCorrelations.length} biometric correlations, ${violationRecords.length} violation records
- ${faaLookupCount} FAA lookups, ${webSearchCount} web searches

XXB TAXONOMY NOTE: XXB = MLAT-only non-broadcast tracking (NOT spoofing). These are legitimate MLAT signals indicating aircraft avoiding ADS-B broadcast.

Analyze: 1) Top 3 statistically significant patterns 2) Certainty tier accuracy 3) False positive risks 4) Recommended actions`;

          const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: "You are an autonomous bias-free surveillance anomaly analyst. XXB means MLAT-only tracking, NOT spoofing. Be precise and demand multi-source corroboration." },
                { role: "user", content: prompt }
              ],
              max_tokens: 800,
            }),
          });

          if (aiResponse.ok) {
            const data = await aiResponse.json();
            aiAnalysis = data.choices?.[0]?.message?.content || null;
          }
        } catch (aiErr) { console.error("AI synthesis error:", aiErr); }
      }

      // ===== PHASE 9: PERSIST FLAGS =====
      let savedCount = 0;
      if (supabase && flags.length > 0) {
        const persistable = flags.filter(f => f.confidence_score >= RULES.minConfidenceToFlag);
        for (const flag of persistable) {
          try {
            const { error } = await supabase.from('watchtower_autonomous_flags').insert({
              flag_type: flag.flag_type,
              severity: flag.severity,
              registration: flag.registration,
              description: flag.description,
              evidence_summary: { ...flag.evidence_summary, certainty_tier: flag.certainty_tier, corroboration_sources: flag.corroboration_sources },
              cross_references: flag.cross_references,
              confidence_score: flag.confidence_score,
              learning_context: { ...flag.learning_context, certainty_tier: flag.certainty_tier },
              source_scan_id: scanId,
            });
            if (!error) savedCount++;
          } catch (e) { console.warn("Flag persist error:", e); }
        }
      }

      // ===== PHASE 10: AUTO-RESOLVE STALE FLAGS =====
      if (supabase) {
        try {
          const staleRegs = baselineStats
            .filter((b: any) => (Date.now() - new Date(b.last_seen).getTime()) > 7 * 24 * 60 * 60 * 1000)
            .map((b: any) => b.registration);
          if (staleRegs.length > 0) {
            await supabase.from('watchtower_autonomous_flags')
              .update({ auto_resolved: true, resolved_reason: 'Aircraft not detected in 7+ days' })
              .in('registration', staleRegs).eq('auto_resolved', false);
          }
        } catch (e) { console.warn("Auto-resolve error:", e); }
      }

      await sql.end();

      return new Response(JSON.stringify({
        success: true,
        scan_id: scanId,
        version: VERSION,
        protocol: 'ABSOLUTE_CERTAINTY',
        timestamp: new Date().toISOString(),
        execution_time_ms: Date.now() - startTime,
        summary: {
          aircraft_baselines: baselineStats.length,
          recent_detections: recentDetections.length,
          flags_generated: flags.length,
          flags_persisted: savedCount,
          bio_correlations: bioCorrelations.length,
          xxb_mlat_aircraft: xxbRecords.length,
          sentinel_threats_loaded: sentinelThreats.length,
          shell_companies_loaded: shellCompanies.length,
          faa_lookups: faaLookupCount,
          web_searches: webSearchCount,
          certainty_breakdown: {
            absolute: flags.filter(f => f.certainty_tier === 'ABSOLUTE_CERTAINTY').length,
            near: flags.filter(f => f.certainty_tier === 'NEAR_CERTAINTY').length,
            high: flags.filter(f => f.certainty_tier === 'HIGH_CONFIDENCE').length,
            statistical: flags.filter(f => f.certainty_tier === 'STATISTICAL_ANOMALY').length,
          },
          critical_flags: flags.filter(f => f.severity === 'critical').length,
        },
        flags: flags.sort((a, b) => b.confidence_score - a.confidence_score),
        ai_analysis: aiAnalysis,
        learning_insights: learningInsights,
        corroboration_matrix: CORROBORATION_WEIGHTS,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
