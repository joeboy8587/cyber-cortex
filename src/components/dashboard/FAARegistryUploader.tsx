import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, FileText, CheckCircle, AlertTriangle, Loader2, Plane, X } from "lucide-react";
import { neonQuery } from "@/lib/neonQueryRetry";

interface ParsedRecord {
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

interface UploadResult {
  filename: string;
  records: ParsedRecord[];
  status: "pending" | "parsing" | "parsed" | "uploading" | "done" | "error";
  error?: string;
  crossRefs?: Array<{ registration: string; detection_count: number }>;
}

async function extractTextFromPdfBytes(bytes: Uint8Array): Promise<string> {
  const text: string[] = [];
  const raw = new TextDecoder("latin1").decode(bytes);

  // 1) Try BT...ET blocks on uncompressed content
  for (const block of raw.matchAll(/BT\s([\s\S]*?)ET/g)) {
    for (const m of block[1].matchAll(/\(([^)]*)\)\s*Tj/g)) text.push(m[1]);
    for (const m of block[1].matchAll(/\[(.*?)\]\s*TJ/gi)) {
      for (const p of m[1].matchAll(/\(([^)]*)\)/g)) text.push(p[1]);
    }
  }

  // 2) Decompress FlateDecode streams and extract text from those too
  const streamOffsets = [...raw.matchAll(/stream\r?\n/g)];
  for (const sMatch of streamOffsets) {
    const startIdx = (sMatch.index ?? 0) + sMatch[0].length;
    const endIdx = raw.indexOf("endstream", startIdx);
    if (endIdx === -1 || endIdx - startIdx > 500_000) continue;
    // Check if the owning object uses FlateDecode
    const preamble = raw.slice(Math.max(0, startIdx - 300), startIdx);
    if (!preamble.includes("FlateDecode")) continue;
    try {
      const compressed = bytes.slice(startIdx, endIdx);
      const ds = new DecompressionStream("deflate");
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const decompressed = new TextDecoder("latin1").decode(
        chunks.reduce((acc, c) => { const merged = new Uint8Array(acc.length + c.length); merged.set(acc); merged.set(c, acc.length); return merged; }, new Uint8Array())
      );
      // Extract text from decompressed BT/ET blocks
      for (const block of decompressed.matchAll(/BT\s([\s\S]*?)ET/g)) {
        for (const m of block[1].matchAll(/\(([^)]*)\)\s*Tj/g)) text.push(m[1]);
        for (const m of block[1].matchAll(/\[(.*?)\]\s*TJ/gi)) {
          for (const p of m[1].matchAll(/\(([^)]*)\)/g)) text.push(p[1]);
        }
      }
    } catch { /* decompression failed, skip */ }
  }

  // 3) Fallback: scan raw bytes for recognizable FAA patterns
  const rawScan = raw.replace(/[^\x20-\x7E\n]/g, " ").replace(/\s+/g, " ");
  const nNumFallback = rawScan.match(/N-NUMBER\s*(?:ENTERED)?:?\s*(\d+[A-Z]*)/i);
  if (nNumFallback && !text.join(" ").includes(nNumFallback[1])) {
    text.push(`N-NUMBER ENTERED: ${nNumFallback[1]}`);
  }

  return text.join(" ").replace(/\s+/g, " ");
}

function parseFAAText(text: string, filename: string): ParsedRecord[] {
  const records: ParsedRecord[] = [];

  // Try to find N-number from various FAA PDF formats
  const nMatch = text.match(/N-NUMBER\s*(?:ENTERED)?:?\s*(N?\d+[A-Z]*)/i) ||
    text.match(/N-Number\s*:?\s*(N?\d+[A-Z]*)/i) ||
    text.match(/\b(N\d{1,5}[A-Z]{0,2})\b/) ||
    text.match(/N-NUMBER\s*(?:ENTERED)?:?\s*([A-Z0-9]+)/i);
  if (!nMatch) return records;

  const nNumber = nMatch[1].startsWith("N") ? nMatch[1] : `N${nMatch[1]}`;

  const record: ParsedRecord = {
    n_number: nNumber.toUpperCase(),
    source: `faa_pdf_upload:${filename}`,
  };

  // Serial Number
  const sn = text.match(/Serial\s*Number\s*:?\s*([A-Z0-9-]+)/i);
  if (sn) record.serial_number = sn[1].trim();

  // Status
  const st = text.match(/Status\s*:?\s*(Valid|Revoked|Expired|Cancelled|Pending)/i);
  if (st) record.status = st[1];

  // Manufacturer
  const mfr = text.match(/Manufacturer\s*(?:Name)?\s*:?\s*([A-Z][A-Z\s&.-]+?)(?:\s{2,}|Model)/i);
  if (mfr) record.aircraft_manufacturer = mfr[1].trim();

  // Model
  const mdl = text.match(/Model\s*:?\s*([A-Z0-9][\w\s/.-]+?)(?:\s{2,}|Aircraft)/i);
  if (mdl) record.aircraft_model = mdl[1].trim();

  // Year
  const yr = text.match(/Year\s*(?:Mfr|Manufactured)?\s*:?\s*(\d{4})/i);
  if (yr) record.year_manufactured = parseInt(yr[1]);

  // Engine info
  const eng = text.match(/Engine\s*(?:Manufacturer)?\s*:?\s*([A-Z][A-Z\s&.-]+?)(?:\s{2,}|Model|Horsepower)/i);
  if (eng) record.engine_manufacturer = eng[1].trim();
  const engMdl = text.match(/Engine\s*Model\s*:?\s*([A-Z0-9][\w\s/.-]+?)(?:\s{2,}|Category)/i);
  if (engMdl) record.engine_model = engMdl[1].trim();

  // Registrant
  const regName = text.match(/(?:Name|Registrant)\s*:?\s*([A-Z][A-Z\s.,&'-]+(?:LLC|INC|CORP|CO|LTD|PRIVATE[^)]*)?)/i);
  if (regName) record.registrant_name = regName[1].trim();

  // Address components
  const street = text.match(/Street\s*:?\s*(.+?)(?:\s{2,}|City)/i);
  if (street) record.registrant_street = street[1].trim();
  const city = text.match(/City\s*:?\s*([A-Z][A-Z\s.-]+?)(?:\s{2,}|State|County)/i);
  if (city) record.registrant_city = city[1].trim();
  const state = text.match(/State\s*:?\s*([A-Z]{2})/i);
  if (state) record.registrant_state = state[1].toUpperCase();
  const zip = text.match(/Zip\s*(?:Code)?\s*:?\s*(\d{5}(?:-\d{4})?)/i);
  if (zip) record.registrant_zip = zip[1];

  // Mode S
  const modeS = text.match(/Mode\s*S\s*(?:Code)?\s*:?\s*(\d+)/i);
  if (modeS) {
    record.mode_s_code = modeS[1];
    try {
      record.mode_s_hex = parseInt(modeS[1], 8).toString(16).toUpperCase();
    } catch { /* ignore */ }
  }

  // Dates
  const certDate = text.match(/Certificate\s*(?:Issue)?\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (certDate) record.certificate_issue_date = certDate[1];
  const expDate = text.match(/Expiration\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (expDate) record.expiration_date = expDate[1];
  const airDate = text.match(/Airworthiness\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (airDate) record.airworthiness_date = airDate[1];

  // Classification
  const cls = text.match(/(?:Classification|Category)\s*:?\s*(Standard|Restricted|Experimental|Limited|Light\s*Sport)/i);
  if (cls) record.classification = cls[1];

  // Type
  const typeAc = text.match(/Type\s*(?:Aircraft)?\s*:?\s*(\d+\s*-\s*[A-Za-z\s]+)/i);
  if (typeAc) record.type_aircraft = typeAc[1].trim();
  const typeEng = text.match(/Type\s*Engine\s*:?\s*(\d+\s*-\s*[A-Za-z\s]+)/i);
  if (typeEng) record.type_engine = typeEng[1].trim();

  // Fractional owner
  record.fractional_owner = /fractional/i.test(text);

  // Privacy flag
  if (/49\s*USC\s*44114|PRIVATE/i.test(text)) {
    record.registrant_name = record.registrant_name || "PRIVATE (49 USC 44114)";
  }

  records.push(record);
  return records;
}

export default function FAARegistryUploader() {
  const [uploads, setUploads] = useState<UploadResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const pdfFiles = Array.from(files).filter(f => f.type === "application/pdf" || f.name.endsWith(".pdf"));
    if (!pdfFiles.length) {
      toast.error("Please upload PDF files");
      return;
    }

    setIsProcessing(true);
    const newUploads: UploadResult[] = pdfFiles.map(f => ({
      filename: f.name,
      records: [],
      status: "pending" as const,
    }));
    setUploads(prev => [...prev, ...newUploads]);

    const allRecords: ParsedRecord[] = [];

    for (let i = 0; i < pdfFiles.length; i++) {
      const file = pdfFiles[i];
      setUploads(prev => prev.map((u, idx) =>
        idx === prev.length - pdfFiles.length + i ? { ...u, status: "parsing" } : u
      ));

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const text = await extractTextFromPdfBytes(bytes);
        const records = parseFAAText(text, file.name);

        if (!records.length) {
          setUploads(prev => prev.map((u, idx) =>
            idx === prev.length - pdfFiles.length + i
              ? { ...u, status: "error", error: "No N-number found — try re-exporting the PDF" }
              : u
          ));
          continue;
        }

        allRecords.push(...records);
        setUploads(prev => prev.map((u, idx) =>
          idx === prev.length - pdfFiles.length + i
            ? { ...u, status: "parsed", records }
            : u
        ));
      } catch (err: any) {
        setUploads(prev => prev.map((u, idx) =>
          idx === prev.length - pdfFiles.length + i
            ? { ...u, status: "error", error: err.message }
            : u
        ));
      }
    }

    // Upsert all parsed records to Neon
    if (allRecords.length > 0) {
      setUploads(prev => prev.map(u => u.status === "parsed" ? { ...u, status: "uploading" } : u));

      const { data, error } = await neonQuery({
        action: "upsertFAARecords",
        records: allRecords,
      });

      if (error) {
        toast.error(`DB insert failed: ${typeof error === "string" ? error : error.message}`);
        setUploads(prev => prev.map(u => u.status === "uploading" ? { ...u, status: "error", error: "DB insert failed" } : u));
      } else {
        const crossRefs = data?.flightCrossReferences || [];
        toast.success(`Enriched ${data?.inserted || 0} aircraft records in Neon DB`);
        setUploads(prev => prev.map(u => {
          if (u.status !== "uploading") return u;
          const recCrossRefs = crossRefs.filter((cr: any) =>
            u.records.some(r => r.n_number === cr.registration)
          );
          return { ...u, status: "done", crossRefs: recCrossRefs };
        }));
      }
    }

    setIsProcessing(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
  }, [processFiles]);

  const clearResults = () => setUploads([]);

  return (
    <Card className="border-primary/30 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="font-mono text-sm uppercase tracking-wider flex items-center gap-2">
          <Plane className="h-4 w-4 text-primary" />
          FAA Registry Enrichment Pipeline
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Upload FAA Aircraft Inquiry PDFs → Auto-parse → Enrich Neon DB → Cross-reference flight detections
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
            ${isDragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
          onClick={() => document.getElementById("faa-pdf-input")?.click()}
        >
          <input
            id="faa-pdf-input"
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
          <Upload className={`h-8 w-8 mx-auto mb-2 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
          <p className="font-mono text-sm text-foreground">
            {isDragging ? "Drop FAA PDFs here" : "Drag & drop FAA Aircraft Inquiry PDFs"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            or click to browse • supports batch upload
          </p>
        </div>

        {/* Results */}
        {uploads.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Processing Results
              </h3>
              <Button variant="ghost" size="sm" onClick={clearResults} className="h-6 text-xs">
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            </div>

            {uploads.map((u, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-background/50">
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs truncate">{u.filename}</p>
                  {u.records.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {u.records.map(r => r.n_number).join(", ")}
                      {u.records[0]?.registrant_name && ` — ${u.records[0].registrant_name}`}
                    </p>
                  )}
                  {u.crossRefs && u.crossRefs.length > 0 && (
                    <p className="text-xs text-primary">
                      🔗 {u.crossRefs.map(cr => `${cr.registration}: ${cr.detection_count.toLocaleString()} detections`).join(", ")}
                    </p>
                  )}
                  {u.error && <p className="text-xs text-destructive">{u.error}</p>}
                </div>
                <div className="flex-shrink-0">
                  {u.status === "pending" && <Badge variant="secondary">Pending</Badge>}
                  {u.status === "parsing" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  {u.status === "parsed" && <Badge variant="outline" className="text-chart-4">Parsed</Badge>}
                  {u.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  {u.status === "done" && <CheckCircle className="h-4 w-4 text-chart-4" />}
                  {u.status === "error" && <AlertTriangle className="h-4 w-4 text-destructive" />}
                </div>
              </div>
            ))}
          </div>
        )}

        {isProcessing && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing and enriching database...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
