const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


const NEON_URL = Deno.env.get("NEON_DATABASE_URL")!;

interface ExtractionResult {
  report_type: string;
  spoofing_flags: number;
  threat_profiles: number;
  forensic_events: number;
  chain_links: number;
  details: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { content, filename, sha256_hash, document_id } = await req.json();

    if (!content || !filename) {
      return new Response(JSON.stringify({ error: "content and filename required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const result: ExtractionResult = {
      report_type: "unknown",
      spoofing_flags: 0,
      threat_profiles: 0,
      forensic_events: 0,
      chain_links: 0,
      details: []
    };

    // Detect report type
    const upperContent = content.toUpperCase();
    const isSpoofing = upperContent.includes("SPOOFING") && upperContent.includes("EVIDENCE TAMPERING");
    const isMonitor = upperContent.includes("MONITOR") && (upperContent.includes("OVERSIGHT FAILURE") || upperContent.includes("MONITOR OVERSIGHT"));

    if (isSpoofing) {
      result.report_type = "spoofing_detection";
      await parseSpoofingReport(content, document_id, sha256_hash, result);
    } else if (isMonitor) {
      result.report_type = "monitor_failure";
      await parseMonitorReport(content, document_id, sha256_hash, result);
    } else {
      result.report_type = "unclassified";
      result.details.push("Report type not recognized — archived only");
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Ingestion error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

async function neonQuery(sql: string, params: unknown[] = []): Promise<unknown[]> {
  // Use parameterized query via Neon HTTP API
  const url = NEON_URL;
  // For simplicity, use the neon-query edge function internally
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  
  const resp = await fetch(`${supabaseUrl}/functions/v1/neon-query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseKey}`
    },
    body: JSON.stringify({ action: "customQuery", query: sql })
  });
  
  const data = await resp.json();
  return data.rows || data.data || [];
}

async function parseSpoofingReport(content: string, documentId: string, sha256: string, result: ExtractionResult) {
  // Extract report date
  const dateMatch = content.match(/\*\*Report Date:\*\*\s*(\d{4}-\d{2}-\d{2})/);
  const reportDate = dateMatch ? dateMatch[1] : new Date().toISOString().split("T")[0];

  // 1. Extract negative altitude spoofing events from the main table
  // Pattern: | **N6316D** | A844A1 | **-325 ft** ⚠️ | 2026-02-17 ... | 35.4230, -119.0396 |
  const spoofingRows = content.matchAll(
    /\|\s*\*?\*?(N\w+|[A-Z]{2,3}\d+)\*?\*?\s*\|\s*([A-F0-9]{6})\s*\|\s*\*?\*?(-?\d+)\s*ft\*?\*?/gi
  );

  const seenEvents = new Set<string>();
  
  for (const match of spoofingRows) {
    const registration = match[1];
    const icao = match[2];
    const altitude = parseInt(match[3]);
    
    if (altitude >= 0) continue; // Only negative = spoofing
    
    const dedupKey = `${registration}_${altitude}_${reportDate}`;
    if (seenEvents.has(dedupKey)) continue;
    seenEvents.add(dedupKey);

    // Extract timestamp and location from the full row
    const fullRowRegex = new RegExp(
      `\\|\\s*\\*?\\*?${registration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?\\*?\\s*\\|[^|]*\\|[^|]*${altitude}[^|]*\\|\\s*([^|]+)\\|\\s*([^|]+)\\|`,
      "i"
    );
    const fullMatch = content.match(fullRowRegex);
    const timestamp = fullMatch ? fullMatch[1].trim() : `${reportDate}T00:00:00Z`;
    const location = fullMatch ? fullMatch[2].trim() : "";

    // Parse lat/lng
    let lat: number | null = null;
    let lng: number | null = null;
    const coordMatch = location.match(/([\d.-]+),\s*([\d.-]+)/);
    if (coordMatch) {
      lat = parseFloat(coordMatch[1]);
      lng = parseFloat(coordMatch[2]);
    }

    try {
      await neonQuery(`
        INSERT INTO watchtower_autonomous_flags (
          flag_type, severity, registration, description, 
          confidence_score, source_scan_id, evidence_summary, created_at
        ) 
        SELECT 'ADS_B_SPOOFING', 'CRITICAL', '${registration}',
          'Negative altitude ${altitude}ft detected - physically impossible, indicates ADS-B spoofing. ICAO: ${icao}',
          95, '${sha256 || ""}',
          '${JSON.stringify({ altitude, icao, timestamp: timestamp.substring(0, 25), report_date: reportDate, source: "spoofing_detection_report" }).replace(/'/g, "''")}',
          '${timestamp.substring(0, 25).replace(/[^0-9T:.Z+-]/g, (c) => c === " " ? "T" : c)}'::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM watchtower_autonomous_flags 
          WHERE registration = '${registration}' 
          AND flag_type = 'ADS_B_SPOOFING' 
          AND description LIKE '%${altitude}ft%'
          AND created_at::date = '${reportDate}'::date
        )
      `);
      result.spoofing_flags++;
    } catch (e) {
      result.details.push(`Spoof flag skip: ${registration} ${altitude}ft - ${e.message}`);
    }
  }

  // 2. Extract aircraft spoofing summaries for sentinel_learned_threats
  // Pattern: - **N6316D** (ICAO: A844A1): 3 negative altitude event(s), minimum: -1000 ft
  const summaryRows = content.matchAll(
    /\*\*(\w+)\*\*\s*\(ICAO:\s*([A-F0-9]+)\):\s*(\d+)\s*negative altitude event\(s\),\s*minimum:\s*(-?\d+)\s*ft/gi
  );

  for (const match of summaryRows) {
    const registration = match[1];
    const icao = match[2];
    const violationCount = parseInt(match[3]);
    const minAltitude = parseInt(match[4]);

    try {
      await neonQuery(`
        INSERT INTO sentinel_learned_threats (
          registration, threat_type, total_violations, avg_altitude,
          escalation_level, ai_threat_profile, first_seen, last_seen
        ) VALUES (
          '${registration}', 'ADS_B_SPOOFING', ${violationCount}, ${minAltitude},
          ${violationCount >= 3 ? 3 : violationCount >= 2 ? 2 : 1},
          'ICAO ${icao}: ${violationCount} spoofing events, min altitude ${minAltitude}ft. Source: spoofing detection report ${reportDate}',
          '${reportDate}'::timestamptz, '${reportDate}'::timestamptz
        )
        ON CONFLICT (registration, threat_type) DO UPDATE SET
          total_violations = GREATEST(sentinel_learned_threats.total_violations, ${violationCount}),
          avg_altitude = LEAST(sentinel_learned_threats.avg_altitude, ${minAltitude}),
          escalation_level = GREATEST(sentinel_learned_threats.escalation_level, ${violationCount >= 3 ? 3 : violationCount >= 2 ? 2 : 1}),
          last_seen = GREATEST(sentinel_learned_threats.last_seen, '${reportDate}'::timestamptz),
          updated_at = NOW()
      `);
      result.threat_profiles++;
    } catch (e) {
      result.details.push(`Threat profile skip: ${registration} - ${e.message}`);
    }
  }

  // 3. Create evidence chain link back to source document
  if (documentId && result.spoofing_flags > 0) {
    try {
      await neonQuery(`
        INSERT INTO evidence_chain_links (
          source_table, source_id, link_type, link_confidence, linked_by, link_hash
        ) VALUES (
          'evidence_documents', '${documentId}', 'documentary', 90,
          'ingest-report-spoofing', '${sha256 || ""}'
        )
      `);
      result.chain_links++;
    } catch (e) {
      result.details.push(`Chain link skip: ${e.message}`);
    }
  }

  result.details.push(`Spoofing report ${reportDate}: ${result.spoofing_flags} flags, ${result.threat_profiles} threat profiles`);
}

async function parseMonitorReport(content: string, documentId: string, sha256: string, result: ExtractionResult) {
  // Extract report date
  const dateMatch = content.match(/\*\*Report Date:\*\*\s*(\w+\s+\d+,\s+\d{4})/);
  const reportDateStr = dateMatch ? dateMatch[1] : new Date().toISOString().split("T")[0];
  
  // Try to parse date
  let reportDate: string;
  try {
    const d = new Date(reportDateStr);
    reportDate = d.toISOString().split("T")[0];
  } catch {
    reportDate = new Date().toISOString().split("T")[0];
  }

  // 1. Extract detection summaries (N912KC/N913KC stats)
  // Pattern: | **Total Detections** | 1,324 |
  const detectionBlocks = content.matchAll(
    /###\s*[\d.]+\s*(N\d+\w*)\s*\(KCSO[^)]*\)\s*Detection Summary[\s\S]*?\n\n/gi
  );

  for (const block of detectionBlocks) {
    const registration = block[1];
    const blockText = block[0];
    
    const totalMatch = blockText.match(/Total Detections\*?\*?\s*\|\s*([\d,]+)/);
    const minAltMatch = blockText.match(/Minimum Altitude\*?\*?\s*\|\s*\*?\*?(-?\d+)\s*ft/);
    const violationMatch = blockText.match(/Altitude Violations[^|]*\|\s*(\d+)/);
    
    const totalDetections = totalMatch ? parseInt(totalMatch[1].replace(/,/g, "")) : 0;
    const minAltitude = minAltMatch ? parseInt(minAltMatch[1]) : 0;
    const violations = violationMatch ? parseInt(violationMatch[1]) : 0;

    if (totalDetections > 0) {
      try {
        await neonQuery(`
          INSERT INTO master_forensic_events (
            event_timestamp, event_type, primary_entity_id, primary_entity_type,
            summary, confidence_score, factor_count, chain_of_custody_hash
          )
          SELECT '${reportDate}'::timestamptz, 'alert', '${registration}', 'aircraft',
            'Monitor failure report: ${registration} - ${totalDetections} detections, ${violations} altitude violations (<500ft), min altitude ${minAltitude}ft. Monitors failed to detect/report these operations.',
            85, ${violations > 50 ? 4 : violations > 10 ? 3 : 2},
            '${sha256 || ""}'
          WHERE NOT EXISTS (
            SELECT 1 FROM master_forensic_events
            WHERE primary_entity_id = '${registration}'
            AND event_type = 'alert'
            AND event_timestamp::date = '${reportDate}'::date
            AND summary LIKE '%Monitor failure report%'
          )
        `);
        result.forensic_events++;
      } catch (e) {
        result.details.push(`Forensic event skip: ${registration} - ${e.message}`);
      }
    }
  }

  // 2. Extract monthly operations breakdown
  // Pattern: | July 2025 | N912KC | 1,080 | 0 ft | Peak surveillance period |
  const monthlyRows = content.matchAll(
    /\|\s*(\w+\s+\d{4})\s*\|\s*(N\d+\w*)\s*\|\s*([\d,]+)\s*\|\s*\*?\*?(-?\d+)\s*ft\*?\*?\s*\|\s*([^|]*)\|/gi
  );

  for (const match of monthlyRows) {
    const month = match[1].trim();
    const registration = match[2].trim();
    const detections = parseInt(match[3].replace(/,/g, ""));
    const minAlt = parseInt(match[4]);
    const notes = match[5].trim();

    // Only create events for significant months (>10 detections or spoofing)
    if (detections > 10 || minAlt < 0) {
      try {
        // Parse month to date
        const monthDate = new Date(`${month} 1`);
        const monthStr = monthDate.toISOString().split("T")[0];

        await neonQuery(`
          INSERT INTO master_forensic_events (
            event_timestamp, event_type, primary_entity_id, primary_entity_type,
            summary, confidence_score, factor_count, chain_of_custody_hash
          )
          SELECT '${monthStr}'::timestamptz, 'alert', '${registration}', 'aircraft',
            'Monthly ops: ${registration} - ${month}: ${detections} detections, min ${minAlt}ft. ${notes.replace(/'/g, "''")}. Monitor oversight absent.',
            80, ${minAlt < 0 ? 4 : detections > 100 ? 3 : 2},
            '${sha256 || ""}'
          WHERE NOT EXISTS (
            SELECT 1 FROM master_forensic_events
            WHERE primary_entity_id = '${registration}'
            AND event_timestamp::date = '${monthStr}'::date
            AND summary LIKE '%Monthly ops%${month}%'
          )
        `);
        result.forensic_events++;
      } catch (e) {
        result.details.push(`Monthly event skip: ${registration} ${month} - ${e.message}`);
      }
    }
  }

  // 3. Extract key monitor failure facts as a single forensic event
  const paymentMatch = content.match(/\$(\d[\d,]*)\+?\s*(initial deposit|in County funds|taxpayer)/i);
  const ghostingMatch = content.match(/(\d+)\+?\s*days?\s*unresponsive/i);
  const totalOps = content.match(/Total Detections[^\d]*(\d[\d,]*)/);

  if (paymentMatch || ghostingMatch) {
    const payment = paymentMatch ? paymentMatch[1] : "unknown";
    const ghostDays = ghostingMatch ? ghostingMatch[1] : "unknown";
    const ops = totalOps ? totalOps[1] : "unknown";

    try {
      await neonQuery(`
        INSERT INTO master_forensic_events (
          event_timestamp, event_type, primary_entity_id, primary_entity_type,
          summary, confidence_score, bradford_hill_score, factor_count, chain_of_custody_hash
        )
        SELECT '${reportDate}'::timestamptz, 'legal', 'KCSO_MONITORS', 'agency',
          'Consent decree monitor failure: $${payment} payment, ${ghostDays} days unresponsive, ${ops} KCSO operations undetected. Monitors: Gerald Wolf / Matthew Brann. Source: ${reportDate} report.',
          95, 7.5, 5,
          '${sha256 || ""}'
        WHERE NOT EXISTS (
          SELECT 1 FROM master_forensic_events
          WHERE primary_entity_id = 'KCSO_MONITORS'
          AND event_type = 'legal'
          AND event_timestamp::date = '${reportDate}'::date
        )
      `);
      result.forensic_events++;
    } catch (e) {
      result.details.push(`Monitor failure event skip: ${e.message}`);
    }
  }

  // 4. Evidence chain link
  if (documentId && result.forensic_events > 0) {
    try {
      await neonQuery(`
        INSERT INTO evidence_chain_links (
          source_table, source_id, link_type, link_confidence, linked_by, link_hash
        ) VALUES (
          'evidence_documents', '${documentId}', 'documentary', 90,
          'ingest-report-monitor', '${sha256 || ""}'
        )
      `);
      result.chain_links++;
    } catch (e) {
      result.details.push(`Chain link skip: ${e.message}`);
    }
  }

  result.details.push(`Monitor failure report ${reportDate}: ${result.forensic_events} forensic events`);
}
