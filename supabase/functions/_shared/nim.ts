// NVIDIA NIM (build.nvidia.com) OpenAI-compatible chat helper.
// Falls back to the Lovable AI Gateway when NVIDIA_NIM_API_KEY is absent,
// so nothing breaks before the secret is configured.

export const NIM_BASE_URL =
  Deno.env.get("NVIDIA_NIM_BASE_URL") || "https://integrate.api.nvidia.com/v1";

export const NIM_DEFAULT_MODEL =
  Deno.env.get("NVIDIA_NIM_MODEL") || "meta/llama-3.3-70b-instruct";

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
    return await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${nimKey}`,
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify({
        model: model || NIM_DEFAULT_MODEL,
        messages,
        stream,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(max_tokens !== undefined ? { max_tokens } : {}),
      }),
    });
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
