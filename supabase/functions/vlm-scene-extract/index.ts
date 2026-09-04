// VLM scene extraction for the offline screenshot archive.
// Replaces OCR: a vision-language model returns a typed scene graph where a
// missing tail means MASKED, never "no aircraft".
//
// POST { images: [{ id, filename, image_base64|data_url }], hint_time?: string }
// -> { results: [{ id, filename, scene, provider, model, error? }] }

import { visionExtract, parseJsonLoose } from "../_shared/nimVision.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUDGET_MS = 110_000;

const SYSTEM_PROMPT = `You are a forensic screenshot scene reader for an ADS-B surveillance archive.
You are NOT an OCR engine. You understand the layout of FlightRadar24 / ADS-B Exchange
radar screens and of Welltory / WHOOP biometric screens, and you report a structured scene.

CRITICAL SEMANTICS:
- In the FR24 selected-aircraft info panel, "REG: N/A", "-", blank, or "No call sign"
  means a MASKED contact. Set "reg": null and "masked": true. NEVER report the aircraft
  as absent, and NEVER invent a registration.
- Map labels are the small tags drawn next to contacts on the map. List every one you can
  read, verbatim, including the literal string "No call sign".
- Never guess a number you cannot read. Use null.

Return ONLY valid JSON, no markdown, exactly this shape:
{
  "shot_type": "fr24" | "welltory" | "whoop" | "other",
  "status_bar_time": "HH:MM" | null,
  "on_screen_date": "YYYY-MM-DD" | null,
  "fr24_selected": {
    "reg": string|null, "callsign": string|null, "hex": string|null,
    "type": string|null, "alt_ft": number|null, "gs_kt": number|null,
    "track_deg": number|null, "squawk": string|null, "masked": boolean
  } | null,
  "fr24_map_labels": string[],
  "contact_count": number|null,
  "track_geometry": "orbit" | "loiter" | "transit" | "unknown",
  "area_hint": string|null,
  "biometrics": { "hr_bpm": number|null, "hrv_ms": number|null, "sdnn": number|null,
                  "coherence_pct": number|null, "stress": number|null,
                  "recovery_pct": number|null } | null,
  "notes": string|null
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const started = Date.now();
  try {
    const body = await req.json();
    const images: Array<any> = Array.isArray(body?.images) ? body.images : [];
    if (images.length === 0) throw new Error("images array required");

    const results: any[] = [];

    for (const img of images.slice(0, 12)) {
      if (Date.now() - started > BUDGET_MS) {
        results.push({ id: img.id, filename: img.filename, error: "BUDGET_EXCEEDED", scene: null });
        continue;
      }
      const dataUrl: string | undefined =
        img.data_url ||
        (img.image_base64
          ? img.image_base64.startsWith("data:")
            ? img.image_base64
            : `data:${img.mime_type || "image/png"};base64,${img.image_base64}`
          : undefined);

      if (!dataUrl) {
        results.push({ id: img.id, filename: img.filename, error: "no image bytes", scene: null });
        continue;
      }

      const userPrompt = [
        `Read this screenshot and return the scene JSON.`,
        img.filename ? `Filename (UNRELIABLE, do not use as a clock): ${img.filename}` : "",
        body.hint_time ? `Independent capture-time candidate (for cross-check only): ${body.hint_time}` : "",
        `Remember: "REG: N/A" / "No call sign" = masked contact, not an empty sky.`,
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const { content, provider, model } = await visionExtract(
          SYSTEM_PROMPT,
          userPrompt,
          dataUrl,
        );
        const scene = parseJsonLoose(content);
        if (!scene) throw new Error(`unparseable model output: ${content.slice(0, 160)}`);

        // Normalise the masked semantics defensively.
        if (scene.fr24_selected) {
          const s = scene.fr24_selected;
          const blank = (v: any) =>
            v === null || v === undefined || ["", "-", "n/a", "na", "no call sign", "unknown"].includes(
              String(v).trim().toLowerCase(),
            );
          if (blank(s.reg)) s.reg = null;
          if (blank(s.callsign)) s.callsign = null;
          s.masked = s.masked === true || (s.reg === null && s.callsign === null);
        }
        if (!Array.isArray(scene.fr24_map_labels)) scene.fr24_map_labels = [];
        scene.masked_contact_count = scene.fr24_map_labels.filter((l: string) =>
          /no call ?sign|^n\/?a$|^-$/i.test(String(l).trim()),
        ).length + (scene.fr24_selected?.masked ? 1 : 0);

        results.push({ id: img.id, filename: img.filename, scene, provider, model });
      } catch (e) {
        results.push({
          id: img.id,
          filename: img.filename,
          scene: null,
          error: (e as Error).message?.slice(0, 300),
        });
      }
    }

    return new Response(
      JSON.stringify({
        results,
        processed: results.length,
        submitted: images.length,
        elapsed_ms: Date.now() - started,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[vlm-scene-extract]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
