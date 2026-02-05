import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Learned threat signatures from historical analysis
const THREAT_SIGNATURES = {
  // KCSO primary fleet
  kcsoFleet: ['N912KC', 'N913KC', 'N597E', 'N788FA'],
  // Shell company aircraft
  shellCompany: ['N790FA', 'N791FA', 'N789FA', 'N792FA'],
  // Medical cover assets (Hammer-Anvil pattern)
  medicalCover: ['N229AM', 'N230AM', 'N743AM'],
  // Known polymorphic ICAO anchors
  icaoAnchors: ['ac9efd', 'a2027c', '24'],
  // Low altitude threshold (feet)
  lowAltitudeThreshold: 2000,
  // Harassment altitude (feet)
  harassmentAltitude: 1500,
  // Critical altitude (feet)
  criticalAltitude: 500,
  // Convergence window (minutes)
  convergenceWindow: 30,
  // Minimum aircraft for convergence
  convergenceMinAircraft: 3,
};

interface LiveViolation {
  type: 'LOW_ALTITUDE' | 'KCSO_ACTIVITY' | 'SHELL_COMPANY' | 'MEDICAL_COVER' | 'FLEET_CONVERGENCE' | 'HOLDING_PATTERN' | 'NIGHT_OPS' | 'REPEAT_OFFENDER';
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

interface SentinelReport {
  scan_timestamp: string;
  window_minutes: number;
  detections_analyzed: number;
  violations: LiveViolation[];
  learned_patterns: LearnedPattern[];
  proactive_alerts: string[];
  ai_synthesis: string | null;
  threat_level: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NORMAL';
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
    const violations: LiveViolation[] = [];
    const learnedPatterns: LearnedPattern[] = [];
    const proactiveAlerts: string[] = [];

    try {
      // 1. ANALYZE RECENT DETECTIONS
      const recentDetections = await sql`
        SELECT 
          id, registration, callsign, altitude, latitude, longitude,
          detection_timestamp, icao24, operator, aircraft_type,
          ground_speed, heading, vertical_rate
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '${sql.unsafe(String(windowMinutes))} minutes'
        ORDER BY detection_timestamp DESC
        LIMIT 1000
      `;

      // 2. DETECT LOW ALTITUDE VIOLATIONS
      const lowAltitudeViolations = recentDetections.filter((d: any) => {
        const alt = parseInt(d.altitude || '99999');
        return alt < THREAT_SIGNATURES.lowAltitudeThreshold && alt > 0;
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

      // 3. DETECT KCSO FLEET ACTIVITY
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

        proactiveAlerts.push(`⚠️ KCSO FLEET ACTIVE: ${uniqueKCSO.join(', ')} detected. Historical pattern indicates coordinated surveillance.`);
      }

      // 4. DETECT SHELL COMPANY ACTIVITY
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

      // 5. DETECT MEDICAL COVER PATTERN (Hammer-Anvil)
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

        proactiveAlerts.push(`🚨 HAMMER-ANVIL COORDINATION: Medical cover + KCSO simultaneous activity. This is a documented harassment pattern.`);
      }

      // 6. DETECT FLEET CONVERGENCE
      const hourlyGroups = new Map<string, Set<string>>();
      for (const detection of recentDetections) {
        const hour = detection.detection_timestamp?.substring(0, 13); // YYYY-MM-DDTHH
        if (!hourlyGroups.has(hour)) hourlyGroups.set(hour, new Set());
        if (detection.registration) hourlyGroups.get(hour)!.add(detection.registration);
      }

      for (const [hour, aircraft] of hourlyGroups) {
        if (aircraft.size >= THREAT_SIGNATURES.convergenceMinAircraft) {
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

      // 7. DETECT NIGHT OPS (1-4 AM pattern)
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

      // 8. LEARN PATTERNS FROM HISTORICAL DATA
      const historicalPatterns = await sql`
        WITH repeat_offenders AS (
          SELECT registration, COUNT(*) as detection_count, 
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
          SELECT registration, COUNT(*) as low_alt_count,
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
          confidence: Math.min(95, 50 + (parseInt(pattern.count) / 10)),
          description: pattern.pattern_type === 'repeat_offender' 
            ? `${pattern.registration}: ${pattern.count} detections, avg ${Math.round(pattern.avg_altitude || 0)}ft`
            : `${pattern.registration}: ${pattern.count} low-altitude events, avg ${Math.round(pattern.avg_altitude || 0)}ft`,
          evidence_count: parseInt(pattern.count),
          last_seen: pattern.last_seen || new Date().toISOString()
        });

        // Flag repeat offenders in current window
        const isCurrentlyActive = recentDetections.some((d: any) => d.registration === pattern.registration);
        if (isCurrentlyActive && parseInt(pattern.count) > 100) {
          violations.push({
            type: 'REPEAT_OFFENDER',
            severity: parseInt(pattern.count) > 200 ? 'critical' : 'high',
            registration: pattern.registration,
            details: `Known repeat offender with ${pattern.count} historical detections is currently active`,
            timestamp: new Date().toISOString()
          });
        }
      }

      // 9. AI SYNTHESIS (Proactive Analysis)
      let aiSynthesis: string | null = null;
      if (LOVABLE_API_KEY && violations.length > 0) {
        try {
          const synthesisPrompt = `You are JOSIAH SENTINEL, a proactive surveillance detection AI. Analyze these LIVE violations detected in the last ${windowMinutes} minutes and provide actionable intelligence:

ACTIVE VIOLATIONS:
${violations.map(v => `- [${v.severity.toUpperCase()}] ${v.type}: ${v.details}`).join('\n')}

LEARNED PATTERNS (from 90-day analysis):
${learnedPatterns.slice(0, 5).map(p => `- ${p.description} (${p.confidence}% confidence)`).join('\n')}

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

      // 10. DETERMINE THREAT LEVEL
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

      const report: SentinelReport = {
        scan_timestamp: new Date().toISOString(),
        window_minutes: windowMinutes,
        detections_analyzed: recentDetections.length,
        violations,
        learned_patterns: learnedPatterns,
        proactive_alerts: proactiveAlerts,
        ai_synthesis: aiSynthesis,
        threat_level: threatLevel
      };

      return new Response(
        JSON.stringify({ success: true, report }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (dbErr) {
      await sql.end();
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
