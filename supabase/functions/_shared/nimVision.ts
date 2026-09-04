// NVIDIA NIM vision helper — structured scene extraction from screenshots.
// Tries vision-capable NIM models in order, falls back to the Lovable AI
// Gateway (Gemini vision) so the pipeline never hard-fails on a missing key.

const NIM_BASE_URL =
  Deno.env.get("NVIDIA_NIM_BASE_URL") || "https://integrate.api.nvidia.com/v1";

/** Vision-capable models on build.nvidia.com, cheapest/most-available first. */
export const NIM_VISION_MODELS = [
  Deno.env.get("NVIDIA_NIM_VISION_MODEL") || "qwen/qwen2.5-vl-72b-instruct",
  "meta/llama-3.2-90b-vision-instruct",
  "microsoft/phi-3.5-vision-instruct",
].filter((m, i, a) => a.indexOf(m) === i);

export interface VisionResult {
  content: string;
  provider: "nvidia_nim" | "lovable_ai";
  model: string;
}

/**
 * Send one image + instruction and return the raw model text (expected JSON).
 * Non-streaming: this is a batch backfill job, not a live feed.
 */
export async function visionExtract(
  systemPrompt: string,
  userPrompt: string,
  imageDataUrl: string,
  maxTokens = 1200,
): Promise<VisionResult> {
  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];

  const nimKey = Deno.env.get("NVIDIA_NIM_API_KEY");
  if (nimKey) {
    for (const model of NIM_VISION_MODELS) {
      try {
        const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${nimKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            temperature: 0,
            max_tokens: maxTokens,
          }),
        });
        if (res.ok) {
          const j = await res.json();
          const content = j?.choices?.[0]?.message?.content ?? "";
          if (content) return { content, provider: "nvidia_nim", model };
        } else {
          console.error(
            `[nimVision] ${model} -> ${res.status} ${(await res.text()).slice(0, 200)}`,
          );
          // 400/404/415 => this account/model can't take images: try the next one.
          if (![400, 404, 410, 415, 429, 503, 529].includes(res.status)) break;
        }
      } catch (e) {
        console.error(`[nimVision] ${model} threw`, e);
      }
    }
  }

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) throw new Error("No vision provider configured (NVIDIA_NIM_API_KEY / LOVABLE_API_KEY)");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3.7-flash",
      messages,
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    throw new Error(`Vision fallback ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = await res.json();
  return {
    content: j?.choices?.[0]?.message?.content ?? "",
    provider: "lovable_ai",
    model: "google/gemini-3.7-flash",
  };
}

/** Tolerant JSON extraction — models sometimes wrap output in fences or prose. */
export function parseJsonLoose(raw: string): any {
  if (!raw) return null;
  let t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch { /* fallthrough */ }
    }
  }
  return null;
}
