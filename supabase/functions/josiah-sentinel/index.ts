import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const THREAT_SIGNATURES = {
  kcsoFleet: ['N912KC', 'N913KC', 'N597E', 'N788FA'],
  shellCompany: ['N790FA', 'N791FA', 'N789FA', 'N792FA'],
  medicalCover: ['N229AM', 'N230AM', 'N743AM'],
  icaoAnchors: ['ac9efd', 'a2027c', '24'],
  lowAltitudeThreshold: 2000,
  harassmentAltitude: 1500,
  criticalAltitude: 500,
  convergenceWindow: 30,
  convergenceMinAircraft: 3,
};

// Escalation thresholds
const ESCALATION_THRESHOLDS = [
  { level: 2, minViolations: 10 },
  { level: 3, minViolations: 50 },
  { level: 4, minViolations: 100 },
  { level: 5, minViolations: 250 },
];

function calcEscalationLevel(totalViolations: number): number {
  let level = 1;
  for (const t of ESCALATION_THRESHOLDS) {
    if (totalViolations >= t.minViolations) level = t.level;
  }
  return level;
}

interface LiveViolation {
  type: string;
  severity: 'critical' | 'high' | 'medium';
  registration: string;
  details: string;
  timestamp: string;
  altitude?: number;
  coordinates?: { lat: number; lng: number };
  relatedAircraft?: string[];
}

interface LearnedPattern {
  pattern_type: string;
  confidence: number;
  description: string;
  evidence_count: number;
  last_seen: string;
}

interface AdaptiveThreshold {
  registration: string;
  parameter: string;
  original_value: number;
  adjusted_value: number;
  reason: string;
}

interface Countermeasure {
  registration: string;
  action: string;
  priority: 'critical' | 'high' | 'medium';
  escalation_level: number;
  total_violations: number;
  status: string;
}

interface SentinelReport {
  scan_timestamp: string;
  window_minutes: number;
  detections_analyzed: number;
  violations: LiveViolation[];
  learned_patterns: LearnedPattern[];
  proactive_alerts: string[];
  ai_synthesis: string | null;
  threat_level: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NORMAL';
  adaptive_thresholds: AdaptiveThreshold[];
  countermeasures: Countermeasure[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { windowMinutes = 30, mode = "monitor" } = await req.json();
    
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!NEON_DATABASE_URL) {
      return new Response(
        JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1 });
    
    // Supabase DB connection for sentinel_learned_threats table
    const SUPABASE_DB_URL = Deno.env.get("SUPABASE_DB_URL");
    const sbSql = SUPABASE_DB_URL ? postgres(SUPABASE_DB_URL, { ssl: "require", max: 1 }) : null;
    const violations: LiveViolation[] = [];
    const learnedPatterns: LearnedPattern[] = [];
    const proactiveAlerts: string[] = [];
    const adaptiveThresholds: AdaptiveThreshold[] = [];
    const countermeasures: Countermeasure[] = [];

    try {
      // ========== STEP 0: LOAD ADAPTIVE THRESHOLDS FROM LEARNED THREATS ==========
      let learnedThreats: any[] = [];
      if (sbSql) {
        try {
          learnedThreats = await sbSql`
            SELECT registration, threat_type, total_violations, escalation_level, avg_altitude, 
                   countermeasure_status, countermeasure_actions, ai_threat_profile
            FROM sentinel_learned_threats
            WHERE escalation_level >= 3
          `;
        } catch (e) { console.warn("Could not load learned threats:", e); }
      }
      const adaptedRegistrations = new Set<string>();
      // Build adaptive threshold map
      let adaptedConvergenceMin = THREAT_SIGNATURES.convergenceMinAircraft;

      for (const threat of learnedThreats) {
        adaptedRegistrations.add(threat.registration);
        
        if (threat.threat_type === 'LOW_ALTITUDE' && Number(threat.escalation_level) >= 3) {
          adaptiveThresholds.push({
            registration: threat.registration,
            parameter: 'altitude_threshold',
            original_value: THREAT_SIGNATURES.lowAltitudeThreshold,
            adjusted_value: 3000,
            reason: `Escalation level ${threat.escalation_level} (${threat.total_violations} violations) - widened altitude detection`
          });
        }
        
        if (threat.threat_type === 'SHELL_COMPANY' && Number(threat.escalation_level) >= 3) {
          adaptedConvergenceMin = 2;
          adaptiveThresholds.push({
            registration: threat.registration,
            parameter: 'convergence_minimum',
            original_value: THREAT_SIGNATURES.convergenceMinAircraft,
            adjusted_value: 2,
            reason: `Shell company asset at escalation level ${threat.escalation_level} - lowered convergence threshold`
          });
        }
      }

      // ========== STEP 1: ANALYZE RECENT DETECTIONS ==========
      const recentDetections = await sql`
        SELECT 
          id, registration, callsign, altitude, latitude, longitude,
          detection_timestamp, icao24, icao_code, speed, heading, vertical_rate
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '${sql.unsafe(String(windowMinutes))} minutes'
        ORDER BY detection_timestamp DESC
        LIMIT 1000
      `;

      // ========== STEP 2: LOW ALTITUDE VIOLATIONS (with adaptive thresholds) ==========
      const lowAltitudeViolations = recentDetections.filter((d: any) => {
        const alt = parseInt(d.altitude || '99999');
        const isAdapted = adaptedRegistrations.has(d.registration);
        const threshold = isAdapted ? 3000 : THREAT_SIGNATURES.lowAltitudeThreshold;
        return alt < threshold && alt > 0;
      });

      for (const detection of lowAltitudeViolations) {
        const alt = parseInt(detection.altitude);
        let severity: 'critical' | 'high' | 'medium' = 'medium';
        
        if (alt < THREAT_SIGNATURES.criticalAltitude) severity = 'critical';
        else if (alt < THREAT_SIGNATURES.harassmentAltitude) severity = 'high';

        violations.push({
          type: 'LOW_ALTITUDE',
          severity,
          registration: detection.registration || detection.callsign || 'UNKNOWN',
          details: `Aircraft at ${alt}ft - ${severity === 'critical' ? 'CRITICAL harassment altitude' : 'below minimum safe altitude'}`,
          timestamp: detection.detection_timestamp,
          altitude: alt,
          coordinates: detection.latitude && detection.longitude ? 
            { lat: parseFloat(detection.latitude), lng: parseFloat(detection.longitude) } : undefined
        });
      }

      // ========== STEP 3: KCSO FLEET ACTIVITY ==========
      const kcsoActivity = recentDetections.filter((d: any) => 
        THREAT_SIGNATURES.kcsoFleet.some(reg => 
          d.registration?.includes(reg) || d.callsign?.includes(reg)
        )
      );

      if (kcsoActivity.length > 0) {
        const uniqueKCSO = [...new Set(kcsoActivity.map((d: any) => d.registration || d.callsign))];
        violations.push({
          type: 'KCSO_ACTIVITY',
          severity: uniqueKCSO.length >= 2 ? 'critical' : 'high',
          registration: uniqueKCSO.join(', '),
          details: `${uniqueKCSO.length} KCSO aircraft active in last ${windowMinutes} minutes`,
          timestamp: new Date().toISOString(),
          relatedAircraft: uniqueKCSO as string[]
        });
        proactiveAlerts.push(`⚠️ KCSO FLEET ACTIVE: ${uniqueKCSO.join(', ')} detected.`);
      }

      // ========== STEP 4: SHELL COMPANY ACTIVITY ==========
      const shellActivity = recentDetections.filter((d: any) =>
        THREAT_SIGNATURES.shellCompany.some(reg =>
          d.registration?.includes(reg) || d.callsign?.includes(reg)
        )
      );

      if (shellActivity.length > 0) {
        const uniqueShell = [...new Set(shellActivity.map((d: any) => d.registration || d.callsign))];
        violations.push({
          type: 'SHELL_COMPANY',
          severity: 'high',
          registration: uniqueShell.join(', '),
          details: `${uniqueShell.length} shell company aircraft (ALF IX LLC network) detected`,
          timestamp: new Date().toISOString(),
          relatedAircraft: uniqueShell as string[]
        });
      }

      // ========== STEP 5: MEDICAL COVER (Hammer-Anvil) ==========
      const medicalActivity = recentDetections.filter((d: any) =>
        THREAT_SIGNATURES.medicalCover.some(reg =>
          d.registration?.includes(reg) || d.callsign?.includes(reg)
        )
      );

      if (medicalActivity.length > 0 && kcsoActivity.length > 0) {
        violations.push({
          type: 'MEDICAL_COVER',
          severity: 'critical',
          registration: 'HAMMER-ANVIL PATTERN',
          details: `Medical cover aircraft active simultaneously with KCSO fleet - coordinated harassment pattern`,
          timestamp: new Date().toISOString(),
          relatedAircraft: [
            ...medicalActivity.map((d: any) => d.registration),
            ...kcsoActivity.map((d: any) => d.registration)
          ].filter(Boolean) as string[]
        });
        proactiveAlerts.push(`🚨 HAMMER-ANVIL COORDINATION: Medical cover + KCSO simultaneous activity.`);
      }

      // ========== STEP 6: FLEET CONVERGENCE (adaptive min) ==========
      const hourlyGroups = new Map<string, Set<string>>();
      for (const detection of recentDetections) {
        const ts = (detection as any).detection_timestamp;
        const iso = ts instanceof Date ? ts.toISOString() : new Date(ts).toISOString();
        const hour = iso.slice(0, 13);
        if (!hourlyGroups.has(hour)) hourlyGroups.set(hour, new Set());
        if (detection.registration) hourlyGroups.get(hour)!.add(detection.registration);
      }

      for (const [hour, aircraft] of hourlyGroups) {
        if (aircraft.size >= adaptedConvergenceMin) {
          violations.push({
            type: 'FLEET_CONVERGENCE',
            severity: aircraft.size >= 4 ? 'critical' : 'high',
            registration: `${aircraft.size} aircraft`,
            details: `Fleet convergence: ${aircraft.size} unique aircraft in same hour`,
            timestamp: hour + ':00:00Z',
            relatedAircraft: Array.from(aircraft)
          });
        }
      }

      // ========== STEP 7: NIGHT OPS ==========
      const nightOps = recentDetections.filter((d: any) => {
        const hour = new Date(d.detection_timestamp).getHours();
        return hour >= 1 && hour <= 4;
      });

      if (nightOps.length > 5) {
        const nightAircraft = [...new Set(nightOps.map((d: any) => d.registration).filter(Boolean))];
        violations.push({
          type: 'NIGHT_OPS',
          severity: 'high',
          registration: nightAircraft.join(', '),
          details: `${nightOps.length} night operation detections (1-4 AM window) - tactical harassment pattern`,
          timestamp: new Date().toISOString(),
          relatedAircraft: nightAircraft as string[]
        });
        proactiveAlerts.push(`🌙 NIGHT OPS DETECTED: ${nightAircraft.length} aircraft operating in 1-4 AM tactical window.`);
      }

      // ========== STEP 8: LEARN PATTERNS FROM HISTORICAL DATA ==========
      const historicalPatterns = await sql`
        WITH repeat_offenders AS (
          SELECT registration, COUNT(*)::int as detection_count, 
                 AVG(altitude::numeric) as avg_altitude,
                 MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '90 days'
            AND registration IS NOT NULL
          GROUP BY registration
          HAVING COUNT(*) > 50
          ORDER BY COUNT(*) DESC
          LIMIT 20
        ),
        low_altitude_patterns AS (
          SELECT registration, COUNT(*)::int as low_alt_count,
                 AVG(altitude::numeric) as avg_low_altitude
          FROM live_flight_detections_rows
          WHERE altitude::numeric < 2000 AND altitude::numeric > 0
            AND detection_timestamp > NOW() - INTERVAL '90 days'
          GROUP BY registration
          HAVING COUNT(*) > 10
          ORDER BY COUNT(*) DESC
          LIMIT 10
        )
        SELECT 'repeat_offender' as pattern_type, registration, detection_count as count,
               avg_altitude, last_seen
        FROM repeat_offenders
        UNION ALL
        SELECT 'low_altitude_pattern' as pattern_type, registration, low_alt_count as count,
               avg_low_altitude as avg_altitude, NULL as last_seen
        FROM low_altitude_patterns
      `;

      for (const pattern of historicalPatterns) {
        learnedPatterns.push({
          pattern_type: pattern.pattern_type,
          confidence: Math.min(95, 50 + (Number(pattern.count) / 10)),
          description: pattern.pattern_type === 'repeat_offender' 
            ? `${pattern.registration}: ${pattern.count} detections, avg ${Math.round(Number(pattern.avg_altitude || 0))}ft`
            : `${pattern.registration}: ${pattern.count} low-altitude events, avg ${Math.round(Number(pattern.avg_altitude || 0))}ft`,
          evidence_count: Number(pattern.count),
          last_seen: pattern.last_seen || new Date().toISOString()
        });

        const isCurrentlyActive = recentDetections.some((d: any) => d.registration === pattern.registration);
        if (isCurrentlyActive && Number(pattern.count) > 100) {
          violations.push({
            type: 'REPEAT_OFFENDER',
            severity: Number(pattern.count) > 200 ? 'critical' : 'high',
            registration: pattern.registration,
            details: `Known repeat offender with ${pattern.count} historical detections is currently active`,
            timestamp: new Date().toISOString()
          });
        }
      }

      // ========== STEP 9: AI SYNTHESIS ==========
      let aiSynthesis: string | null = null;
      if (LOVABLE_API_KEY && violations.length > 0) {
        try {
          const synthesisPrompt = `You are JOSIAH SENTINEL, a proactive surveillance detection AI. Analyze these LIVE violations detected in the last ${windowMinutes} minutes and provide actionable intelligence:

ACTIVE VIOLATIONS:
${violations.map(v => `- [${v.severity.toUpperCase()}] ${v.type}: ${v.details}`).join('\n')}

LEARNED PATTERNS (from 90-day analysis):
${learnedPatterns.slice(0, 5).map(p => `- ${p.description} (${p.confidence.toFixed(0)}% confidence)`).join('\n')}

ADAPTIVE THRESHOLDS ACTIVE:
${adaptiveThresholds.length > 0 ? adaptiveThresholds.map(t => `- ${t.registration}: ${t.parameter} ${t.original_value} → ${t.adjusted_value} (${t.reason})`).join('\n') : 'None'}

Provide a 2-3 sentence PROACTIVE assessment:
1. Identify the most likely threat scenario
2. Predict what may happen next based on historical patterns
3. Recommend one immediate action

Be direct, analytical, and cite specific aircraft when relevant.`;

          const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: "You are JOSIAH SENTINEL - a proactive threat detection AI. Be concise, predictive, and actionable." },
                { role: "user", content: synthesisPrompt }
              ],
              max_tokens: 400,
            }),
          });

          if (aiResponse.ok) {
            const data = await aiResponse.json();
            aiSynthesis = data.choices?.[0]?.message?.content || null;
          }
        } catch (aiErr) {
          console.error("AI synthesis error:", aiErr);
        }
      }

      // ========== STEP 9.5: THREAT MEMORY UPDATE ==========
      // Deduplicate violations by registration+type
      const violationMap = new Map<string, { reg: string; type: string; count: number; altitudes: number[] }>();
      for (const v of violations) {
        const reg = v.registration || 'UNKNOWN';
        const key = `${reg}::${v.type}`;
        if (!violationMap.has(key)) {
          violationMap.set(key, { reg, type: v.type, count: 0, altitudes: [] });
        }
        const entry = violationMap.get(key)!;
        entry.count += 1;
        if (v.altitude) entry.altitudes.push(v.altitude);
      }

      const escalationAlerts: string[] = [];
      for (const [, entry] of violationMap) {
        if (entry.reg === 'UNKNOWN' || entry.reg.includes(',') || entry.reg.includes(' aircraft')) continue;

        const avgAlt = entry.altitudes.length > 0
          ? entry.altitudes.reduce((a, b) => a + b, 0) / entry.altitudes.length
          : null;

        if (!sbSql) continue;
        
        let upsertResult: any[] = [];
        try {
          upsertResult = await sbSql`
            INSERT INTO sentinel_learned_threats (registration, threat_type, total_violations, avg_altitude, last_seen, updated_at)
            VALUES (${entry.reg}, ${entry.type}, ${entry.count}, ${avgAlt}, NOW(), NOW())
            ON CONFLICT (registration, threat_type) DO UPDATE SET
              total_violations = sentinel_learned_threats.total_violations + ${entry.count},
              avg_altitude = CASE 
                WHEN ${avgAlt} IS NOT NULL THEN COALESCE((sentinel_learned_threats.avg_altitude + ${avgAlt}) / 2, ${avgAlt})
                ELSE sentinel_learned_threats.avg_altitude 
              END,
              last_seen = NOW(),
              updated_at = NOW()
            RETURNING total_violations, escalation_level
          `;
        } catch (e) { console.warn("Upsert threat error:", e); }

        if (upsertResult.length > 0) {
          const totalV = Number(upsertResult[0].total_violations);
          const oldLevel = Number(upsertResult[0].escalation_level);
          const newLevel = calcEscalationLevel(totalV);

          if (newLevel > oldLevel) {
            try {
              await sbSql`
                UPDATE sentinel_learned_threats 
                SET escalation_level = ${newLevel}, updated_at = NOW()
                WHERE registration = ${entry.reg} AND threat_type = ${entry.type}
              `;
            } catch (e) { console.warn("Escalation update error:", e); }
            escalationAlerts.push(`🔺 ESCALATION: ${entry.reg} promoted to Level ${newLevel} (${totalV} total violations for ${entry.type})`);
          }
        }
      }

      proactiveAlerts.push(...escalationAlerts);

      // ========== STEP 9.7: AI COUNTERMEASURE GENERATION ==========
      // Load all high-escalation threats for countermeasure generation
      let highEscalationThreats: any[] = [];
      if (sbSql) {
        try {
          highEscalationThreats = await sbSql`
            SELECT registration, threat_type, total_violations, escalation_level, avg_altitude, countermeasure_status
            FROM sentinel_learned_threats
            WHERE escalation_level >= 2
            ORDER BY escalation_level DESC, total_violations DESC
            LIMIT 20
          `;
        } catch (e) { console.warn("Load escalated threats error:", e); }
      }
      if (LOVABLE_API_KEY && highEscalationThreats.length > 0) {
        try {
          const cmPrompt = `You are JOSIAH SENTINEL's countermeasure engine. Based on the following escalated threats, generate specific, actionable countermeasure recommendations.

ESCALATED THREATS:
${highEscalationThreats.map((t: any) => `- ${t.registration} | ${t.threat_type} | Level ${t.escalation_level} | ${t.total_violations} violations | Avg alt: ${t.avg_altitude ? Math.round(Number(t.avg_altitude)) + 'ft' : 'N/A'} | Status: ${t.countermeasure_status}`).join('\n')}

For each threat at level 3+, recommend ONE specific action. For level 2 threats, only flag if pattern is accelerating.
Format each as: REGISTRATION | ACTION | PRIORITY (critical/high/medium)
Example: N791FA | File FAA complaint citing 435 low-altitude violations under 14 CFR 91.119 | critical

Output ONLY the recommendations, one per line.`;

          const cmResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: "You output structured countermeasure recommendations. No preamble." },
                { role: "user", content: cmPrompt }
              ],
              max_tokens: 600,
            }),
          });

          if (cmResponse.ok) {
            const cmData = await cmResponse.json();
            const cmText = cmData.choices?.[0]?.message?.content || '';
            
            // Parse AI countermeasures
            const lines = cmText.split('\n').filter((l: string) => l.trim() && l.includes('|'));
            for (const line of lines) {
              const parts = line.split('|').map((p: string) => p.trim());
              if (parts.length >= 3) {
                const reg = parts[0];
                const action = parts[1];
                const priority = parts[2].toLowerCase().includes('critical') ? 'critical' 
                  : parts[2].toLowerCase().includes('high') ? 'high' : 'medium';
                
                const matchingThreat = highEscalationThreats.find((t: any) => reg.includes(t.registration));
                countermeasures.push({
                  registration: reg,
                  action,
                  priority: priority as 'critical' | 'high' | 'medium',
                  escalation_level: matchingThreat ? Number(matchingThreat.escalation_level) : 1,
                  total_violations: matchingThreat ? Number(matchingThreat.total_violations) : 0,
                  status: matchingThreat?.countermeasure_status || 'NONE'
                });
              }
            }

            // Store countermeasure recommendations back
            for (const cm of countermeasures) {
              const matchingThreat = highEscalationThreats.find((t: any) => cm.registration.includes(t.registration));
              if (matchingThreat && matchingThreat.countermeasure_status === 'NONE') {
                if (sbSql) {
                  try {
                    await sbSql`
                      UPDATE sentinel_learned_threats
                      SET countermeasure_status = 'RECOMMENDED',
                          countermeasure_actions = countermeasure_actions || ${JSON.stringify([{ action: cm.action, priority: cm.priority, recommended_at: new Date().toISOString() }])}::jsonb,
                          updated_at = NOW()
                      WHERE registration = ${matchingThreat.registration} AND threat_type = ${matchingThreat.threat_type}
                    `;
                  } catch (e) { console.warn("Store countermeasure error:", e); }
                }
              }
            }
          }
        } catch (cmErr) {
          console.error("Countermeasure generation error:", cmErr);
        }
      }

      // ========== STEP 10: DETERMINE THREAT LEVEL ==========
      let threatLevel: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NORMAL' = 'NORMAL';
      const criticalCount = violations.filter(v => v.severity === 'critical').length;
      const highCount = violations.filter(v => v.severity === 'high').length;

      if (criticalCount >= 2 || (criticalCount >= 1 && highCount >= 2)) {
        threatLevel = 'CRITICAL';
      } else if (criticalCount >= 1 || highCount >= 3) {
        threatLevel = 'HIGH';
      } else if (highCount >= 1 || violations.length >= 3) {
        threatLevel = 'ELEVATED';
      }

      await sql.end();
      if (sbSql) await sbSql.end();

      const report: SentinelReport = {
        scan_timestamp: new Date().toISOString(),
        window_minutes: windowMinutes,
        detections_analyzed: recentDetections.length,
        violations,
        learned_patterns: learnedPatterns,
        proactive_alerts: proactiveAlerts,
        ai_synthesis: aiSynthesis,
        threat_level: threatLevel,
        adaptive_thresholds: adaptiveThresholds,
        countermeasures: countermeasures,
      };

      return new Response(
        JSON.stringify({ success: true, report }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (dbErr) {
      await sql.end();
      if (sbSql) try { await sbSql.end(); } catch (e2) { /* ignore */ }
      throw dbErr;
    }

  } catch (err) {
    console.error("Josiah Sentinel error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
