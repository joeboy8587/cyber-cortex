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
                taxonomy_tag IN ('xxb_tier2_shell', 'xxb_shell', 'xxb_kcso_shell', 'xxb_tier1_priority', 'xxb_kcso', 'tier2_shell', 'tier1_priority', 'tier0_kcso')
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
                WHEN taxonomy_tag IN ('military_asset','xxb_military') THEN 'Military Contract'
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
              OR taxonomy_tag IN ('xxb_military', 'xxb_tier1_priority', 'xxb_kcso', 'military_asset', 'tier1_priority', 'tier0_kcso')
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
        const daysBack = body.daysBack || 30;
        const validatedRecords = await sql.unsafe(`
          SELECT DISTINCT ON (f.id) f.id, f.registration, f.callsign, f.altitude, f.speed,
            f.latitude, f.longitude, f.detection_timestamp, f.taxonomy_tag, f.threat_score,
            b.id as biometric_correlation_id, ${hrCol}, ${stressCol},
            ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - ${bioTimeCol}))) / 60 as time_delta_minutes,
            'BIOMETRIC_VALIDATED' as validation_status
          FROM live_flight_detections_rows f
          INNER JOIN biometric_monitoring b ON ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - ${bioTimeCol}))) < 1800
          WHERE f.detection_timestamp >= NOW() - INTERVAL '${daysBack} days'
            AND (f.taxonomy_tag IN ('tier0_kcso','tier1_priority','tier2_shell','low_alt_suspicious','military_asset','medical_air') OR f.taxonomy_tag LIKE 'xxb_%') AND f.taxonomy_tag != 'normal_traffic' AND f.data_provenance IS DISTINCT FROM 'SYNTHETIC_DATA_GLITCH'
            AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL
          ORDER BY f.id, ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - ${bioTimeCol})))
          LIMIT ${limitCount}
        `);
        const stats = await sql`SELECT COUNT(*) FILTER (WHERE taxonomy_tag LIKE 'xxb%' OR taxonomy_tag IN ('tier0_kcso','tier1_priority','tier2_shell','low_alt_suspicious','military_asset','medical_air')) as total_flagged,
          COUNT(*) FILTER (WHERE taxonomy_tag IN ('normal_traffic','xxb_live')) as total_normal,
          COUNT(*) FILTER (WHERE data_provenance = 'SYNTHETIC_DATA_GLITCH') as synthetic_count
          FROM live_flight_detections_rows WHERE detection_timestamp >= NOW() - INTERVAL '90 days'`;
        return { data: { records: validatedRecords || [], stats: { totalFlagged: parseInt((stats[0] as any)?.total_flagged || '0'), totalNormal: parseInt((stats[0] as any)?.total_normal || '0'), syntheticCount: parseInt((stats[0] as any)?.synthetic_count || '0') } } };
      } catch (e) {
        return { data: { records: [], stats: { totalXXB: 0, syntheticXXB: 0, validXXB: 0 } } };
      }
    }

    default:
      return null; // Signal "not handled" back to main router
  }
}
