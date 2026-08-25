// Unstructured.io partitioner: documents + radar screenshots -> clean markdown text.
// Accepts { document_id } | { storage_path, filename, mime_type } | { file_base64, filename, mime_type }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { partitionWithUnstructured, isImageFile } from "../_shared/unstructured.ts";

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
