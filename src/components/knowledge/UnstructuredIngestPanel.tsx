import { useRef, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  screenshotTimestampToUtcIso,
  formatPacific,
  formatUtc,
  pacificZoneLabel,
} from "@/lib/timezone";
import { correlateScreenshotWithAdsb, type CorrelationResult } from "@/lib/adsbCorrelation";
import {
  FileStack, Upload, Loader2, CheckCircle2, AlertCircle, Image as ImageIcon,
  FileText, Radar, Clock,
} from "lucide-react";

const ACCEPT =
  ".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.html,.htm,.eml,.msg,.md,.txt,.csv,.png,.jpg,.jpeg,.webp,.tiff,.bmp";

type Route = "document" | "screenshot";

interface IngestItem {
  id: string;
  filename: string;
  route: Route;
  status: "working" | "done" | "failed";
  message: string;
  elements?: number;
  tables?: number;
  chars?: number;
  capturedAtUtc?: string | null;
  timeSource?: string;
  flight?: any;
  correlation?: CorrelationResult | null;
}

const isImage = (f: File) =>
  f.type.startsWith("image/") ||
  /\.(png|jpe?g|webp|tiff?|bmp|heic)$/i.test(f.name);

const fileToDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(f);
  });

export const UnstructuredIngestPanel = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<IngestItem[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (id: string, p: Partial<IngestItem>) =>
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...p } : i)));

  /** Documents → storage + rag_documents + rag-ingest (Unstructured parses server-side). */
  const ingestDocument = async (file: File, id: string) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;

    patch(id, { message: "Uploading to evidence storage…" });
    const { error: upErr } = await supabase.storage.from("rag-uploads").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (upErr) throw upErr;

    const { data: doc, error: insErr } = await supabase.from("rag_documents").insert({
      title: file.name.replace(/\.[^.]+$/, ""),
      filename: file.name,
      storage_path: path,
      mime_type: file.type || `application/${ext}`,
      file_size: file.size,
      document_type: "unstructured_upload",
      tags: ["rag", "unstructured", ext],
      status: "pending",
      status_message: "Queued for Unstructured partitioning",
    }).select().single();
    if (insErr || !doc) throw insErr || new Error("insert failed");

    patch(id, { message: "Partitioning + embedding (runs in background)…" });
    const { data, error } = await supabase.functions.invoke("rag-ingest", {
      body: { document_id: doc.id },
    });
    if (error) throw error;

    patch(id, {
      status: "done",
      message: `Indexed ${data?.chunks ?? 0} chunks · ${data?.extractions ?? 0} entities (${data?.auto_promoted ?? 0} auto-promoted)`,
      chars: data?.chunks,
    });
  };

  /** Screenshots → Unstructured OCR + vision flight read + PDT→UTC + ADS-B cross-check. */
  const ingestScreenshot = async (file: File, id: string) => {
    const dataUrl = await fileToDataUrl(file);
    const b64 = dataUrl.split(",")[1];

    patch(id, { message: "Unstructured OCR…" });
    const { data: part, error: partErr } = await supabase.functions.invoke("unstructured-partition", {
      body: { file_base64: b64, filename: file.name, mime_type: file.type || "image/png" },
    });
    if (partErr) throw partErr;
    const ocrText: string = part?.text || "";

    patch(id, {
      message: "Reading radar panel (vision)…",
      elements: part?.elementCount,
      tables: part?.tableCount,
      chars: ocrText.length,
    });

    const { data: vision } = await supabase.functions.invoke("josiah-analyze-f24", {
      body: {
        image: dataUrl,
        location: "Oildale AOI",
        additionalNotes: `Unstructured OCR text:\n${ocrText.slice(0, 4000)}`,
        timestamp: new Date(file.lastModified || Date.now()).toISOString(),
      },
    });
    const v = vision?.data || {};
    const flight = v.flight_data || null;

    // Timestamp precedence: on-screen track clock → status-bar clock → file mtime.
    const screenDate = v.screen_date_local || new Date(file.lastModified || Date.now())
      .toISOString().slice(0, 10);
    let capturedAtUtc: string | null = null;
    let timeSource = "file_mtime";
    if (v.track_clock_local) {
      capturedAtUtc = screenshotTimestampToUtcIso(`${screenDate} ${v.track_clock_local}`);
      timeSource = "track_clock";
    }
    if (!capturedAtUtc && v.screen_clock_local) {
      capturedAtUtc = screenshotTimestampToUtcIso(`${screenDate} ${v.screen_clock_local}`);
      timeSource = "status_bar_clock";
    }
    if (!capturedAtUtc) {
      capturedAtUtc = new Date(file.lastModified || Date.now()).toISOString();
    }

    patch(id, { message: "Cross-checking ADS-B evidence tables…", capturedAtUtc, timeSource, flight });

    let correlation: CorrelationResult | null = null;
    try {
      correlation = await correlateScreenshotWithAdsb({
        capturedAtUtc,
        registration: flight?.registration,
        icao: flight?.icao,
        callsign: flight?.callsign,
        windowMinutes: 15,
      });
    } catch (e) {
      console.error("correlation failed", e);
    }

    // Mirror OCR + findings into the RAG corpus so Josiah can recall this screenshot.
    if (ocrText.length > 40) {
      const body = [
        `# Radar screenshot: ${file.name}`,
        `Captured (UTC): ${capturedAtUtc} — source: ${timeSource}`,
        flight ? `Flight: ${JSON.stringify(flight)}` : "",
        v.josiah_reflection ? `Reflection: ${v.josiah_reflection}` : "",
        correlation ? `ADS-B identity matches: ${correlation.identityMatches.length}, context: ${correlation.contextMatches.length}` : "",
        "\n## OCR text\n",
        ocrText,
      ].filter(Boolean).join("\n");
      supabase.functions.invoke("rag-ingest-inline", {
        body: {
          title: `Radar screenshot ${file.name}`,
          filename: file.name,
          content: body,
          document_type: "radar_screenshot",
          tags: ["radar_screenshot", "unstructured", "ocr"],
        },
      }).catch(e => console.error("rag mirror", e));
    }

    patch(id, {
      status: "done",
      correlation,
      message: correlation
        ? `${correlation.identityMatches.length} identity match(es), ${correlation.contextMatches.length} in ±15 min window`
        : "OCR + vision complete (no ADS-B cross-check)",
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const route: Route = isImage(file) ? "screenshot" : "document";
      setItems(prev => [{ id, filename: file.name, route, status: "working", message: "Starting…" }, ...prev]);
      try {
        if (route === "screenshot") await ingestScreenshot(file, id);
        else await ingestDocument(file, id);
      } catch (err) {
        patch(id, { status: "failed", message: (err as Error).message });
        toast({ title: `Failed: ${file.name}`, description: (err as Error).message, variant: "destructive" });
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <CyberPanel title="UNSTRUCTURED INGEST // DOCUMENTS + RADAR SCREENSHOTS" icon={<FileStack className="h-5 w-5" />}>
      <div className="space-y-4">
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
          Files are auto-routed. <span className="text-primary">Documents</span> (PDF, Word, PowerPoint, Excel, HTML,
          email) are partitioned by Unstructured — tables and layout preserved — then chunked, embedded and
          entity-extracted into Josiah's corpus. <span className="text-primary">Images</span> are treated as radar
          screenshots: OCR, on-screen clock read, Pacific→UTC conversion, then an ADS-B cross-check in a ±15 minute window.
        </div>

        <div
          className="rounded-lg border-2 border-dashed border-primary/40 bg-background/40 p-6 text-center cursor-pointer hover:border-primary/70 transition-colors"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        >
          {busy
            ? <Loader2 className="h-8 w-8 mx-auto text-primary mb-2 animate-spin" />
            : <Upload className="h-8 w-8 mx-auto text-primary mb-2" />}
          <div className="text-sm font-mono">{busy ? "Processing…" : "Drop files here or click to select"}</div>
          <div className="text-[11px] text-muted-foreground mt-1">
            PDF · DOCX · PPTX · XLSX · HTML · EML · PNG/JPG screenshots (multi-select OK)
          </div>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden"
            onChange={(e) => handleFiles(e.target.files)} />
        </div>

        <ScrollArea className="h-96">
          <div className="space-y-2">
            {items.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-6">
                Nothing ingested yet this session.
              </div>
            )}
            {items.map(item => (
              <div key={item.id} className="rounded border border-border/40 bg-background/30 p-3 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  {item.route === "screenshot"
                    ? <ImageIcon className="h-3.5 w-3.5 text-primary" />
                    : <FileText className="h-3.5 w-3.5 text-primary" />}
                  <span className="font-mono truncate max-w-[18rem]">{item.filename}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {item.route === "screenshot" ? "RADAR FORENSICS" : "RAG CORPUS"}
                  </Badge>
                  {item.status === "working" && (
                    <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/40">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />working
                    </Badge>
                  )}
                  {item.status === "done" && (
                    <Badge className="text-[10px] bg-green-500/20 text-green-400 border-green-500/40">
                      <CheckCircle2 className="h-3 w-3 mr-1" />done
                    </Badge>
                  )}
                  {item.status === "failed" && (
                    <Badge variant="destructive" className="text-[10px]">
                      <AlertCircle className="h-3 w-3 mr-1" />failed
                    </Badge>
                  )}
                </div>

                <div className="text-muted-foreground mt-1">{item.message}</div>

                {(item.elements != null || item.chars != null) && (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {item.elements != null && <>{item.elements} elements · </>}
                    {item.tables ? <>{item.tables} tables · </> : null}
                    {item.chars != null && <>{item.chars.toLocaleString()} chars extracted</>}
                  </div>
                )}

                {item.capturedAtUtc && (
                  <div className="mt-2 rounded border border-border/40 bg-background/40 p-2">
                    <div className="flex items-center gap-1 text-[11px] text-primary">
                      <Clock className="h-3 w-3" /> Capture instant ({item.timeSource})
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 font-mono">
                      {formatPacific(item.capturedAtUtc)} {pacificZoneLabel(new Date(item.capturedAtUtc))} → {formatUtc(item.capturedAtUtc)} UTC
                    </div>
                  </div>
                )}

                {item.flight && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {["registration", "callsign", "icao", "altitude", "speed"].map(k =>
                      item.flight[k] ? (
                        <Badge key={k} variant="outline" className="text-[10px] font-mono">
                          {k}: {String(item.flight[k])}
                        </Badge>
                      ) : null)}
                  </div>
                )}

                {item.correlation && item.correlation.identityMatches.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1 text-[11px] text-primary">
                      <Radar className="h-3 w-3" /> ADS-B identity matches
                    </div>
                    {item.correlation.identityMatches.slice(0, 5).map((m, i) => (
                      <div key={i} className="text-[11px] font-mono text-muted-foreground">
                        {m.source} · {m.registration || m.icao24 || m.callsign} · {m.altitude ?? "—"} ft ·{" "}
                        {m.speed ?? "—"} kt · Δ{m.delta_seconds}s · {m.match_type}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        {items.some(i => i.status === "done") && (
          <Button variant="outline" size="sm" onClick={() => setItems([])}>Clear session log</Button>
        )}
      </div>
    </CyberPanel>
  );
};
