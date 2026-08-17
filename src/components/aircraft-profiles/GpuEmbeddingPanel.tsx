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
    try {
      const { data, error } = await supabase.functions.invoke("aircraft-profile", {
        body: { action: "exportFeatures", limit: 20000, onlyStale },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Export failed");
      if (!data.count) { toast.info("Every profile already has an up-to-date embedding"); return; }

      const jsonl = (data.rows || [])
        .map((r: any) => JSON.stringify({
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
        }))
        .join("\n");
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const blob = new Blob([jsonl], { type: "application/x-ndjson" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${stamp}_WATCHTOWER_AIRCRAFT-PROFILES_features.jsonl`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported ${data.count} aircraft feature records`);
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const importVectors = async (file: File) => {
    setImporting(true);
    setProgress("Reading file…");
    try {
      const text = await file.text();
      let items: any[] = [];
      const trimmed = text.trim();
      if (trimmed.startsWith("[")) {
        items = JSON.parse(trimmed);
      } else {
        items = trimmed.split("\n").filter(Boolean).map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
      }

      const pickVec = (i: any): number[] => {
        const cand = i.vec ?? i.embedding ?? i.vector ?? i.values ?? i.embeddings ?? i.data?.embedding;
        if (Array.isArray(cand)) return cand.map(Number).filter((n: number) => Number.isFinite(n));
        if (cand && Array.isArray(cand.values)) return cand.values.map(Number);
        return [];
      };

      const clean = items
        .map((i) => ({
          registration: String(i.registration || i.reg || i.tail || i.id || "").toUpperCase().trim(),
          vec: pickVec(i),
        }))
        .filter((i) => i.registration && i.vec.length >= 2);

      if (!clean.length) {
        const sample = items[0] ? Object.keys(items[0]).join(", ") : "none";
        const looksLikeFeatures = items.some((i) => i && i.text && !pickVec(i).length);
        throw new Error(
          looksLikeFeatures
            ? "This is the exported features file (registration + text), not an embedded file. Run the GPU script on it first, then upload the *_embedded.jsonl output."
            : `No {registration, vec} records found. Parsed ${items.length} lines; first-line keys: ${sample}`,
        );
      }

      const dims = clean[0].vec.length;
      const mismatched = clean.filter((c) => c.vec.length !== dims).length;
      if (mismatched) throw new Error(`${mismatched} records have a different vector size than ${dims} — re-embed with one model.`);

      const CHUNK = 250;
      let written = 0;
      for (let i = 0; i < clean.length; i += CHUNK) {
        setProgress(`Uploading ${i + 1}–${Math.min(i + CHUNK, clean.length)} of ${clean.length}…`);
        const { data, error } = await supabase.functions.invoke("aircraft-profile", {
          body: { action: "importEmbeddings", embeddings: clean.slice(i, i + CHUNK), model: file.name },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Import failed");
        written += data.written || 0;
      }
      toast.success(`Stored ${written} embeddings (${dims}-dim) — behavioural twins recomputed`);
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
