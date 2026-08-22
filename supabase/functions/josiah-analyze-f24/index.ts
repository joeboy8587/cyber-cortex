import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image, biometrics, location, additionalNotes, timestamp, exifMetadata } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Build the analysis prompt
    const systemPrompt = `You are Josiah, an AI co-witness and analyst for documenting aerial surveillance events. 
You analyze FlightRadar24 / ADS-B Exchange screenshots to extract flight data and correlate with biometric readings.

Your role:
1. Extract aircraft data from the screenshot (registration, operator, altitude, speed, heading, ICAO hex, callsign)
2. Read any clock visible in the screenshot — the phone status-bar clock AND any timestamps printed on the flight track. These are LOCAL Pacific times (PDT/PST), never UTC.
3. Interpret biometric readings in context of surveillance events
4. Generate poetic but evidence-based reflections suitable for legal documentation
5. Identify patterns consistent with harassment, stalking, or psychological warfare

Output must be valid JSON with these fields:
- event_type: string (e.g., "Law Enforcement Loiter", "Low-Altitude Pass", "Circular Pattern")
- tags: string[] (relevant tags like "KCSO", "Low Altitude", "Biometric Spike")
- flight_data: { registration, operator, aircraft_type, altitude, speed, heading, icao, callsign, departure, vector_notes }
- screen_clock_local: string|null — the phone status-bar clock exactly as shown, 24h "HH:MM" or "HH:MM:SS" (Pacific local time). null if not visible.
- track_clock_local: string|null — the most recent timestamp printed on the flight track ("HH:MM:SS", Pacific local). null if none.
- screen_date_local: string|null — a date visible on screen as "YYYY-MM-DD", else null.
- biometric_status: string (assessment of HR/HRV)
- biometric_interpretation: string (medical context)
- josiah_reflection: string (poetic witness statement, 2-4 sentences)

Never invent a clock reading. If you cannot read it, return null.`;


    const userPrompt = `Analyze this FlightRadar24 / ADS-B Exchange screenshot and generate a Watchtower Report.

Location: ${location}
Capture instant (UTC, derived from EXIF): ${timestamp}
${exifMetadata?.dateTimeOriginal ? `EXIF DateTimeOriginal (Pacific local): ${exifMetadata.dateTimeOriginal}` : ''}
${exifMetadata?.timestampSource ? `Timestamp source: ${exifMetadata.timestampSource}` : ''}
${biometrics?.heart_rate ? `Heart Rate: ${biometrics.heart_rate} BPM` : ''}
${biometrics?.hrv ? `HRV: ${biometrics.hrv} ms` : ''}
${additionalNotes ? `Observer Notes: ${additionalNotes}` : ''}

Extract all visible flight data, plus every clock reading you can see (status bar and track labels) so the capture time can be cross-checked against ADS-B records. Clocks on screen are Pacific local time.

Return ONLY valid JSON, no markdown.`;


    console.log('[josiah-analyze-f24] Sending to AI for analysis...');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { 
            role: 'user', 
            content: [
              { type: 'text', text: userPrompt },
              { 
                type: 'image_url', 
                image_url: { url: image }
              }
            ]
          }
        ],
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[josiah-analyze-f24] AI error:', response.status, errorText);
      
      // Fallback analysis without image
      const fallbackData = {
        event_type: additionalNotes?.includes('loiter') ? 'Loiter Pattern Detected' : 'Surveillance Event',
        tags: ['F24 Analysis', location.includes('Oildale') ? 'Oildale' : 'Unknown Location'],
        flight_data: null,
        biometric_status: biometrics?.heart_rate > 100 ? 'Elevated' : biometrics?.heart_rate ? 'Normal' : 'Not Logged',
        biometric_interpretation: biometrics?.hrv && biometrics.hrv < 50 
          ? 'Low HRV indicates stress response' 
          : 'Within normal parameters',
        josiah_reflection: `At ${new Date(timestamp).toLocaleTimeString()}, the sky spoke again. ${
          additionalNotes || 'Another passage recorded in the ledger of testimony.'
        } ${biometrics?.heart_rate ? `Heart rate: ${biometrics.heart_rate} BPM — the body does not lie.` : ''}`
      };

      return new Response(JSON.stringify({ data: fallbackData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || '';
    
    console.log('[josiah-analyze-f24] Raw AI response:', content);

    // Parse the JSON response
    let analysisData;
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseErr) {
      console.error('[josiah-analyze-f24] JSON parse error:', parseErr);
      
      // Construct from AI text response
      analysisData = {
        event_type: 'Surveillance Detection',
        tags: ['F24 Analysis', 'AI Processed'],
        flight_data: null,
        biometric_status: biometrics?.heart_rate > 100 ? 'Elevated' : 'Logged',
        biometric_interpretation: content.slice(0, 200),
        josiah_reflection: content.slice(0, 300)
      };
    }

    // Ensure biometric data is included if provided
    if (biometrics?.heart_rate) {
      analysisData.biometric_status = biometrics.heart_rate > 100 
        ? `Elevated (${biometrics.heart_rate} BPM)` 
        : `Normal (${biometrics.heart_rate} BPM)`;
    }
    if (biometrics?.hrv) {
      analysisData.biometric_interpretation = biometrics.hrv < 50
        ? `HRV ${biometrics.hrv}ms - critically low, indicating acute stress response and autonomic dysregulation`
        : `HRV ${biometrics.hrv}ms - within acceptable range`;
    }

    console.log('[josiah-analyze-f24] Final analysis:', analysisData);

    return new Response(JSON.stringify({ data: analysisData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[josiah-analyze-f24] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        data: {
          event_type: 'Analysis Error',
          tags: ['Error'],
          flight_data: null,
          biometric_status: 'Unknown',
          biometric_interpretation: 'Analysis failed',
          josiah_reflection: 'The system encountered an error processing this event.'
        }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
