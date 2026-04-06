import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, FileText, CheckCircle, AlertTriangle, Loader2, Plane, X } from "lucide-react";
import { neonQuery } from "@/lib/neonQueryRetry";
import { extractTextFromPdfBytes, parseFAAText, type ParsedRecord } from "@/lib/parsers/faaRegistry";

interface UploadResult {
  filename: string;
  records: ParsedRecord[];
  status: "pending" | "parsing" | "parsed" | "uploading" | "done" | "error";
  error?: string;
  crossRefs?: Array<{ registration: string; detection_count: number }>;
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
