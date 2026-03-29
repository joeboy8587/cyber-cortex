import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

export async function getDbContext(sql: ReturnType<typeof postgres>) {
  const [violations, shellCompanies, enterprise, flights, threats, flags, documents] = await Promise.all([
    sql`SELECT * FROM legal_violations_rows ORDER BY violation_date DESC LIMIT 20`.catch(() => []),
    sql`SELECT * FROM shell_company_evidence_rows ORDER BY created_at DESC LIMIT 15`.catch(() => []),
    sql`SELECT entity_name, tier, role, legal_exposure FROM criminal_enterprise_command_structure ORDER BY tier LIMIT 20`.catch(() => []),
    sql`SELECT registration, callsign, taxonomy_tag, COUNT(*) as detection_count 
        FROM live_flight_detections_rows 
        WHERE detection_timestamp > NOW() - INTERVAL '30 days'
        GROUP BY registration, callsign, taxonomy_tag 
        ORDER BY detection_count DESC LIMIT 15`.catch(() => []),
    // NEW: Sentinel learned threats
    sql`SELECT registration, threat_type, escalation_level, total_violations, avg_altitude, ai_threat_profile 
        FROM sentinel_learned_threats 
        ORDER BY escalation_level DESC, total_violations DESC LIMIT 10`.catch(() => []),
    // NEW: Active watchtower flags
    sql`SELECT flag_type, severity, registration, description, confidence_score, created_at 
        FROM watchtower_autonomous_flags 
        WHERE auto_resolved = false 
        ORDER BY created_at DESC LIMIT 10`.catch(() => []),
    // NEW: Evidence documents (summaries only to prevent token overflow)
    sql`SELECT id, title, document_type, tags, sha256_hash, file_size, 
        LEFT(content, 200) as content_preview 
        FROM evidence_documents 
        ORDER BY uploaded_at DESC LIMIT 20`.catch(() => []),
  ]);
  
  return { violations, shellCompanies, enterprise, flights, threats, flags, documents };
}

export async function getDocumentsForAgent(sql: ReturnType<typeof postgres>, tags: string[]): Promise<string> {
  if (!tags.length) return "";
  
  try {
    const docs = await sql`
      SELECT title, LEFT(content, 500) as content_snippet, tags 
      FROM evidence_documents 
      WHERE tags && ${sql.array(tags)}
      ORDER BY uploaded_at DESC 
      LIMIT 5
    `;
    
    if (!docs.length) return "";
    
    return docs.map((d: any) => 
      `### ${d.title}\nTags: ${(d.tags || []).join(', ')}\n${d.content_snippet}...`
    ).join('\n\n');
  } catch {
    return "";
  }
}
