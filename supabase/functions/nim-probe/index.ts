Deno.serve(async (req) => {
  const k = Deno.env.get("NVIDIA_NIM_API_KEY");
  if (!k) return new Response(JSON.stringify({ error: "no key" }), { status: 500 });
  const url = new URL(req.url);
  const models = (url.searchParams.get("models") || "").split(",").filter(Boolean);
  if (!models.length) {
    const r = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: { Authorization: `Bearer ${k}` },
    });
    const t = await r.text();
    let ids: string[] = [];
    try { ids = (JSON.parse(t).data || []).map((m: { id: string }) => m.id); } catch { /* ignore */ }
    return new Response(JSON.stringify({ status: r.status, ids }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  const out: Record<string, string> = {};
  for (const m of models) {
    const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: m, messages: [{ role: "user", content: "Say OK." }], max_tokens: 16 }),
    });
    out[m] = `${r.status} ${(await r.text()).slice(0, 200)}`;
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
