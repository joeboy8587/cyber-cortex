import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Extraction patterns for legal documents
const PATTERNS = {
  aircraft: /\bN\d{1,5}[A-Z]{0,2}\b/g,
  uscCitation: /\b(\d+)\s*U\.?S\.?C\.?\s*[§]?\s*(\d+)/gi,
  cfrCitation: /\b(\d+)\s*C\.?F\.?R\.?\s*[§]?\s*(\d+)/gi,
  dollarAmount: /\$[\d,]+(?:\.\d{2})?[MBK]?/g,
  dateISO: /\d{4}-\d{2}-\d{2}/g,
  dateWritten: /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi,
  exhibitNumber: /EXHIBIT\s+[A-Z0-9]+/gi,
};

// Known entities from criminal enterprise structure
const KNOWN_ENTITIES = [
  'KCSO', 'Kern County Sheriff', 'Sheriff Youngblood', 'Donny Youngblood',
  'ALF IX LLC', 'AERO EQUITIES LLC', 'AERO EQUITIES', 'CHRISTIANSEN AVIATION',
  'Air Methods', 'Mercy Air', 'XING KONG AVIATION',
  'AE Industrial Partners', 'Redwire Corporation',
  'US Navy', 'USAF', 'Point Mugu', 'Edwards AFB',
  'Joseph Brann', 'Brann & Associates',
  'FAA', 'DOJ', 'FBI'
];

interface ExtractionResult {
  aircraft: string[];
  legalCitations: { type: string; title: string; section: string; raw: string }[];
  dollarAmounts: string[];
  dates: { raw: string; parsed: string | null }[];
  entities: { name: string; confidence: number }[];
  exhibits: string[];
  wordCount: number;
  sectionHeadings: string[];
}

function extractFromContent(content: string): ExtractionResult {
  // Extract aircraft N-numbers
  const aircraftMatches = content.match(PATTERNS.aircraft) || [];
  const aircraft = [...new Set(aircraftMatches)];

  // Extract legal citations
  const legalCitations: ExtractionResult['legalCitations'] = [];
  
  let uscMatch;
  const uscRegex = /\b(\d+)\s*U\.?S\.?C\.?\s*[§]?\s*(\d+)/gi;
  while ((uscMatch = uscRegex.exec(content)) !== null) {
    legalCitations.push({
      type: 'USC',
      title: uscMatch[1],
      section: uscMatch[2],
      raw: uscMatch[0]
    });
  }

  let cfrMatch;
  const cfrRegex = /\b(\d+)\s*C\.?F\.?R\.?\s*[§]?\s*(\d+)/gi;
  while ((cfrMatch = cfrRegex.exec(content)) !== null) {
    legalCitations.push({
      type: 'CFR',
      title: cfrMatch[1],
      section: cfrMatch[2],
      raw: cfrMatch[0]
    });
  }

  // Extract dollar amounts
  const dollarMatches = content.match(PATTERNS.dollarAmount) || [];
  const dollarAmounts = [...new Set(dollarMatches)];

  // Extract dates
  const dates: ExtractionResult['dates'] = [];
  const isoMatches = content.match(PATTERNS.dateISO) || [];
  isoMatches.forEach(d => dates.push({ raw: d, parsed: d }));
  
  const writtenMatches = content.match(PATTERNS.dateWritten) || [];
  writtenMatches.forEach(d => {
    try {
      const parsed = new Date(d).toISOString().split('T')[0];
      dates.push({ raw: d, parsed });
    } catch {
      dates.push({ raw: d, parsed: null });
    }
  });

  // Extract entities
  const entities: ExtractionResult['entities'] = [];
  const contentUpper = content.toUpperCase();
  KNOWN_ENTITIES.forEach(entity => {
    if (contentUpper.includes(entity.toUpperCase())) {
      // Count occurrences for confidence
      const regex = new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = content.match(regex) || [];
      entities.push({
        name: entity,
        confidence: Math.min(matches.length * 10, 100)
      });
    }
  });

  // Extract exhibit numbers
  const exhibitMatches = content.match(PATTERNS.exhibitNumber) || [];
  const exhibits = [...new Set(exhibitMatches)];

  // Extract section headings (## or ### lines)
  const headingMatches = content.match(/^#{1,3}\s+.+$/gm) || [];
  const sectionHeadings = headingMatches.map(h => h.replace(/^#+\s+/, ''));

  // Word count
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

  return {
    aircraft,
    legalCitations: [...new Map(legalCitations.map(c => [c.raw, c])).values()],
    dollarAmounts,
    dates: [...new Map(dates.map(d => [d.raw, d])).values()],
    entities: entities.sort((a, b) => b.confidence - a.confidence),
    exhibits,
    wordCount,
    sectionHeadings
  };
}

async function computeSHA256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function crossLinkWithNeonDB(
  pool: Pool,
  extractions: ExtractionResult
): Promise<{
  aircraftMatches: number;
  entityMatches: number;
  flightCorrelations: number;
}> {
  const client = await pool.connect();
  let aircraftMatches = 0;
  let entityMatches = 0;
  let flightCorrelations = 0;

  try {
    // Check aircraft against live_flight_detections_rows
    if (extractions.aircraft.length > 0) {
      const aircraftResult = await client.queryObject`
        SELECT DISTINCT registration, COUNT(*) as detection_count
        FROM live_flight_detections_rows
        WHERE registration = ANY(${extractions.aircraft})
        GROUP BY registration
      `;
      aircraftMatches = aircraftResult.rows.length;
      flightCorrelations = aircraftResult.rows.reduce((sum: number, r: any) => sum + parseInt(r.detection_count), 0);
    }

    // Check entities against criminal_enterprise_command_structure
    if (extractions.entities.length > 0) {
      const entityNames = extractions.entities.map(e => e.name);
      const entityResult = await client.queryObject`
        SELECT entity_name
        FROM criminal_enterprise_command_structure
        WHERE entity_name = ANY(${entityNames})
           OR entity_name ILIKE ANY(${entityNames.map(n => '%' + n + '%')})
      `;
      entityMatches = entityResult.rows.length;
    }
  } finally {
    client.release();
  }

  return { aircraftMatches, entityMatches, flightCorrelations };
}

async function storeExtractions(
  pool: Pool,
  documentHash: string,
  filename: string,
  extractions: ExtractionResult,
  content: string
): Promise<void> {
  const client = await pool.connect();
  
  try {
    // Check if legal_intel_extractions table exists, create if not
    await client.queryObject`
      CREATE TABLE IF NOT EXISTS legal_intel_extractions (
        id SERIAL PRIMARY KEY,
        document_hash TEXT NOT NULL,
        filename TEXT NOT NULL,
        extracted_aircraft TEXT[],
        extracted_citations JSONB,
        extracted_entities JSONB,
        extracted_dates JSONB,
        extracted_amounts TEXT[],
        extracted_exhibits TEXT[],
        section_headings TEXT[],
        word_count INTEGER,
        content_preview TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(document_hash)
      )
    `;

    // Insert or update extraction
    await client.queryObject`
      INSERT INTO legal_intel_extractions (
        document_hash, filename, extracted_aircraft, extracted_citations,
        extracted_entities, extracted_dates, extracted_amounts,
        extracted_exhibits, section_headings, word_count, content_preview
      ) VALUES (
        ${documentHash},
        ${filename},
        ${extractions.aircraft},
        ${JSON.stringify(extractions.legalCitations)},
        ${JSON.stringify(extractions.entities)},
        ${JSON.stringify(extractions.dates)},
        ${extractions.dollarAmounts},
        ${extractions.exhibits},
        ${extractions.sectionHeadings},
        ${extractions.wordCount},
        ${content.substring(0, 1000)}
      )
      ON CONFLICT (document_hash) DO UPDATE SET
        filename = EXCLUDED.filename,
        extracted_aircraft = EXCLUDED.extracted_aircraft,
        extracted_citations = EXCLUDED.extracted_citations,
        extracted_entities = EXCLUDED.extracted_entities,
        extracted_dates = EXCLUDED.extracted_dates,
        extracted_amounts = EXCLUDED.extracted_amounts,
        extracted_exhibits = EXCLUDED.extracted_exhibits,
        section_headings = EXCLUDED.section_headings,
        word_count = EXCLUDED.word_count,
        content_preview = EXCLUDED.content_preview
    `;
  } finally {
    client.release();
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, content, filename } = await req.json();
    
    const neonUrl = Deno.env.get('NEON_DATABASE_URL');
    if (!neonUrl) {
      throw new Error('NEON_DATABASE_URL not configured');
    }

    const pool = new Pool(neonUrl, 3, true);

    if (action === 'parse') {
      // Parse content and extract entities
      const extractions = extractFromContent(content);
      const documentHash = await computeSHA256(content);

      // Cross-link with existing NeonDB data
      const crossLinks = await crossLinkWithNeonDB(pool, extractions);

      return new Response(JSON.stringify({
        success: true,
        documentHash,
        extractions,
        crossLinks,
        summary: {
          aircraftFound: extractions.aircraft.length,
          citationsFound: extractions.legalCitations.length,
          entitiesFound: extractions.entities.length,
          datesFound: extractions.dates.length,
          amountsFound: extractions.dollarAmounts.length,
          exhibitsFound: extractions.exhibits.length,
          existingAircraftMatches: crossLinks.aircraftMatches,
          existingEntityMatches: crossLinks.entityMatches,
          flightCorrelations: crossLinks.flightCorrelations
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'enrich') {
      // Parse, extract, and store in NeonDB
      const extractions = extractFromContent(content);
      const documentHash = await computeSHA256(content);

      await storeExtractions(pool, documentHash, filename || 'unknown.md', extractions, content);
      const crossLinks = await crossLinkWithNeonDB(pool, extractions);

      return new Response(JSON.stringify({
        success: true,
        message: 'Document parsed and stored in NeonDB',
        documentHash,
        extractions,
        crossLinks
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'listExtractions') {
      const client = await pool.connect();
      try {
        const result = await client.queryObject`
          SELECT * FROM legal_intel_extractions
          ORDER BY created_at DESC
          LIMIT 50
        `;
        return new Response(JSON.stringify({
          success: true,
          extractions: result.rows
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } finally {
        client.release();
      }
    }

    return new Response(JSON.stringify({
      error: 'Unknown action. Use: parse, enrich, or listExtractions'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Legal intel parser error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
