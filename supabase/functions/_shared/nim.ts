// NVIDIA NIM (build.nvidia.com) OpenAI-compatible chat helper.
// Falls back to the Lovable AI Gateway when NVIDIA_NIM_API_KEY is absent,
// so nothing breaks before the secret is configured.

export const NIM_BASE_URL =
  Deno.env.get("NVIDIA_NIM_BASE_URL") || "https://integrate.api.nvidia.com/v1";

export const NIM_DEFAULT_MODEL =
  Deno.env.get("NVIDIA_NIM_MODEL") || "deepseek-ai/deepseek-v4-pro-0813";

export const NIM_BACKUP_MODELS = [
  "deepseek-ai/deepseek-v4-flash-0731",
  "nvidia/nemotron-3-super-120b-a12b",
];



export function hasNim(): boolean {
  return !!Deno.env.get("NVIDIA_NIM_API_KEY");
}

export interface NimChatOptions {
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  /** Lovable model used when NIM is not configured */
  fallbackModel?: string;
}

/**
 * Calls NVIDIA NIM when the key exists, otherwise the Lovable AI Gateway.
 * Returns the raw fetch Response (streamable).
 */
export async function nimChat(opts: NimChatOptions): Promise<Response> {
  const nimKey = Deno.env.get("NVIDIA_NIM_API_KEY");
  const {
    messages,
    stream = true,
    temperature,
    max_tokens,
    model,
    fallbackModel = "google/gemini-2.5-flash",
  } = opts;

  if (nimKey) {
    // Try the chosen model, then the lighter sibling if NVIDIA is overloaded (503)
    // or the model is unavailable on this account (404).
    const candidates = [model || NIM_DEFAULT_MODEL, ...NIM_BACKUP_MODELS].filter(
      (m, i, a) => a.indexOf(m) === i,
    );
    let last: Response | null = null;
    for (const m of candidates) {
      const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${nimKey}`,
          "Content-Type": "application/json",
          Accept: stream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify({
          model: m,
          messages,
          stream,
          ...(temperature !== undefined ? { temperature } : {}),
          ...(max_tokens !== undefined ? { max_tokens } : {}),
        }),
      });
      if (res.ok) return res;
      last = res;
      if (![503, 529, 404, 410, 429].includes(res.status)) return res;
      console.error(`NIM model ${m} unavailable (${res.status}), trying next`);
    }
    if (last) return last;
  }



  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) {
    return new Response(
      JSON.stringify({ error: "No AI provider configured (NVIDIA_NIM_API_KEY or LOVABLE_API_KEY)" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: fallbackModel,
      messages,
      stream,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(max_tokens !== undefined ? { max_tokens } : {}),
    }),
  });
}
