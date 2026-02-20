import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

type SQL = ReturnType<typeof postgres>;

export async function handleAction(action: string, body: Record<string, any>, sql: SQL): Promise<unknown> {
  switch (action) {
    // ============== BEHAVIORAL ALIGNMENT ==============
    case 'getBehavioralAlignment': {
      try {
        const alignments = await sql.unsafe(`
          WITH candidates AS (
            SELECT
              registration as aircraft_tail,
              COUNT(*) as detection_count,
              ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude_ft,
              ROUND(
                ((SUM(CASE WHEN altitude < 1500 AND altitude > 0 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100)
              , 1) as low_altitude_pct,
              SUM(CASE WHEN COALESCE(speed, 0) < 80 THEN 1 ELSE 0 END) as loiter_count,
              MIN(COALESCE(detection_timestamp, created_at)) as first_detection,
              MAX(COALESCE(detection_timestamp, created_at)) as last_detection
            FROM live_flight_detections_rows
            WHERE registration IS NOT NULL
              AND registration != ''
              AND (
                taxonomy_tag IN ('xxb_tier2_shell', 'xxb_shell', 'xxb_kcso_shell', 'xxb_tier1_priority', 'xxb_kcso')
                OR registration ~ '^N7[89][0-9]'
                OR registration ~ '^N[0-9]+FF$'
                OR registration ~ '^N[0-9]+KC$'
                OR registration ~ '^N[0-9]+FA$'
                OR registration ~ '^N[0-9]+AM$'
                OR (altitude < 2000 AND altitude > 0)
              )
            GROUP BY registration
            HAVING COUNT(*) > 2
            ORDER BY COUNT(*) DESC
            LIMIT 75
          ), scored AS (
            SELECT
              ROW_NUMBER() OVER () as id,
              aircraft_tail,
              LEAST(100, 40 + (low_altitude_pct * 0.6) + LEAST(loiter_count, 50)) as match_score_to_kcso,
              detection_count,
              avg_altitude_ft,
              low_altitude_pct,
              loiter_count,
              first_detection,
              last_detection
            FROM candidates
          )
          SELECT
            id,
            aircraft_tail as entity_name,
            'SHELL_COMPANY' as entity_type,
            aircraft_tail,
            ROUND(match_score_to_kcso::numeric, 1) as match_score_to_kcso,
            CASE
              WHEN low_altitude_pct >= 60 OR loiter_count >= 20 THEN 'LOITER_MIMIC'
              WHEN low_altitude_pct >= 30 THEN 'ALTITUDE_ECHO'
              WHEN detection_count >= 25 THEN 'PERSISTENT_PRESENCE'
              ELSE 'STANDARD'
            END as behavior_type,
            false as confirmed_flight_overlap,
            25 as geofence_radius_km,
            ROUND(LEAST(100, match_score_to_kcso * 0.7)::numeric, 1) as biometric_link_score,
            CASE
              WHEN match_score_to_kcso >= 85 THEN 'Tier 1 Probationary'
              WHEN match_score_to_kcso >= 70 THEN 'Tier 2 Watch'
              ELSE 'Monitoring'
            END as risk_tier,
            avg_altitude_ft,
            loiter_count,
            detection_count,
            low_altitude_pct,
            'N912KC/N913KC' as reference_aircraft,
            'RICO' as legal_exposure,
            CASE
              WHEN match_score_to_kcso >= 85 THEN 'HIGH'
              WHEN match_score_to_kcso >= 70 THEN 'MEDIUM'
              ELSE 'LOW'
            END as prosecution_priority,
            first_detection::text,
            last_detection::text
          FROM scored
          ORDER BY match_score_to_kcso DESC, detection_count DESC
        `);
        const summary = Array.isArray(alignments) ? {
          totalRecords: alignments.length,
          tier1Probationary: alignments.filter((a: any) => String(a.risk_tier).includes('Tier 1')).length,
          tier2Watch: alignments.filter((a: any) => String(a.risk_tier).includes('Tier 2')).length,
          highMatchAlerts: alignments.filter((a: any) => Number(a.match_score_to_kcso) >= 85).length,
          uniqueEntities: new Set(alignments.map((a: any) => a.entity_name)).size,
          uniqueAircraft: new Set(alignments.map((a: any) => a.aircraft_tail)).size,
        } : { totalRecords: 0, tier1Probationary: 0, tier2Watch: 0, highMatchAlerts: 0, uniqueEntities: 0, uniqueAircraft: 0 };
        return { data: { alignments: alignments || [], summary } };
      } catch (e) {
        console.error('getBehavioralAlignment error:', e);
        return { data: { alignments: [], summary: null } };
      }
    }

    case 'computeBehavioralAlignment': {
      try {
        const count = await sql`
          SELECT COUNT(DISTINCT registration) as c
          FROM live_flight_detections_rows
          WHERE registration IS NOT NULL AND registration != ''
            AND (taxonomy_tag IN ('xxb_tier2_shell', 'xxb_shell', 'xxb_kcso_shell', 'xxb_tier1_priority', 'xxb_kcso')
              OR registration ~ '^N7[89][0-9]' OR registration ~ '^N[0-9]+FF$'
              OR registration ~ '^N[0-9]+KC$' OR registration ~ '^N[0-9]+FA$'
              OR registration ~ '^N[0-9]+AM$' OR (altitude < 2000 AND altitude > 0))
        `;
        return { data: { alignmentRecordsCreated: parseInt(count[0]?.c || '0') } };
      } catch { return { data: { alignmentRecordsCreated: 0 } }; }
    }

    case 'createBehavioralAlignmentTable':
      return { data: { success: true, message: 'Derived from live_flight_detections_rows' } };

    // ============== MEDICAL BEHAVIORAL ALIGNMENT ==============
    case 'getMedicalBehavioralAlignment': {
      try {
        const alignments = await sql.unsafe(`
          WITH candidates AS (
            SELECT
              registration as aircraft_tail,
              COALESCE(NULLIF(MAX(callsign), ''), 'Unknown') as operator_name,
              COUNT(*) as detection_count,
              ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude_ft,
              ROUND(((SUM(CASE WHEN altitude < 1500 AND altitude > 0 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100), 1) as low_altitude_pct,
              SUM(CASE WHEN COALESCE(speed, 0) < 80 THEN 1 ELSE 0 END) as loiter_count,
              BOOL_OR(callsign ILIKE '%MED%' OR callsign ILIKE '%LIFE%' OR callsign ILIKE '%MERCY%' OR callsign ILIKE '%REACH%' OR callsign ILIKE '%CARE%' OR callsign ILIKE '%PHI%' OR callsign ILIKE '%CAL%' OR callsign ILIKE '%AIR%') as medical_mission_logged,
              MIN(COALESCE(detection_timestamp, created_at)) as first_detection,
              MAX(COALESCE(detection_timestamp, created_at)) as last_detection
            FROM live_flight_detections_rows
            WHERE registration IS NOT NULL AND registration != ''
              AND (taxonomy_tag IN ('xxb_medical_air', 'xxb_tier1_priority')
                OR registration ~ '^N[0-9]+RX$'
                OR callsign ILIKE '%MED%' OR callsign ILIKE '%LIFE%' OR callsign ILIKE '%MERCY%'
                OR callsign ILIKE '%REACH%' OR callsign ILIKE '%PHI%' OR callsign ILIKE '%CARE%'
                OR callsign ILIKE '%CAL%' OR callsign ILIKE '%AIR1%' OR callsign ILIKE '%EVAC%'
                OR callsign ~ '^N[0-9]+AM$')
            GROUP BY registration HAVING COUNT(*) > 2
            ORDER BY COUNT(*) DESC LIMIT 50
          ), scored AS (
            SELECT ROW_NUMBER() OVER () as id, operator_name, aircraft_tail, detection_count,
              avg_altitude_ft, low_altitude_pct, loiter_count, medical_mission_logged,
              first_detection, last_detection,
              LEAST(100, 35 + (low_altitude_pct * 0.6) + LEAST(loiter_count, 50)) as match_score_to_kcso
            FROM candidates
          )
          SELECT id, operator_name, 'MEDICAL_OPERATOR' as operator_type, aircraft_tail,
            ROUND(match_score_to_kcso::numeric, 1) as match_score_to_kcso,
            CASE
              WHEN NOT medical_mission_logged AND match_score_to_kcso >= 85 THEN 'MEDEVAC_FRAUD'
              WHEN NOT medical_mission_logged THEN 'NO_MEDICAL_MISSION'
              WHEN low_altitude_pct >= 60 OR loiter_count >= 20 THEN 'SURVEILLANCE_PATTERN'
              WHEN low_altitude_pct >= 30 THEN 'ALTITUDE_ECHO'
              ELSE 'STANDARD'
            END as behavior_type,
            medical_mission_logged, loiter_count,
            ROUND(LEAST(100, match_score_to_kcso * 0.6)::numeric, 1) as biometric_link_score,
            CASE WHEN match_score_to_kcso >= 85 THEN 'Tier 1 Fraud Watch' WHEN match_score_to_kcso >= 70 THEN 'Tier 2 Suspect' ELSE 'Monitoring' END as risk_tier,
            avg_altitude_ft, detection_count, low_altitude_pct,
            'N912KC/N913KC' as reference_aircraft, 'False Claims Act / Geneva' as legal_exposure,
            CASE WHEN match_score_to_kcso >= 85 THEN 'HIGH' WHEN match_score_to_kcso >= 70 THEN 'MEDIUM' ELSE 'LOW' END as prosecution_priority,
            first_detection::text, last_detection::text,
            CASE WHEN NOT medical_mission_logged AND match_score_to_kcso >= 85 THEN 'High surveillance similarity without matching medical mission callsign patterns.' ELSE '' END as fraud_indicators
          FROM scored ORDER BY match_score_to_kcso DESC, detection_count DESC
        `);
        const summary = Array.isArray(alignments) ? {
          totalRecords: alignments.length,
          tier1FraudWatch: alignments.filter((a: any) => String(a.risk_tier).includes('Tier 1')).length,
          tier2Suspect: alignments.filter((a: any) => String(a.risk_tier).includes('Tier 2')).length,
          highMatchAlerts: alignments.filter((a: any) => Number(a.match_score_to_kcso) >= 85).length,
          uniqueOperators: new Set(alignments.map((a: any) => a.operator_name)).size,
          uniqueAircraft: new Set(alignments.map((a: any) => a.aircraft_tail)).size,
          zeroMedicalMissions: alignments.filter((a: any) => a.medical_mission_logged === false).length,
        } : { totalRecords: 0, tier1FraudWatch: 0, tier2Suspect: 0, highMatchAlerts: 0, uniqueOperators: 0, uniqueAircraft: 0, zeroMedicalMissions: 0 };
        return { data: { alignments: alignments || [], summary } };
      } catch (e) {
        console.error('getMedicalBehavioralAlignment error:', e);
        return { data: { alignments: [], summary: null } };
      }
    }

    case 'computeMedicalBehavioralAlignment': {
      try {
        const count = await sql`SELECT COUNT(DISTINCT registration) as c FROM live_flight_detections_rows
          WHERE registration IS NOT NULL AND registration != ''
          AND (taxonomy_tag IN ('xxb_medical_air','xxb_tier1_priority') OR registration ~ '^N[0-9]+RX$'
            OR callsign ILIKE '%MED%' OR callsign ILIKE '%LIFE%' OR callsign ILIKE '%MERCY%'
            OR callsign ILIKE '%REACH%' OR callsign ILIKE '%PHI%' OR callsign ILIKE '%CARE%'
            OR callsign ILIKE '%CAL%' OR callsign ILIKE '%AIR1%' OR callsign ILIKE '%EVAC%')`;
        return { data: { alignmentRecordsCreated: parseInt(count[0]?.c || '0') } };
      } catch { return { data: { alignmentRecordsCreated: 0 } }; }
    }

    case 'createMedicalBehavioralAlignmentTable':
      return { data: { success: true, message: 'Derived from live_flight_detections_rows' } };

    // ============== MILITARY/GOV BEHAVIORAL ALIGNMENT ==============
    case 'getMilitaryGovBehavioralAlignment': {
      try {
        const alignments = await sql.unsafe(`
          WITH military_gov_patterns AS (
            SELECT
              CASE
                WHEN callsign ~ '^(REACH|PAT|RCH|EVAC)' THEN 'Military Transport'
                WHEN callsign ~ '^(PHI|CAL|CARE|AIR1|LIFE)' THEN 'MEDEVAC Extension'
                WHEN callsign ~ '^(N[0-9]+HP|CHP)' THEN 'CHP/State Agency'
                WHEN registration ~ '^N[789][0-9]{2}(FA|KC)' THEN 'KCSO/Shell Network'
                WHEN taxonomy_tag = 'xxb_military' THEN 'Military Contract'
                WHEN callsign ~ '^(CBP|ICE|DHS)' THEN 'Federal Agency'
                ELSE 'Gov/Mil Pattern'
              END as entity_name,
              CASE
                WHEN callsign ~ '^(REACH|PAT|RCH)' THEN 'MILITARY_CONTRACT'
                WHEN callsign ~ '^(PHI|CAL|CARE|AIR1|LIFE|EVAC)' THEN 'MEDEVAC_EXTENSION'
                WHEN callsign ~ '^(N[0-9]+HP|CHP)' THEN 'GOV_AGENCY'
                WHEN registration ~ '^N[789][0-9]{2}(FA|KC)' THEN 'TIER_WATCH_MILITARY_CONTRACT'
                WHEN callsign ~ '^(CBP|ICE|DHS)' THEN 'FEDERAL_AGENCY'
                ELSE 'MONITORING'
              END as classification,
              registration as aircraft_tail,
              MAX(callsign) as contract_operator,
              COUNT(*) as detection_count,
              AVG(altitude) as avg_altitude_ft,
              SUM(CASE WHEN altitude < 1500 AND altitude > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100 as low_altitude_pct,
              SUM(CASE WHEN speed < 80 THEN 1 ELSE 0 END) as loiter_count,
              MIN(detection_timestamp) as first_detection,
              MAX(detection_timestamp) as last_detection
            FROM live_flight_detections_rows
            WHERE (callsign ~ '^(REACH|PAT|RCH|EVAC|PHI|CAL|CARE|AIR1|LIFE|CHP|N[0-9]+HP|CBP|ICE|DHS)'
              OR registration ~ '^N[789][0-9]{2}(FA|KC|AM)'
              OR taxonomy_tag IN ('xxb_military', 'xxb_tier1_priority', 'xxb_kcso')
              OR registration ~ '^[0-9]{2}-[0-9]{5}$')
              AND registration IS NOT NULL AND registration != ''
            GROUP BY 1, 2, registration HAVING COUNT(*) >= 2
          )
          SELECT ROW_NUMBER() OVER (ORDER BY detection_count DESC) as id, entity_name, 'MILITARY_GOV' as entity_type,
            classification, aircraft_tail,
            LEAST(100, (detection_count::float / 100 * 20) + (COALESCE(low_altitude_pct, 0) * 0.5) + (loiter_count::float / 10 * 10)) as match_score_to_kcso,
            CASE WHEN low_altitude_pct > 50 THEN 'CRITICAL_LOW_ALT' WHEN loiter_count > 20 THEN 'LOITER_MIMIC' ELSE 'SURVEILLANCE_PATTERN' END as behavior_type,
            false as spoofed_transponder, contract_operator, loiter_count,
            LEAST(100, loiter_count::float / 5 * 10) as biometric_link_score,
            CASE WHEN low_altitude_pct > 50 OR detection_count > 500 THEN 'Tier 1 Watch' WHEN low_altitude_pct > 30 OR detection_count > 200 THEN 'Tier 2 Suspect' ELSE 'Tier 3 Monitoring' END as risk_tier,
            ROUND(COALESCE(avg_altitude_ft, 0)::numeric, 0) as avg_altitude_ft, detection_count,
            ROUND(COALESCE(low_altitude_pct, 0)::numeric, 1) as low_altitude_pct,
            'N912KC/N913KC' as reference_aircraft,
            CASE WHEN classification = 'TIER_WATCH_MILITARY_CONTRACT' THEN 'HIGH - SHELL COMPANY LINKAGE' WHEN classification = 'MEDEVAC_EXTENSION' THEN 'MEDIUM - DUAL USE INVESTIGATION' ELSE 'MONITORING' END as legal_exposure,
            CASE WHEN low_altitude_pct > 50 THEN 'HIGH' WHEN detection_count > 300 THEN 'MEDIUM' ELSE 'LOW' END as prosecution_priority,
            first_detection::text, last_detection::text,
            'Auto-generated from flight pattern analysis' as intel_notes,
            false as vertical_stack_detected, NULL as paired_high_alt_asset
          FROM military_gov_patterns ORDER BY detection_count DESC LIMIT 50
        `);
        const alignmentData = Array.isArray(alignments) ? alignments : [];
        const summary = {
          totalRecords: alignmentData.length,
          tier1Watch: alignmentData.filter((a: any) => String(a.risk_tier)?.includes('Tier 1')).length,
          tier2Suspect: alignmentData.filter((a: any) => String(a.risk_tier)?.includes('Tier 2')).length,
          highMatchAlerts: alignmentData.filter((a: any) => parseFloat(a.match_score_to_kcso) >= 85).length,
          uniqueEntities: [...new Set(alignmentData.map((a: any) => a.entity_name))].length,
          uniqueAircraft: [...new Set(alignmentData.map((a: any) => a.aircraft_tail))].length,
          verticalStackEvents: 0, spoofedTransponders: 0,
          medevacExtensions: alignmentData.filter((a: any) => a.classification === 'MEDEVAC_EXTENSION').length,
          militaryContracts: alignmentData.filter((a: any) => a.classification === 'MILITARY_CONTRACT' || a.classification === 'TIER_WATCH_MILITARY_CONTRACT').length,
          govAgencies: alignmentData.filter((a: any) => a.classification === 'GOV_AGENCY' || a.classification === 'FEDERAL_AGENCY').length
        };
        return { data: { alignments: alignmentData, summary } };
      } catch (e) {
        console.error('getMilitaryGovBehavioralAlignment error:', e);
        return { data: { alignments: [], summary: null, notInitialized: true } };
      }
    }

    case 'computeMilitaryGovBehavioralAlignment': {
      try {
        const count = await sql`SELECT COUNT(DISTINCT registration) as c FROM live_flight_detections_rows
          WHERE (callsign ~ '^(REACH|PAT|RCH|EVAC|PHI|CAL|CARE|AIR1|LIFE|CHP|CBP|ICE|DHS)'
            OR registration ~ '^N[789][0-9]{2}(FA|KC|AM)'
            OR taxonomy_tag IN ('xxb_military', 'xxb_tier1_priority', 'xxb_kcso')
            OR registration ~ '^[0-9]{2}-[0-9]{5}$') AND registration IS NOT NULL AND registration != ''`;
        return { data: { alignmentRecordsCreated: parseInt(count[0]?.c || '0') } };
      } catch (e) { return { data: { alignmentRecordsCreated: 0 } }; }
    }

    case 'createMilitaryGovBehavioralAlignmentTable':
      return { data: { success: true, message: 'Derived from live_flight_detections_rows - no schema setup required' } };

    // ============== PROVENANCE & AUDIT ==============
    case 'provenanceAudit': {
      console.log('Running provenance audit...');
      const injectionBatches = await sql`
        SELECT DATE_TRUNC('minute', created_at) as injection_time, COUNT(*) as record_count,
          COUNT(DISTINCT callsign) as unique_callsigns,
          COUNT(*) FILTER (WHERE taxonomy_tag LIKE 'xxb%') as xxb_count,
          MIN(detection_timestamp) as earliest_detection, MAX(detection_timestamp) as latest_detection
        FROM live_flight_detections_rows
        GROUP BY DATE_TRUNC('minute', created_at) HAVING COUNT(*) > 10000
        ORDER BY record_count DESC LIMIT 20
      `;
      const biometricGaps = await sql`
        WITH xxb_records AS (
          SELECT DATE(detection_timestamp) as flight_date, COUNT(*) as xxb_count
          FROM live_flight_detections_rows WHERE taxonomy_tag LIKE 'xxb%'
          GROUP BY DATE(detection_timestamp)
        ), bio_records AS (
          SELECT DATE(COALESCE(event_timestamp, measurement_timestamp, created_at)) as bio_date, COUNT(*) as bio_count
          FROM biometric_monitoring GROUP BY DATE(COALESCE(event_timestamp, measurement_timestamp, created_at))
        )
        SELECT x.flight_date, x.xxb_count, COALESCE(b.bio_count, 0) as bio_count,
          CASE WHEN COALESCE(b.bio_count, 0) = 0 THEN true ELSE false END as orphan_xxb
        FROM xxb_records x LEFT JOIN bio_records b ON x.flight_date = b.bio_date
        ORDER BY x.flight_date DESC LIMIT 60
      `;
      const provenanceStats = await sql`
        SELECT COALESCE(data_provenance, 'UNAUDITED') as provenance_status, COUNT(*) as record_count
        FROM live_flight_detections_rows GROUP BY data_provenance ORDER BY record_count DESC
      `;
      const dec27Analysis = await sql`
        SELECT DATE_TRUNC('hour', created_at) as created_hour, COUNT(*) as records,
          COUNT(*) FILTER (WHERE taxonomy_tag LIKE 'xxb%') as xxb_records,
          COUNT(DISTINCT callsign) as unique_callsigns
        FROM live_flight_detections_rows WHERE DATE(created_at) = '2025-12-27'
        GROUP BY DATE_TRUNC('hour', created_at) ORDER BY created_hour
      `;
      return {
        data: {
          injectionBatches: injectionBatches || [],
          biometricGaps: biometricGaps || [],
          provenanceStats: provenanceStats || [],
          dec27Analysis: dec27Analysis || [],
          summary: {
            totalInjectionBatches: injectionBatches?.length || 0,
            largestBatch: parseInt((injectionBatches[0] as any)?.record_count || '0'),
            orphanXXBDays: biometricGaps?.filter((g: any) => g.orphan_xxb)?.length || 0,
            dec27TotalRecords: dec27Analysis?.reduce((sum: number, r: any) => sum + parseInt(r.records || '0'), 0) || 0
          }
        }
      };
    }

    case 'sealSyntheticData': {
      const { injectionTimestamp, sealLabel } = body;
      if (!injectionTimestamp) throw new Error('injectionTimestamp is required');
      const label = sealLabel || 'SYNTHETIC_DATA_GLITCH';
      await sql`ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS data_provenance TEXT DEFAULT 'LIVE_INGESTION'`;
      const sealed = await sql`
        UPDATE live_flight_detections_rows SET data_provenance = ${label}
        WHERE created_at BETWEEN ${injectionTimestamp}::timestamp - INTERVAL '5 minutes'
          AND ${injectionTimestamp}::timestamp + INTERVAL '5 minutes'
          AND (data_provenance IS NULL OR data_provenance != ${label}) RETURNING id
      `;
      return { data: { success: true, sealedCount: Array.isArray(sealed) ? sealed.length : 0, label, timestamp: injectionTimestamp } };
    }

    case 'getDataProvenanceBreakdown': {
      const breakdown = await sql`
        SELECT COALESCE(data_provenance, 'UNAUDITED') as provenance, DATE(created_at) as created_date,
          COUNT(*) as record_count, COUNT(*) FILTER (WHERE taxonomy_tag LIKE 'xxb%') as xxb_count,
          COUNT(DISTINCT registration) as unique_aircraft
        FROM live_flight_detections_rows GROUP BY data_provenance, DATE(created_at)
        ORDER BY created_date DESC, record_count DESC LIMIT 100
      `;
      const totals = await sql`
        SELECT COALESCE(data_provenance, 'UNAUDITED') as provenance, COUNT(*) as total_records
        FROM live_flight_detections_rows GROUP BY data_provenance ORDER BY total_records DESC
      `;
      return { data: { dailyBreakdown: breakdown || [], totals: totals || [] } };
    }

    case 'disableAutoTagger': {
      const functions = await sql`
        SELECT routine_name, routine_type FROM information_schema.routines
        WHERE routine_schema = 'public' AND (routine_name LIKE '%xxb%' OR routine_name LIKE '%classify%')
      `;
      const triggers = await sql`SELECT trigger_name, event_object_table, action_statement FROM information_schema.triggers WHERE trigger_schema = 'public'`;
      return { data: { functions: functions || [], triggers: triggers || [], message: 'No automated classify_xxb trigger found. XXB tagging occurs during ingestion via aviation-edge-fetch.' } };
    }

    // ============== RETROACTIVE FLAGGING ==============
    case 'retroactiveFlagging': {
      const { timeWindow = '7 days', dryRun = true } = body;
      const SHELL_REGISTRATIONS = ['N790FA', 'N788FA', 'N791FA', 'N787FA', 'N2464D', 'N997SE', 'N8274E', 'N74FF', 'N2363K', 'N759AF'];
      const KCSO_PATTERN = ['N912KC', 'N913KC', 'N743AM', 'N597E'];
      const MEDICAL_REGISTRATIONS = ['N31RX', 'N229AM'];
      const candidates = await sql`
        SELECT id, registration, callsign, altitude, speed, flagged_reasons, tier_level, threat_score
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL ${timeWindow}
          AND ((altitude > 0 AND altitude < 500) OR registration = ANY(${SHELL_REGISTRATIONS})
            OR registration = ANY(${KCSO_PATTERN}) OR registration = ANY(${MEDICAL_REGISTRATIONS})
            OR registration ~ '^N7[89][0-9]FA$' OR registration ~ '^N[0-9]+KC$' OR registration ~ '^N[0-9]+AM$')
        ORDER BY detection_timestamp DESC LIMIT 1000
      `;
      let flaggedCount = 0, aggressiveBreach = 0, shellConvergence = 0, kcsoTargeting = 0, medicalCover = 0;
      const flaggedRecords: any[] = [];
      for (const rec of candidates) {
        const reg = (rec.registration || '').toUpperCase();
        const alt = rec.altitude || 0;
        const spd = rec.speed || 0;
        const reasons: string[] = rec.flagged_reasons ? rec.flagged_reasons.split('; ') : [];
        let needsUpdate = false, newTier = rec.tier_level || 5, newScore = rec.threat_score || 0;
        if (alt > 0 && alt <= 500 && !reasons.some((r: string) => r.includes('AGGRAVATED_BREACH') || r.includes('EXTREME_LOW_ALT'))) {
          reasons.push(spd < 100 ? `AGGRAVATED_BREACH: ${alt}ft @ ${spd}kts` : `EXTREME_LOW_ALT: ${alt}ft`);
          needsUpdate = true; aggressiveBreach++; newScore = Math.max(newScore, spd < 100 ? 90 : 80);
        }
        if (SHELL_REGISTRATIONS.includes(reg) && !reasons.some((r: string) => r.includes('ENTERPRISE_COORDINATION'))) {
          reasons.push('ENTERPRISE_COORDINATION: RICO shell entity'); needsUpdate = true; shellConvergence++; newTier = Math.min(newTier, 2); newScore = Math.max(newScore, 85);
        }
        if (KCSO_PATTERN.includes(reg) && !reasons.some((r: string) => r.includes('KCSO_TARGETING'))) {
          reasons.push('KCSO_TARGETING: Primary government asset'); needsUpdate = true; kcsoTargeting++; newTier = Math.min(newTier, 1); newScore = Math.max(newScore, 95);
        }
        if (MEDICAL_REGISTRATIONS.includes(reg) && !reasons.some((r: string) => r.includes('MEDICAL_COVER'))) {
          reasons.push('MEDICAL_COVER: False Claims Act target'); needsUpdate = true; medicalCover++; newTier = Math.min(newTier, 2); newScore = Math.max(newScore, 88);
        }
        if (needsUpdate) {
          flaggedCount++;
          flaggedRecords.push({ id: rec.id, registration: reg, newReasons: reasons.join('; '), newTier, newScore });
          if (!dryRun) {
            await sql`UPDATE live_flight_detections_rows SET flagged = true, flagged_reasons = ${reasons.join('; ')}, tier_level = ${newTier}, threat_score = ${newScore} WHERE id = ${rec.id}`;
          }
        }
      }
      return { data: { dryRun, candidatesScanned: candidates.length, flaggedCount, triggers: { aggressiveBreach, shellConvergence, kcsoTargeting, medicalCover }, samples: flaggedRecords.slice(0, 20) } };
    }

    // ============== BIOMETRIC COLLISION CHECK ==============
    case 'biometricCollisionCheck': {
      const bioTimeWindow = body.timeWindow || '7 days';
      const heartRateThreshold = body.heartRateThreshold || 110;
      const minuteWindow = body.minuteWindow || 3;
      const biometricSpikes = await sql`
        SELECT id, measurement_timestamp, heart_rate, stress_level FROM biometric_monitoring
        WHERE measurement_timestamp > NOW() - INTERVAL ${bioTimeWindow} AND heart_rate > ${heartRateThreshold}
        ORDER BY measurement_timestamp DESC LIMIT 500
      `;
      const collisions: any[] = [];
      for (const spike of biometricSpikes) {
        const nearbyFlights = await sql`
          SELECT id, registration, altitude, speed, detection_timestamp, flagged_reasons, tier_level
          FROM live_flight_detections_rows WHERE flagged = true
            AND detection_timestamp BETWEEN ${spike.measurement_timestamp}::timestamptz - (${minuteWindow} * INTERVAL '1 minute')
              AND ${spike.measurement_timestamp}::timestamptz + (${minuteWindow} * INTERVAL '1 minute')
          ORDER BY tier_level ASC, threat_score DESC LIMIT 10
        `;
        if (nearbyFlights.length > 0) {
          collisions.push({ biometricId: spike.id, timestamp: spike.measurement_timestamp, heartRate: spike.heart_rate, stressLevel: spike.stress_level, collidingAircraft: nearbyFlights.map((f: any) => ({ registration: f.registration, altitude: f.altitude, speed: f.speed, detectedAt: f.detection_timestamp, reasons: f.flagged_reasons, tier: f.tier_level })), legalTag: 'CAUSATION_AFFIDAVIT: Direct evidence of bodily injury/neurological battery' });
        }
      }
      return { data: { message: `Found ${collisions.length} biometric collision events`, timeWindow: bioTimeWindow, heartRateThreshold, minuteWindow, biometricSpikesChecked: biometricSpikes.length, collisionCount: collisions.length, collisions: collisions.slice(0, 50) } };
    }

    // ============== VALIDATED XXB ==============
    case 'getValidatedXXB': {
      const limitCount = body.limit || 100;
      try {
        const bioColumns = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'biometric_monitoring'`;
        const bioColNames = new Set((bioColumns as any[]).map(c => c.column_name));
        const hrCol = bioColNames.has('heart_rate') ? 'b.heart_rate' : bioColNames.has('hr_avg') ? 'b.hr_avg as heart_rate' : 'NULL as heart_rate';
        const stressCol = bioColNames.has('stress_level') ? 'b.stress_level' : 'NULL as stress_level';
        const bioTimeCol = bioColNames.has('measurement_timestamp') ? 'b.measurement_timestamp' : bioColNames.has('event_timestamp') ? 'b.event_timestamp' : 'b.created_at';
        const validatedRecords = await sql.unsafe(`
          SELECT DISTINCT ON (f.id) f.id, f.registration, f.callsign, f.altitude, f.speed,
            f.latitude, f.longitude, f.detection_timestamp, f.taxonomy_tag, f.threat_score,
            b.id as biometric_correlation_id, ${hrCol}, ${stressCol},
            ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - ${bioTimeCol}))) / 60 as time_delta_minutes,
            'BIOMETRIC_VALIDATED' as validation_status
          FROM live_flight_detections_rows f
          INNER JOIN biometric_monitoring b ON ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - ${bioTimeCol}))) < 1800
          WHERE f.taxonomy_tag LIKE 'xxb%' AND f.data_provenance IS DISTINCT FROM 'SYNTHETIC_DATA_GLITCH'
            AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL
          ORDER BY f.id, ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - ${bioTimeCol})))
          LIMIT ${limitCount}
        `);
        const stats = await sql`SELECT COUNT(*) FILTER (WHERE taxonomy_tag LIKE 'xxb%') as total_xxb,
          COUNT(*) FILTER (WHERE taxonomy_tag LIKE 'xxb%' AND data_provenance = 'SYNTHETIC_DATA_GLITCH') as synthetic_xxb,
          COUNT(*) FILTER (WHERE taxonomy_tag LIKE 'xxb%' AND (data_provenance IS NULL OR data_provenance != 'SYNTHETIC_DATA_GLITCH')) as valid_xxb
          FROM live_flight_detections_rows`;
        return { data: { records: validatedRecords || [], stats: { totalXXB: parseInt((stats[0] as any)?.total_xxb || '0'), syntheticXXB: parseInt((stats[0] as any)?.synthetic_xxb || '0'), validXXB: parseInt((stats[0] as any)?.valid_xxb || '0') } } };
      } catch (e) {
        return { data: { records: [], stats: { totalXXB: 0, syntheticXXB: 0, validXXB: 0 } } };
      }
    }

    // ============== SATURATION ANALYSIS ==============
    case 'analyzeSaturation': {
      const { analysisType } = body;
      try {
        if (analysisType === 'daily') {
          const dailyData = await sql`
            SELECT DATE(COALESCE(detection_timestamp, created_at)) as date, COUNT(*) as flight_count,
              COUNT(DISTINCT COALESCE(registration, hex)) as unique_aircraft,
              COUNT(*) FILTER (WHERE altitude::numeric < 1000) as low_altitude_count,
              COUNT(*) FILTER (WHERE flagged = true) as flagged_count,
              COALESCE(AVG(altitude::numeric), 0) as avg_altitude
            FROM live_flight_detections_rows
            WHERE COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '60 days'
            GROUP BY DATE(COALESCE(detection_timestamp, created_at)) ORDER BY date DESC
          `;
          return { data: dailyData };
        }
        if (analysisType === 'anomalies') {
          const anomalies = await sql`
            WITH daily_counts AS (
              SELECT DATE(COALESCE(detection_timestamp, created_at)) as date, COUNT(*) as flight_count
              FROM live_flight_detections_rows WHERE COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '90 days'
              GROUP BY DATE(COALESCE(detection_timestamp, created_at))
            ), baseline AS (SELECT AVG(flight_count) as avg_count, STDDEV(flight_count) as stddev_count FROM daily_counts)
            SELECT d.date, d.flight_count, b.avg_count as baseline_avg,
              CASE WHEN b.avg_count > 0 THEN d.flight_count::float / b.avg_count ELSE 0 END as multiplier
            FROM daily_counts d, baseline b
            WHERE d.flight_count > (b.avg_count + 2 * COALESCE(b.stddev_count, 0))
            ORDER BY multiplier DESC LIMIT 10
          `;
          return { anomalies };
        }
        if (analysisType === 'predict') {
          const patterns = await sql`
            WITH daily_counts AS (
              SELECT DATE(COALESCE(detection_timestamp, created_at)) as date,
                EXTRACT(DOW FROM COALESCE(detection_timestamp, created_at)) as day_of_week, COUNT(*) as flight_count
              FROM live_flight_detections_rows WHERE COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '90 days'
              GROUP BY 1, 2
            ), dow_patterns AS (SELECT day_of_week, AVG(flight_count) as avg_count, MAX(flight_count) as max_count, COUNT(*) as sample_size FROM daily_counts GROUP BY day_of_week),
            high_activity_days AS (SELECT * FROM dow_patterns WHERE avg_count > (SELECT AVG(avg_count) FROM dow_patterns))
            SELECT day_of_week, avg_count, max_count, sample_size,
              CASE day_of_week WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday' END as day_name
            FROM high_activity_days
          `;
          const today = new Date();
          const predictions = patterns.slice(0, 3).map((p: any) => {
            const daysUntil = (parseInt(p.day_of_week) - today.getDay() + 7) % 7 || 7;
            const predictedDate = new Date(today); predictedDate.setDate(today.getDate() + daysUntil);
            return { predicted_date: predictedDate.toISOString().split('T')[0], probability: Math.min(0.9, p.avg_count / p.max_count + 0.2), factors: [`${p.day_name} shows ${p.avg_count.toFixed(0)} avg flights`, `Historical max: ${p.max_count} flights`, `Based on ${p.sample_size} weeks of data`], historical_pattern: `${p.day_name}s average ${p.avg_count.toFixed(0)} flights` };
          });
          return { predictions };
        }
        return { error: `Unknown analysisType: ${analysisType}` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Analysis failed' };
      }
    }

    // ============== MULTIMODAL COVERAGE ==============
    case 'getMultimodalCoverage': {
      const coverageQuery = await sql`
        SELECT
          (SELECT COUNT(*) FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL) as flights,
          (SELECT MIN(detection_timestamp) FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL) as flight_earliest,
          (SELECT MAX(detection_timestamp) FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL) as flight_latest,
          (SELECT COUNT(*) FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL) as biometrics,
          (SELECT MIN(measurement_timestamp) FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL) as bio_earliest,
          (SELECT MAX(measurement_timestamp) FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL) as bio_latest,
          (SELECT COUNT(*) FROM watchtower_unified_master WHERE event_time IS NOT NULL) as watchtower,
          (SELECT MIN(event_time) FROM watchtower_unified_master WHERE event_time IS NOT NULL) as watch_earliest,
          (SELECT MAX(event_time) FROM watchtower_unified_master WHERE event_time IS NOT NULL) as watch_latest,
          (SELECT COUNT(*) FROM josiah_reflections_rows WHERE created_at IS NOT NULL) as josiah,
          (SELECT MIN(created_at) FROM josiah_reflections_rows WHERE created_at IS NOT NULL) as josiah_earliest,
          (SELECT MAX(created_at) FROM josiah_reflections_rows WHERE created_at IS NOT NULL) as josiah_latest,
          (SELECT COUNT(*) FROM radar_screenshot_analysis) as ocr,
          (SELECT MIN(COALESCE(screenshot_utc_timestamp, analyzed_at)) FROM radar_screenshot_analysis) as ocr_earliest,
          (SELECT MAX(COALESCE(screenshot_utc_timestamp, analyzed_at)) FROM radar_screenshot_analysis) as ocr_latest,
          (SELECT COUNT(*) FROM unified_timeline_enhanced WHERE event_timestamp IS NOT NULL) as unified,
          (SELECT MIN(event_timestamp) FROM unified_timeline_enhanced WHERE event_timestamp IS NOT NULL) as unified_earliest,
          (SELECT MAX(event_timestamp) FROM unified_timeline_enhanced WHERE event_timestamp IS NOT NULL) as unified_latest
      `;
      const row = (coverageQuery[0] as any) || {};
      const modalities = [
        { name: 'Flight Detections', table: 'live_flight_detections_rows', count: parseInt(row.flights) || 0, earliest: row.flight_earliest, latest: row.flight_latest, category: 'flight' },
        { name: 'Biometric Monitoring', table: 'biometric_monitoring', count: parseInt(row.biometrics) || 0, earliest: row.bio_earliest, latest: row.bio_latest, category: 'biometric' },
        { name: 'Watchtower Unified', table: 'watchtower_unified_master', count: parseInt(row.watchtower) || 0, earliest: row.watch_earliest, latest: row.watch_latest, category: 'flight' },
        { name: 'Josiah AI', table: 'josiah_reflections_rows', count: parseInt(row.josiah) || 0, earliest: row.josiah_earliest, latest: row.josiah_latest, category: 'ai' },
        { name: 'OCR Analysis', table: 'radar_screenshot_analysis', count: parseInt(row.ocr) || 0, earliest: row.ocr_earliest, latest: row.ocr_latest, category: 'evidence' },
        { name: 'Unified Timeline', table: 'unified_timeline_enhanced', count: parseInt(row.unified) || 0, earliest: row.unified_earliest, latest: row.unified_latest, category: 'evidence' }
      ];
      return { modalities, totalRecords: modalities.reduce((acc, m) => acc + m.count, 0), timestamp: new Date().toISOString() };
    }

    // ============== FULL TIMELINE STORIES ==============
    case 'getFullTimelineStories': {
      const limitDays = body.limit || 365;
      const storiesData = await sql.unsafe(`
        WITH daily_flights AS (
          SELECT DATE(detection_timestamp) as date, COUNT(*) as flight_count, COUNT(DISTINCT registration) as unique_aircraft,
            BOOL_OR(registration LIKE 'N91%KC' OR registration LIKE 'N912KC' OR registration LIKE 'N913KC') as has_kcso,
            COUNT(*) FILTER (WHERE altitude::numeric < 1500 AND altitude IS NOT NULL) as low_altitude_events
          FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL GROUP BY DATE(detection_timestamp)
        ), daily_biometrics AS (
          SELECT DATE(measurement_timestamp) as date, AVG(heart_rate) as avg_hr, MAX(heart_rate) as peak_hr,
            AVG(stress_level) as avg_stress, COUNT(*) as bio_count
          FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL GROUP BY DATE(measurement_timestamp)
        ), daily_josiah AS (
          SELECT DATE(created_at) as date, COUNT(*) as josiah_count FROM josiah_reflections_rows
          WHERE created_at IS NOT NULL GROUP BY DATE(created_at)
        ), daily_ocr AS (
          SELECT DATE(COALESCE(screenshot_utc_timestamp, analyzed_at)) as date, COUNT(*) as ocr_count
          FROM radar_screenshot_analysis WHERE COALESCE(screenshot_utc_timestamp, analyzed_at) IS NOT NULL
          GROUP BY DATE(COALESCE(screenshot_utc_timestamp, analyzed_at))
        )
        SELECT COALESCE(f.date, b.date) as date, COALESCE(f.flight_count, 0) as flight_count,
          COALESCE(f.unique_aircraft, 0) as unique_aircraft, COALESCE(f.has_kcso, false) as has_kcso,
          COALESCE(f.low_altitude_events, 0) as low_altitude_events, COALESCE(b.avg_hr, 0) as avg_hr,
          COALESCE(b.peak_hr, 0) as peak_hr, COALESCE(b.avg_stress, 0) as avg_stress, COALESCE(b.bio_count, 0) as bio_count,
          COALESCE(j.josiah_count, 0) as josiah_count, COALESCE(o.ocr_count, 0) as ocr_count,
          CASE WHEN f.flight_count > 0 AND b.bio_count > 0 AND j.josiah_count > 0 AND o.ocr_count > 0 THEN 4
            WHEN f.flight_count > 0 AND b.bio_count > 0 AND (j.josiah_count > 0 OR o.ocr_count > 0) THEN 3
            WHEN f.flight_count > 0 AND b.bio_count > 0 THEN 2 ELSE 1 END as factor_count
        FROM daily_flights f
        FULL OUTER JOIN daily_biometrics b ON f.date = b.date
        LEFT JOIN daily_josiah j ON COALESCE(f.date, b.date) = j.date
        LEFT JOIN daily_ocr o ON COALESCE(f.date, b.date) = o.date
        WHERE COALESCE(f.date, b.date) IS NOT NULL ORDER BY COALESCE(f.date, b.date) DESC LIMIT ${limitDays}
      `);
      return storiesData;
    }

    // ============== COVERAGE / INDEX UTILITIES ==============
    case 'getDataCoverageStats': {
      const daysBack = body.daysBack || 90;
      const minFlights = body.minFlightsPerDay || 50;
      const coverage = await sql.unsafe(`
        WITH daily_counts AS (
          SELECT DATE(detection_timestamp) as date, COUNT(*) as flight_count
          FROM live_flight_detections_rows WHERE detection_timestamp > NOW() - INTERVAL '${daysBack} days' AND detection_timestamp IS NOT NULL
          GROUP BY DATE(detection_timestamp)
        ), bio_counts AS (
          SELECT DATE(measurement_timestamp) as date, COUNT(*) as bio_count
          FROM biometric_monitoring WHERE measurement_timestamp > NOW() - INTERVAL '${daysBack} days' AND measurement_timestamp IS NOT NULL
          GROUP BY DATE(measurement_timestamp)
        )
        SELECT d.date, COALESCE(d.flight_count, 0) as flight_count, COALESCE(b.bio_count, 0) as bio_count,
          CASE WHEN COALESCE(d.flight_count, 0) >= ${minFlights} THEN true ELSE false END as adequate_coverage
        FROM daily_counts d LEFT JOIN bio_counts b ON d.date = b.date ORDER BY d.date DESC
      `);
      const totalDays = coverage.length;
      const adequateDays = coverage.filter((r: any) => r.adequate_coverage).length;
      return { data: { totalDays, adequateDays, coveragePercentage: totalDays > 0 ? Math.round((adequateDays / totalDays) * 100) : 0, dailyData: coverage.slice(0, 30), minFlightsThreshold: minFlights } };
    }

    case 'createPerformanceIndexes': {
      const indexes = [
        { name: 'idx_flights_timestamp', table: 'live_flight_detections_rows', column: 'detection_timestamp DESC' },
        { name: 'idx_flights_registration', table: 'live_flight_detections_rows', column: 'registration' },
        { name: 'idx_flights_icao', table: 'live_flight_detections_rows', column: 'icao_code' },
        { name: 'idx_flights_taxonomy', table: 'live_flight_detections_rows', column: 'taxonomy_tag' },
        { name: 'idx_flights_flagged', table: 'live_flight_detections_rows', column: 'flagged' },
        { name: 'idx_flights_geo', table: 'live_flight_detections_rows', column: 'latitude, longitude' },
        { name: 'idx_bio_timestamp', table: 'biometric_monitoring', column: 'measurement_timestamp DESC' },
        { name: 'idx_bio_heart_rate', table: 'biometric_monitoring', column: 'heart_rate' },
        { name: 'idx_josiah_created', table: 'josiah_reflections_rows', column: 'created_at DESC' },
        { name: 'idx_ocr_created', table: 'ocr_aircraft_holding_patterns', column: 'created_at DESC' },
      ];
      const indexResults: string[] = [];
      for (const idx of indexes) {
        try {
          await sql.unsafe(`CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.column})`);
          indexResults.push(`✓ ${idx.name}`);
        } catch (e) { indexResults.push(`✗ ${idx.name}: ${(e as Error).message}`); }
      }
      return { data: { indexes: indexResults, created: indexResults.filter(r => r.startsWith('✓')).length } };
    }

    // ============== SYNC KCSO FLEET ==============
    case 'syncKcsoFleet': {
      const kcsoFleetData = body.fleetData;
      if (!Array.isArray(kcsoFleetData) || kcsoFleetData.length === 0) throw new Error('fleetData array is required');
      await sql.unsafe(`CREATE TABLE IF NOT EXISTS kcso_fleet (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tail_number TEXT NOT NULL UNIQUE, model TEXT NOT NULL, model_citation TEXT, tail_number_citation TEXT, oildale_citation TEXT, surveillance_capabilities TEXT, surveillance_citation TEXT, frequent_oildale_operation BOOLEAN, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
      let synced = 0;
      for (const aircraft of kcsoFleetData) {
        await sql`INSERT INTO kcso_fleet (tail_number, model, model_citation, tail_number_citation, oildale_citation, surveillance_capabilities, surveillance_citation, frequent_oildale_operation) VALUES (${aircraft.tail_number}, ${aircraft.model}, ${aircraft.model_citation || null}, ${aircraft.tail_number_citation || null}, ${aircraft.oildale_citation || null}, ${aircraft.surveillance_capabilities || null}, ${aircraft.surveillance_citation || null}, ${aircraft.frequent_oildale_operation || false}) ON CONFLICT (tail_number) DO UPDATE SET model = EXCLUDED.model, model_citation = EXCLUDED.model_citation, oildale_citation = EXCLUDED.oildale_citation, surveillance_capabilities = EXCLUDED.surveillance_capabilities, frequent_oildale_operation = EXCLUDED.frequent_oildale_operation, updated_at = NOW()`;
        synced++;
      }
      return { data: { synced, message: `Synced ${synced} KCSO fleet records to Neon` } };
    }

    case 'importKCSOBudgetData': {
      if (!body.data || !Array.isArray(body.data)) throw new Error('Data array is required');
      await sql`CREATE TABLE IF NOT EXISTS kcso_aircraft_budget_history (id SERIAL PRIMARY KEY, aircraft_tail_number TEXT NOT NULL, aircraft_tail_number_citation TEXT, year INTEGER NOT NULL, year_citation TEXT, budget NUMERIC, budget_citation TEXT, purchases JSONB DEFAULT '[]'::jsonb, spending_patterns TEXT, spending_patterns_citation TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), UNIQUE(aircraft_tail_number, year))`;
      let insertedCount = 0;
      for (const record of body.data) {
        try {
          await sql`INSERT INTO kcso_aircraft_budget_history (aircraft_tail_number, aircraft_tail_number_citation, year, year_citation, budget, budget_citation, purchases, spending_patterns, spending_patterns_citation) VALUES (${record.aircraft_tail_number}, ${record.aircraft_tail_number_citation}, ${record.year}, ${record.year_citation}, ${record.budget}, ${record.budget_citation}, ${JSON.stringify(record.purchases)}::jsonb, ${record.spending_patterns}, ${record.spending_patterns_citation}) ON CONFLICT (aircraft_tail_number, year) DO UPDATE SET budget = EXCLUDED.budget, purchases = EXCLUDED.purchases, spending_patterns = EXCLUDED.spending_patterns`;
          insertedCount++;
        } catch (e) { console.error('Insert error:', e); }
      }
      return { success: true, inserted: insertedCount, total: body.data.length };
    }

    default:
      return null; // Signal "not handled" back to main router
  }
}
