// Shared Unstructured.io partitioning helper (Serverless API).
// Turns PDFs, Office docs, HTML/email and images (OCR) into clean markdown text.

const UNSTRUCTURED_URL =
  Deno.env.get("UNSTRUCTURED_API_URL") || "https://api.unstructuredapp.io/general/v0/general";

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

  const elements = await res.json();
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
