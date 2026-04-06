export interface ParsedRecord {
  n_number: string;
  serial_number?: string;
  status?: string;
  aircraft_manufacturer?: string;
  aircraft_model?: string;
  type_aircraft?: string;
  type_engine?: string;
  mode_s_code?: string;
  mode_s_hex?: string;
  year_manufactured?: number;
  registrant_type?: string;
  registrant_name?: string;
  registrant_street?: string;
  registrant_city?: string;
  registrant_state?: string;
  registrant_zip?: string;
  registrant_country?: string;
  engine_manufacturer?: string;
  engine_model?: string;
  classification?: string;
  certificate_issue_date?: string;
  expiration_date?: string;
  airworthiness_date?: string;
  fractional_owner?: boolean;
  source?: string;
}

const FAA_FIELD_BOUNDARY_PATTERN = [
  "N[-\\s]*NUMBER(?:\\s+ENTERED)?",
  "Serial Number",
  "Status",
  "Manufacturer Name",
  "Certificate Issue Date",
  "Model",
  "Expiration Date",
  "Type Aircraft",
  "Type Engine",
  "Pending Number Change",
  "Dealer",
  "Date Change Authorized",
  "Mode S Code \\(base 8 \\/ Oct\\)",
  "Mode S Code \\(Base 16 \\/ Hex\\)",
  "MFR Year",
  "Type Registration",
  "Fractional Owner",
  "REGISTERED OWNER",
  "Name",
  "Street",
  "City",
  "State",
  "County",
  "Zip Code",
  "Country",
  "AIRWORTHINESS",
  "Type Certificate Data Sheet",
  "Type Certificate Holder",
  "Engine Manufacturer",
  "Classification",
  "Engine Model",
  "Category",
  "A\\/W Date",
  "Airworthiness Date",
].join("|");

const MIN_NATIVE_TEXT_LENGTH = 120;
const MIN_NATIVE_TEXT_LETTERS = 30;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeNNumber(value: string) {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.startsWith("N") ? cleaned : `N${cleaned}`;
}

function extractSection(text: string, startLabel: string, endLabel: string) {
  const regex = new RegExp(`${startLabel}\s*(.+?)(?=\s+${endLabel}\b|$)`, "i");
  const match = text.match(regex);
  return match?.[1] ? normalizeWhitespace(match[1]) : "";
}

function hasGoodExtractionQuality(text: string) {
  const normalized = normalizeWhitespace(text);
  const letterCount = (normalized.match(/[A-Z]/gi) || []).length;
  const hasNNumber = /N[-\s]*NUMBER\s*(?:ENTERED)?:?\s*(?:N\s*)?\d{1,5}[A-Z]{0,2}/i.test(normalized);
  return hasNNumber || (normalized.length >= MIN_NATIVE_TEXT_LENGTH && letterCount >= MIN_NATIVE_TEXT_LETTERS);
}

function extractField(text: string, labelPattern: string): string | undefined {
  const regex = new RegExp(
    `${labelPattern}\\s*:?\\s*(.+?)(?=\\s+(?:${FAA_FIELD_BOUNDARY_PATTERN})\\s*:?\\s|$)`,
    "i"
  );
  const match = text.match(regex);
  if (!match?.[1]) return undefined;
  const value = normalizeWhitespace(match[1]);
  return value && value !== "None" ? value : undefined;
}

async function extractTextWithPdfJs(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url
    ).toString();
  }

  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    stopAtErrors: false,
    useWorkerFetch: false,
  } as any);

  const pdf = await loadingTask.promise;

  try {
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = (content.items as Array<{ str?: string }>)
        .map((item) => item.str ?? "")
        .join(" ");

      if (pageText.trim()) pageTexts.push(pageText);
    }

    return normalizeWhitespace(pageTexts.join(" "));
  } finally {
    await pdf.destroy();
  }
}

async function extractTextFromRawPdf(bytes: Uint8Array): Promise<string> {
  const text: string[] = [];
  const raw = new TextDecoder("latin1").decode(bytes);

  for (const block of raw.matchAll(/BT\s([\s\S]*?)ET/g)) {
    for (const match of block[1].matchAll(/\(([^)]*)\)\s*Tj/g)) text.push(match[1]);
    for (const match of block[1].matchAll(/\[(.*?)\]\s*TJ/gi)) {
      for (const part of match[1].matchAll(/\(([^)]*)\)/g)) text.push(part[1]);
    }
  }

  if (typeof DecompressionStream !== "undefined") {
    const streamOffsets = [...raw.matchAll(/stream\r?\n/g)];
    for (const streamMatch of streamOffsets) {
      const startIdx = (streamMatch.index ?? 0) + streamMatch[0].length;
      const endIdx = raw.indexOf("endstream", startIdx);
      if (endIdx === -1 || endIdx - startIdx > 500_000) continue;

      const preamble = raw.slice(Math.max(0, startIdx - 300), startIdx);
      if (!preamble.includes("FlateDecode")) continue;

      try {
        const compressed = bytes.slice(startIdx, endIdx);
        const ds = new DecompressionStream("deflate");
        const writer = ds.writable.getWriter();
        await writer.write(compressed);
        await writer.close();

        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }

        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        const decompressed = new TextDecoder("latin1").decode(merged);
        for (const block of decompressed.matchAll(/BT\s([\s\S]*?)ET/g)) {
          for (const match of block[1].matchAll(/\(([^)]*)\)\s*Tj/g)) text.push(match[1]);
          for (const match of block[1].matchAll(/\[(.*?)\]\s*TJ/gi)) {
            for (const part of match[1].matchAll(/\(([^)]*)\)/g)) text.push(part[1]);
          }
        }
      } catch {
        // Ignore malformed compressed streams and keep scanning.
      }
    }
  }

  const rawScan = normalizeWhitespace(raw.replace(/[^\x20-\x7E\n]/g, " "));
  const nNumFallback = rawScan.match(/N[-\s]*NUMBER\s*(?:ENTERED)?:?\s*(\d+[A-Z]*)/i);
  if (nNumFallback && !text.join(" ").includes(nNumFallback[1])) {
    text.push(`N-NUMBER ENTERED: ${nNumFallback[1]}`);
  }

  return normalizeWhitespace(text.join(" "));
}

export async function extractTextFromPdfBytes(bytes: Uint8Array): Promise<string> {
  try {
    const pdfJsText = await extractTextWithPdfJs(bytes);
    if (hasGoodExtractionQuality(pdfJsText)) return pdfJsText;
  } catch {
    // Fall back to lower-level extraction for PDFs with unusual structures.
  }

  return extractTextFromRawPdf(bytes);
}

export function parseFAAText(text: string, filename: string): ParsedRecord[] {
  const normalizedText = normalizeWhitespace(text);
  const ownerSection = extractSection(normalizedText, "REGISTERED OWNER", "AIRWORTHINESS");
  const airworthinessSection = extractSection(normalizedText, "AIRWORTHINESS", "4\/5\/26|https?:\/\/|$") || normalizedText;
  const nMatch =
    normalizedText.match(/N[-\s]*NUMBER\s*(?:ENTERED)?:?\s*(N?\s*\d{1,5}[A-Z]{0,2})/i) ||
    normalizedText.match(/N-Number\s*:?\s*(N?\s*\d{1,5}[A-Z]{0,2})/i) ||
    normalizedText.match(/\b(N\d{1,5}[A-Z]{0,2})\b/i);

  if (!nMatch) return [];

  const record: ParsedRecord = {
    n_number: normalizeNNumber(nMatch[1]),
    source: `faa_pdf_upload:${filename}`,
  };

  record.serial_number = extractField(normalizedText, "Serial Number") || normalizedText.match(/Serial\s*Number\s*:?\s*([A-Z0-9-]+)/i)?.[1]?.trim();
  record.status = extractField(normalizedText, "Status") || normalizedText.match(/Status\s*:?\s*(Valid|Revoked|Expired|Cancelled|Pending)/i)?.[1];
  record.aircraft_manufacturer = extractField(normalizedText, "Manufacturer Name") || normalizedText.match(/Manufacturer\s*(?:Name)?\s*:?\s*([A-Z][A-Z\s&.-]+?)(?:\s{2,}|Model)/i)?.[1]?.trim();
  record.aircraft_model = extractField(normalizedText, "Model") || normalizedText.match(/Model\s*:?\s*([A-Z0-9][\w\s/.-]+?)(?:\s{2,}|Aircraft)/i)?.[1]?.trim();
  record.type_aircraft = extractField(normalizedText, "Type Aircraft") || normalizedText.match(/Type\s*(?:Aircraft)?\s*:?\s*(\d+\s*-\s*[A-Za-z\s]+)/i)?.[1]?.trim();
  record.type_engine = extractField(normalizedText, "Type Engine") || normalizedText.match(/Type\s*Engine\s*:?\s*(\d+\s*-\s*[A-Za-z\s]+)/i)?.[1]?.trim();
  record.mode_s_code = extractField(normalizedText, "Mode S Code \\(base 8 \\/ Oct\\)") || normalizedText.match(/Mode\s*S\s*(?:Code)?\s*:?\s*(\d+)/i)?.[1];
  record.mode_s_hex = extractField(normalizedText, "Mode S Code \\(Base 16 \\/ Hex\\)");
  record.registrant_type = extractField(normalizedText, "Type Registration");
  record.registrant_name = extractField(ownerSection, "Name") || normalizedText.match(/(?:Name|Registrant)\s*:?\s*([A-Z][A-Z\s.,&'-]+(?:LLC|INC|CORP|CO|LTD|PRIVATE[^)]*)?)/i)?.[1]?.trim();
  record.registrant_street = extractField(ownerSection, "Street") || normalizedText.match(/Street\s*:?\s*(.+?)(?:\s{2,}|City)/i)?.[1]?.trim();
  record.registrant_city = extractField(ownerSection, "City") || normalizedText.match(/City\s*:?\s*([A-Z][A-Z\s.-]+?)(?:\s{2,}|State|County)/i)?.[1]?.trim();
  record.registrant_state = extractField(ownerSection, "State") || normalizedText.match(/State\s*:?\s*([A-Z]{2})/i)?.[1]?.toUpperCase();
  record.registrant_zip = extractField(ownerSection, "Zip Code") || normalizedText.match(/Zip\s*(?:Code)?\s*:?\s*(\d{5}(?:-\d{4})?)/i)?.[1];
  record.registrant_country = extractField(ownerSection, "Country");
  record.engine_manufacturer = extractField(normalizedText, "Engine Manufacturer") || normalizedText.match(/Engine\s*(?:Manufacturer)?\s*:?\s*([A-Z][A-Z\s&.-]+?)(?:\s{2,}|Model|Horsepower)/i)?.[1]?.trim();
  record.engine_model = extractField(normalizedText, "Engine Model") || normalizedText.match(/Engine\s*Model\s*:?\s*([A-Z0-9][\w\s/.-]+?)(?:\s{2,}|Category)/i)?.[1]?.trim();
  record.classification = extractField(normalizedText, "Classification") || normalizedText.match(/(?:Classification|Category)\s*:?\s*(Standard|Restricted|Experimental|Limited|Light\s*Sport|Normal)/i)?.[1];
  record.certificate_issue_date = extractField(normalizedText, "Certificate Issue Date") || normalizedText.match(/Certificate\s*(?:Issue)?\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1];
  record.expiration_date = extractField(normalizedText, "Expiration Date") || normalizedText.match(/Expiration\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1];
  record.airworthiness_date = extractField(airworthinessSection, "A\\/W Date") || extractField(airworthinessSection, "Airworthiness Date") || normalizedText.match(/(?:Airworthiness|A\/W)\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1];

  const year = extractField(normalizedText, "MFR Year") || normalizedText.match(/Year\s*(?:Mfr|Manufactured)?\s*:?\s*(\d{4})/i)?.[1];
  if (year) record.year_manufactured = Number.parseInt(year, 10);

  const fractionalOwner = extractField(normalizedText, "Fractional Owner");
  if (fractionalOwner) {
    record.fractional_owner = /^(yes|y|true)$/i.test(fractionalOwner);
  } else {
    record.fractional_owner = /fractional/i.test(normalizedText);
  }

  if (!record.mode_s_hex && record.mode_s_code) {
    try {
      record.mode_s_hex = Number.parseInt(record.mode_s_code, 8).toString(16).toUpperCase();
    } catch {
      // Ignore conversion issues and preserve any parsed values.
    }
  }

  if (/49\s*USC\s*44114|PRIVATE/i.test(normalizedText)) {
    record.registrant_name = record.registrant_name || "PRIVATE (49 USC 44114)";
  }

  return [record];
}