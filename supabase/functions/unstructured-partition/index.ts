// Unstructured.io partitioner: documents + radar screenshots -> clean markdown text.
// Serverless API: synchronous partition.
// Platform API: async job flow — POST with a file creates a job ({ pending, job_id });
//               POST { job_id } polls and returns the result when the job finishes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  IS_PLATFORM,
  createPlatformJob,
  fetchPlatformJobResult,
  partitionWithUnstructured,
  elementsToResult,
  isImageFile,
} from "../_shared/unstructured.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();

    // TEMP probe: dump platform API responses for a job.
    if (body.probe && body.job_id) {
      const apiKey = Deno.env.get("UNSTRUCTURED_API_KEY")!;
      const base = Deno.env.get("UNSTRUCTURED_API_URL") || "";
      const headers = { "unstructured-api-key": apiKey, accept: "application/json" };
      const out: Record<string, unknown> = {};
      for (const path of [`/jobs/${body.job_id}/files`, `/jobs/${body.job_id}`]) {
        const r = await fetch(`${base}${path}`, { headers });
        out[path] = { status: r.status, body: (await r.text()).slice(0, 3000) };
      }
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Poll an existing platform job.
    if (body.job_id) {
      const r = await fetchPlatformJobResult(body.job_id);
      if (r.state === "pending") {
        return new Response(JSON.stringify({ pending: true, job_id: body.job_id, status: r.status }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (r.state === "failed") {
        return new Response(JSON.stringify({ error: `Platform job ${r.status}: ${r.detail}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { elements } = r;
      const result = elementsToResult(elements, body.filename || "upload.bin", body.mime_type, "hi_res");
      return new Response(JSON.stringify({
        success: true,
        pending: false,
        job_id: body.job_id,
        filename: body.filename,
        is_image: isImageFile(body.filename || "upload.bin", body.mime_type),
        ...result,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let bytes: Uint8Array | null = null;
    let filename = body.filename || "upload.bin";
    let mimeType: string | null = body.mime_type || null;
    let storagePath: string | null = body.storage_path || null;

    if (body.document_id) {
      const { data: doc, error } = await supabase
        .from("rag_documents").select("*").eq("id", body.document_id).single();
      if (error || !doc) throw new Error("document not found");
      filename = doc.filename;
      mimeType = doc.mime_type;
      storagePath = doc.storage_path;
    }

    if (body.file_base64) {
      bytes = b64ToBytes(body.file_base64);
    } else if (storagePath) {
      const { data: blob, error } = await supabase.storage.from("rag-uploads").download(storagePath);
      if (error || !blob) throw new Error(`download failed: ${error?.message}`);
      bytes = new Uint8Array(await blob.arrayBuffer());
    }

    if (!bytes || bytes.length === 0) throw new Error("no file bytes provided");

    // Platform API: create the async job and return immediately — the client polls.
    if (IS_PLATFORM) {
      const jobId = await createPlatformJob(bytes, filename, mimeType);
      return new Response(JSON.stringify({
        pending: true,
        job_id: jobId,
        filename,
        is_image: isImageFile(filename, mimeType),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = await partitionWithUnstructured(bytes, filename, mimeType, {
      strategy: body.strategy,
    });

    return new Response(JSON.stringify({
      success: true,
      filename,
      is_image: isImageFile(filename, mimeType),
      ...result,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[unstructured-partition]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
