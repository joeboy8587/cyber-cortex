import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Cpu, Download, Upload, Loader2, FileCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Props = { embedded: number; pending?: number; onImported?: () => void };

export function GpuEmbeddingPanel({ embedded, pending = 0, onImported }: Props) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportCorpus = async (onlyStale = false) => {
    setExporting(true);
    setProgress("Preparing export…");
    try {
      const PAGE = 500;
      const parts: string[] = [];
      let offset = 0;
      let total = 0;
      // Paged so a 20k+ corpus never blows the edge-function response budget.
      for (let page = 0; page < 400; page++) {
        setProgress(`Downloading records ${offset + 1}–${offset + PAGE}…`);
        const { data, error } = await supabase.functions.invoke("aircraft-profile", {
          body: { action: "exportFeatures", limit: PAGE, offset, onlyStale },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Export failed");
        const rows = data.rows || [];
        total += rows.length;
        if (rows.length) {
          parts.push(
            rows.map((r: any) => JSON.stringify({
              registration: r.registration,
              icao24: r.icao24,
              operator: r.operator,
              aircraft_type: r.aircraft_type,
              risk_score: Number(r.risk_score || 0),
              signature_hash: r.signature_hash,
              features: (r.feature_vector || []).map(Number),
              hour_hist: r.hour_hist || [],
              dow_hist: r.dow_hist || [],
              text: r.text,
            })).join("\n") + "\n",
          );
        }
        offset += PAGE;
        if (data.done || rows.length < PAGE) break;
      }

      if (!total) { toast.info("Every profile already has an up-to-date embedding"); return; }

      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const blob = new Blob(parts, { type: "application/x-ndjson" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${stamp}_WATCHTOWER_AIRCRAFT-PROFILES_features.jsonl`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported ${total.toLocaleString()} aircraft feature records`);
    } catch (e: any) {
      toast.error(e.message || "Export failed", { duration: 12000 });
    } finally {
      setExporting(false);
      setProgress(null);
    }
  };

  const importVectors = async (file: File) => {
    setImporting(true);
    setProgress("Reading file…");
    try {
      const pickVec = (i: any): number[] => {
        const cand = i.vec ?? i.embedding ?? i.vector ?? i.values ?? i.embeddings ?? i.data?.embedding;
        if (Array.isArray(cand)) return cand.map(Number).filter((n: number) => Number.isFinite(n));
        if (cand && Array.isArray(cand.values)) return cand.values.map(Number);
        return [];
      };
      const parseLine = (line: string) => {
        const t = line.trim().replace(/,$/, "");
        if (!t || t === "[" || t === "]") return null;
        let obj: any;
        try { obj = JSON.parse(t); } catch { return null; }
        if (!obj || typeof obj !== "object") return null;
        const registration = String(obj.registration || obj.reg || obj.tail || obj.id || "").toUpperCase().trim();
        const vec = pickVec(obj);
        if (!registration || vec.length < 2) return null;
        return { registration, vec };
      };

      // Stream the file line-by-line: a multi-GB JSONL cannot be read with
      // file.text() (the browser silently fails and we parsed 0 records).
      const reader = (file.stream() as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let batch: Array<{ registration: string; vec: number[] }> = [];
      let parsed = 0, skipped = 0, written = 0, dims = 0;
      const CHUNK = 200;

      const flush = async () => {
        if (!batch.length) return;
        setProgress(`Uploading… ${written.toLocaleString()} stored, ${parsed.toLocaleString()} parsed`);
        const { data, error } = await supabase.functions.invoke("aircraft-profile", {
          body: { action: "importEmbeddings", embeddings: batch, model: file.name },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Import failed");
        written += data.written || 0;
        batch = [];
      };

      const handle = async (line: string) => {
        const rec = parseLine(line);
        if (!rec) { if (line.trim()) skipped++; return; }
        if (!dims) dims = rec.vec.length;
        if (rec.vec.length !== dims) { skipped++; return; }
        parsed++;
        batch.push(rec);
        if (batch.length >= CHUNK) await flush();
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          await handle(line);
        }
        if (parsed % 1000 === 0) setProgress(`Parsed ${parsed.toLocaleString()} vectors…`);
      }
      buffer += decoder.decode();
      if (buffer.trim()) await handle(buffer);
      await flush();

      if (!parsed) {
        throw new Error(
          `No {registration, vec} records found (skipped ${skipped.toLocaleString()} lines). ` +
          "Upload the *_embedded.jsonl produced by the GPU script, not the features export.",
        );
      }
      toast.success(
        `Stored ${written.toLocaleString()} embeddings (${dims}-dim)` +
        (skipped ? ` — ${skipped.toLocaleString()} lines skipped` : ""),
      );
      onImported?.();
    } catch (e: any) {
      toast.error(e.message || "Import failed", { duration: 12000 });
    } finally {
      setImporting(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };


  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          <span className="font-display tracking-wide">Local GPU embedding bridge</span>
        </div>
        <div className="flex items-center gap-2">
          {pending > 0 && (
            <Badge variant="destructive" className="font-mono">{pending.toLocaleString()} need refresh</Badge>
          )}
          <Badge variant="secondary" className="font-mono">{embedded.toLocaleString()} vectors stored</Badge>
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Step 1 — download the feature corpus (one line per aircraft: numeric behaviour vector, hour/weekday
        histograms and a text summary). Step 2 — embed it on your GPU. Step 3 — upload the results back as
        JSONL or JSON with <code className="font-mono">{`{"registration": "N123AB", "vec": [...]}`}</code>;
        the system stores them and recomputes behavioural twins automatically.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => exportCorpus(true)} disabled={exporting}>
          {exporting ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
          Export new &amp; changed only{pending > 0 ? ` (${pending.toLocaleString()})` : ""}
        </Button>
        <Button size="sm" variant="outline" onClick={() => exportCorpus(false)} disabled={exporting}>
          {exporting ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Download className="w-3 h-3 mr-2" />}
          Export full corpus
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Upload className="w-3 h-3 mr-2" />}
          Upload embeddings
        </Button>

        <a href="/scripts/gpu-embed-aircraft.py" download="gpu-embed-aircraft.py">
          <Button size="sm" variant="secondary" type="button">
            <FileCode className="w-3 h-3 mr-2" />
            Download GPU helper script
          </Button>
        </a>
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          <strong className="text-foreground">Not a coder?</strong> The button above downloads a ready-to-run Python
          script for your new MSI Katana RTX. It installs the model and embeds the corpus automatically.
        </p>
        <p>Recommended model: <code className="font-mono">sentence-transformers/all-MiniLM-L6-v2</code> (384 dims, fast on RTX).</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".jsonl,.json,.ndjson"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importVectors(f); }}
      />
      {progress && <div className="text-xs font-mono text-muted-foreground">{progress}</div>}
    </Card>
  );
}
