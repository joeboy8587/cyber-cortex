Deno.serve(async () => {
  const k = Deno.env.get("NVIDIA_NIM_API_KEY");
  if (!k) return new Response(JSON.stringify({ error: "no key" }), { status: 500 });
  const r = await fetch("https://integrate.api.nvidia.com/v1/models", {
    headers: { Authorization: `Bearer ${k}` },
  });
  const t = await r.text();
  let ids: string[] = [];
  try {
    ids = (JSON.parse(t).data || []).map((m: { id: string }) => m.id);
  } catch { /* ignore */ }
  return new Response(JSON.stringify({ status: r.status, count: ids.length, ids: ids.slice(0, 200), raw: ids.length ? undefined : t.slice(0, 500) }), {
    headers: { "Content-Type": "application/json" },
  });
});
