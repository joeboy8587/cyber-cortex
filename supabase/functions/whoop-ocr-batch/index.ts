import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL not set");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not set");

    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, connect_timeout: 10 });
    const body = await req.json();
    const { action } = body;

    if (action === "extractFromImage") {
      // Extract biometric values from a base64-encoded WHOOP screenshot using AI vision
      const { imageBase64, filename, timestamp } = body;
      if (!imageBase64) throw new Error("imageBase64 required");

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are a precise biometric data extractor. Extract numeric values from WHOOP health app screenshots. Return ONLY a JSON object with these fields (use null if not visible):
- heart_rate: number (bpm, the large number shown on heart rate screen)
- hrv: number (ms, heart rate variability)  
- recovery_score: number (0-100%)
- strain: number (0-21 scale)
- resting_hr: number (bpm)
- respiratory_rate: number (breaths/min)
- sleep_score: number (0-100%)
- stress_level: number (0-100)
- screen_type: string (one of: "heart_rate", "recovery", "strain", "sleep", "hrv", "overview", "other")
Do NOT guess values. Only extract what is clearly visible.`
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract all biometric values from this WHOOP screenshot:" },
                { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } }
              ]
            }
          ],
          response_format: { type: "json_object" },
          max_tokens: 500,
        }),
      });

      if (!aiResp.ok) {
        const errText = await aiResp.text();
        throw new Error(`AI API error ${aiResp.status}: ${errText.slice(0, 200)}`);
      }

      const aiData = await aiResp.json();
      const extracted = JSON.parse(aiData.choices[0].message.content);

      return new Response(JSON.stringify({ 
        extracted, 
        filename, 
        timestamp,
        status: "ok" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "batchExtractAndStore") {
      // Process multiple screenshots: extract + store in whoop_biometrics
      const { images } = body; // array of { imageBase64, filename, timestamp }
      if (!images || !Array.isArray(images)) throw new Error("images array required");

      const results = [];
      for (const img of images.slice(0, 5)) { // Max 5 per batch to stay within timeout
        try {
          const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                {
                  role: "system",
                  content: `Extract biometric values from this WHOOP screenshot. Return ONLY JSON: {"heart_rate":number|null,"hrv":number|null,"recovery_score":number|null,"strain":number|null,"resting_hr":number|null,"respiratory_rate":number|null,"sleep_score":number|null,"stress_level":number|null,"screen_type":"heart_rate"|"recovery"|"strain"|"sleep"|"hrv"|"overview"|"other"}`
                },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Extract biometrics:" },
                    { type: "image_url", image_url: { url: `data:image/png;base64,${img.imageBase64}` } }
                  ]
                }
              ],
              response_format: { type: "json_object" },
              max_tokens: 300,
            }),
          });

          if (!aiResp.ok) {
            results.push({ filename: img.filename, error: `AI ${aiResp.status}` });
            continue;
          }

          const aiData = await aiResp.json();
          const extracted = JSON.parse(aiData.choices[0].message.content);

          // Update whoop_biometrics table
          if (extracted.heart_rate || extracted.hrv || extracted.recovery_score) {
            await sql`
              UPDATE whoop_biometrics SET
                resting_hr = COALESCE(${extracted.resting_hr || extracted.heart_rate}, resting_hr),
                hrv_score = COALESCE(${extracted.hrv}, hrv_score),
                recovery_score = COALESCE(${extracted.recovery_score}, recovery_score),
                strain = COALESCE(${extracted.strain}, strain),
                respiratory_rate = COALESCE(${extracted.respiratory_rate}, respiratory_rate),
                sleep_score = COALESCE(${extracted.sleep_score}, sleep_score)
              WHERE timestamp = ${img.timestamp}
            `;
          }

          // Also update biometric_screenshots_ocr if matching
          if (extracted.heart_rate || extracted.hrv || extracted.stress_level) {
            await sql`
              UPDATE biometric_screenshots_ocr SET
                heart_rate = COALESCE(${extracted.heart_rate}, heart_rate),
                hrv = COALESCE(${extracted.hrv}, hrv),
                stress_level = COALESCE(${extracted.stress_level}, stress_level),
                energy = COALESCE(${extracted.recovery_score}, energy)
              WHERE file_path ILIKE ${'%' + img.filename}
                OR best_timestamp = ${img.timestamp}
            `;
          }

          results.push({ filename: img.filename, extracted, stored: true });
        } catch (e: any) {
          results.push({ filename: img.filename, error: e.message?.slice(0, 100) });
        }

        // Small delay between AI calls
        await new Promise(r => setTimeout(r, 500));
      }

      await sql.end();
      return new Response(JSON.stringify({ results, total: images.length, processed: results.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "importMetadata") {
      // Import structured metadata from the uploaded .md files
      const { entries } = body; // array of { timestamp, hr, hrv, stress, aircraft, source }
      if (!entries) throw new Error("entries array required");

      let inserted = 0;
      for (const entry of entries) {
        // Insert or update in whoop_biometrics
        const existing = await sql`
          SELECT id FROM whoop_biometrics 
          WHERE timestamp = ${entry.timestamp}
          LIMIT 1
        `;

        if (existing.length > 0) {
          await sql`
            UPDATE whoop_biometrics SET
              resting_hr = COALESCE(${entry.hr}, resting_hr),
              hrv_score = COALESCE(${entry.hrv}, hrv_score)
            WHERE timestamp = ${entry.timestamp}
          `;
        } else {
          await sql`
            INSERT INTO whoop_biometrics (timestamp, resting_hr, hrv_score, data_quality, sha256_hash)
            VALUES (${entry.timestamp}, ${entry.hr}, ${entry.hrv}, 'verified_metadata', 
              encode(sha256(${JSON.stringify(entry)}::bytea), 'hex'))
          `;
        }
        inserted++;
      }

      await sql.end();
      return new Response(JSON.stringify({ inserted, total: entries.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
