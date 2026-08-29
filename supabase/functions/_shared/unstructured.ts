// Shared Unstructured.io partitioning helper (Serverless API).
// Turns PDFs, Office docs, HTML/email and images (OCR) into clean markdown text.

const UNSTRUCTURED_URL = (
  Deno.env.get("UNSTRUCTURED_API_URL") || "https://api.unstructuredapp.io/general/v0/general"
).replace(/\/+$/, "");
// Platform SaaS (platform-api.transform.unstructured.io) has no sync partition route;
// it processes files through the jobs API (upload -> poll -> download).
const IS_PLATFORM = /platform-api\./.test(UNSTRUCTURED_URL);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function partitionViaPlatformJobs(
  bytes: Uint8Array,
  filename: string,
  mimeType: string | null | undefined,
  apiKey: string,
  strategy: string,
): Promise<any[]> {
  const base = UNSTRUCTURED_URL;
  const isImage = isImageFile(filename, mimeType);
  // Platform templates: hi_res_partition (docs) / hi_res_and_enrichment (VLM OCR, images).
  const templateId = isImage ? "hi_res_and_enrichment" : "hi_res_partition";

  const form = new FormData();
  form.append(
    "input_files",
    new Blob([bytes], { type: mimeType || "application/octet-stream" }),
    filename,
  );
  form.append("request_data", JSON.stringify({ template_id: templateId }));

  const headers = { "unstructured-api-key": apiKey, accept: "application/json" };
  const create = await fetch(`${base}/jobs/`, { method: "POST", headers, body: form });
  if (!create.ok) {
    throw new Error(`Platform job create ${create.status}: ${(await create.text()).slice(0, 500)}`);
  }
  const job = await create.json();
  const jobId = job.id || job.job_id;
  if (!jobId) throw new Error(`Platform job create returned no id: ${JSON.stringify(job).slice(0, 300)}`);

  // Poll until finished (max ~100s to stay inside the edge budget).
  let jobInfo: any = null;
  for (let i = 0; i < 34; i++) {
    await sleep(3000);
    const st = await fetch(`${base}/jobs/${jobId}`, { headers });
    if (!st.ok) throw new Error(`Platform job poll ${st.status}`);
    jobInfo = await st.json();
    const status = (jobInfo.status || "").toUpperCase();
    if (["SCHEDULED", "IN_PROGRESS", "NEW", "PENDING", "PROCESSING"].includes(status)) continue;
    if (["COMPLETED", "FINISHED", "SUCCESS", "DONE"].includes(status)) break;
    throw new Error(`Platform job ended with status ${status}: ${JSON.stringify(jobInfo).slice(0, 300)}`);
  }

  // Output file ids come from the job details (node file metadata).
  const det = await fetch(`${base}/jobs/${jobId}/details`, { headers });
  if (!det.ok) throw new Error(`Platform job details ${det.status}`);
  const details = await det.json();
  const fileIds: string[] = [];
  const collect = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(collect);
    if (typeof v === "object") {
      if (typeof v.file_id === "string") fileIds.push(v.file_id);
      for (const val of Object.values(v)) collect(val);
    }
  };
  collect(details?.output_node_files ?? details?.node_file_metadata ?? details);

  const all: any[] = [];
  for (const fid of [...new Set(fileIds)]) {
    const dl = await fetch(`${base}/jobs/${jobId}/download?file_id=${encodeURIComponent(fid)}`, { headers });
    if (!dl.ok) continue; // skip non-element outputs (logs, manifests)
    const payload = await dl.json().catch(() => null);
    if (!payload) continue;
    if (Array.isArray(payload)) all.push(...payload.flatMap((v: any) => (Array.isArray(v) ? v : [v])));
    else for (const v of Object.values(payload)) if (Array.isArray(v)) all.push(...v);
  }
  void jobInfo;
  void strategy;
  return all;
}

export interface PartitionResult {
  text: string;
  elementCount: number;
  tableCount: number;
  byType: Record<string, number>;
  strategy: string;
  ocr: boolean;
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "tiff", "tif", "bmp", "heic"];
const OFFICE_EXT = ["docx", "doc", "pptx", "ppt", "xlsx", "xls", "odt", "rtf", "epub"];
const OTHER_EXT = ["pdf", "html", "htm", "eml", "msg", "xml"];

export function unstructuredSupports(filename: string, mimeType?: string | null): boolean {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return [...IMAGE_EXT, ...OFFICE_EXT, ...OTHER_EXT].includes(ext);
}

export function isImageFile(filename: string, mimeType?: string | null): boolean {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return (mimeType || "").toLowerCase().startsWith("image/") || IMAGE_EXT.includes(ext);
}

function elementsToMarkdown(elements: any[]): { text: string; tables: number } {
  const out: string[] = [];
  let tables = 0;
  let lastPage: number | null = null;

  for (const el of elements) {
    const type = el.type || "Text";
    const page = el.metadata?.page_number ?? null;
    if (page != null && page !== lastPage) {
      out.push(`\n\n<!-- page ${page} -->`);
      lastPage = page;
    }
    if (type === "Table") {
      tables++;
      const html = el.metadata?.text_as_html;
      out.push(html ? `\n${html}\n` : `\n${el.text || ""}\n`);
      continue;
    }
    const text = (el.text || "").trim();
    if (!text) continue;
    if (type === "Title") out.push(`\n\n## ${text}`);
    else if (type === "ListItem") out.push(`- ${text}`);
    else out.push(text);
  }

  return {
    text: out.join("\n").replace(/\n{4,}/g, "\n\n\n").trim(),
    tables,
  };
}

/** Partition a file with Unstructured. Throws on API failure. */
export async function partitionWithUnstructured(
  bytes: Uint8Array,
  filename: string,
  mimeType?: string | null,
  opts: { strategy?: string; languages?: string[] } = {},
): Promise<PartitionResult> {
  const apiKey = Deno.env.get("UNSTRUCTURED_API_KEY");
  if (!apiKey) throw new Error("UNSTRUCTURED_API_KEY is not configured");

  const image = isImageFile(filename, mimeType);
  const strategy = opts.strategy || (image ? "hi_res" : "auto");

  let elements: any[];
  if (IS_PLATFORM) {
    elements = await partitionViaPlatformJobs(bytes, filename, mimeType, apiKey, strategy);
  } else {
    const form = new FormData();
    form.append(
      "files",
      new Blob([bytes], { type: mimeType || "application/octet-stream" }),
      filename,
    );
    form.append("strategy", strategy);
    form.append("coordinates", "false");
    form.append("pdf_infer_table_structure", "true");
    form.append("unique_element_ids", "true");
    for (const lang of opts.languages || ["eng"]) form.append("languages", lang);

    const res = await fetch(UNSTRUCTURED_URL, {
      method: "POST",
      headers: { "unstructured-api-key": apiKey, accept: "application/json" },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Unstructured ${res.status}: ${body.slice(0, 500)}`);
    }

    elements = await res.json();
  }
  if (!Array.isArray(elements)) throw new Error("Unstructured returned an unexpected payload");

  const byType: Record<string, number> = {};
  for (const el of elements) byType[el.type || "Text"] = (byType[el.type || "Text"] || 0) + 1;

  const { text, tables } = elementsToMarkdown(elements);

  return {
    text: text.slice(0, 500000),
    elementCount: elements.length,
    tableCount: tables,
    byType,
    strategy,
    ocr: image || strategy === "hi_res",
  };
}
