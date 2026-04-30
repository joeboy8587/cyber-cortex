import { useCallback, useEffect, useRef, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen, Upload, FileText, Loader2, CheckCircle2, AlertCircle,
  Search, Sparkles, Trash2, Database,
} from "lucide-react";

interface RagDoc {
  id: string;
  title: string;
  filename: string;
  status: string;
  status_message: string | null;
  chunk_count: number | null;
  file_size: number | null;
  document_type: string | null;
  tags: string[] | null;
  extraction_summary: any;
  created_at: string;
}

interface RagExtraction {
  id: string;
  document_id: string;
  extraction_type: string;
  label: string;
  context: string;
  confidence: number;
  status: string;
}

const ACCEPT = ".pdf,.md,.markdown,.txt,.text,.csv,.log,application/pdf,text/plain,text/markdown";

export const JosiahRAGPanel = () => {
  const { toast } = useToast();
  const [docs, setDocs] = useState<RagDoc[]>([]);
  const [extractions, setExtractions] = useState<RagExtraction[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [recallQuery, setRecallQuery] = useState("");
  const [recallResults, setRecallResults] = useState<any[]>([]);
  const [recallLoading, setRecallLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    const [{ data: docData }, { data: exData }] = await Promise.all([
      supabase.from("rag_documents").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("rag_extractions").select("*").order("confidence", { ascending: false }).limit(40),
    ]);
    setDocs((docData as RagDoc[]) || []);
    setExtractions((exData as RagExtraction[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDocs();
    // poll while anything is in-flight
    const t = setInterval(() => {
      setDocs(prev => {
        const stillWorking = prev.some(d =>
          ["pending", "parsing", "chunking", "embedding", "analyzing"].includes(d.status));
        if (stillWorking || uploadingCount > 0) loadDocs();
        return prev;
      });
    }, 4000);
    return () => clearInterval(t);
  }, [loadDocs, uploadingCount]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingCount(files.length);
    let okCount = 0;

    for (const file of Array.from(files)) {
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;

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
          document_type: "rag_upload",
          tags: ["rag", ext],
          status: "pending",
          status_message: "Queued for ingestion",
        }).select().single();
        if (insErr || !doc) throw insErr || new Error("no doc returned");

        // Fire-and-forget ingest (do not await; UI polls status)
        supabase.functions.invoke("rag-ingest", { body: { document_id: doc.id } })
          .catch(e => console.error("ingest invoke", e));
        okCount++;
      } catch (err) {
        console.error("upload error", err);
        toast({
          title: `Upload failed: ${file.name}`,
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    }

    setUploadingCount(0);
    toast({
      title: `Queued ${okCount}/${files.length} file(s)`,
      description: "Josiah is parsing, embedding, and extracting entities now.",
    });
    if (fileRef.current) fileRef.current.value = "";
    loadDocs();
  };

  const recall = async () => {
    if (recallQuery.trim().length < 3) return;
    setRecallLoading(true);
    setRecallResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: { query: recallQuery, match_count: 8, similarity_threshold: 0.4 },
      });
      if (error) throw error;
      setRecallResults(data?.matches || []);
      if ((data?.matches || []).length === 0) {
        toast({ title: "No matches", description: "Try different wording or upload more documents." });
      }
    } catch (err) {
      toast({ title: "Recall failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setRecallLoading(false);
    }
  };

  const deleteDoc = async (id: string) => {
    if (!confirm("Delete this document and all its chunks/extractions?")) return;
    const { error } = await supabase.from("rag_documents").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Deleted" });
      loadDocs();
    }
  };

  const statusBadge = (s: string) => {
    if (s === "ready") return <Badge className="bg-green-500/20 text-green-400 border-green-500/40"><CheckCircle2 className="h-3 w-3 mr-1" />Ready</Badge>;
    if (s === "failed") return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Failed</Badge>;
    return <Badge variant="outline" className="text-amber-400 border-amber-500/40"><Loader2 className="h-3 w-3 mr-1 animate-spin" />{s}</Badge>;
  };

  const inFlight = docs.filter(d =>
    ["pending", "parsing", "chunking", "embedding", "analyzing"].includes(d.status)).length;
  const ready = docs.filter(d => d.status === "ready").length;
  const totalChunks = docs.reduce((a, d) => a + (d.chunk_count || 0), 0);
  const autoPromoted = extractions.filter(e => e.status === "auto_promoted").length;

  return (
    <CyberPanel title="JOSIAH RAG KNOWLEDGE BASE" icon={<BookOpen className="h-5 w-5" />}>
      <div className="space-y-4">
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
          Bulk-upload PDFs, Markdown, or text files. Josiah will parse, chunk, embed, and extract investigative
          entities automatically. Items with confidence ≥ 0.85 are auto-promoted into the case as autonomous flags.
          All ingested content is searchable from chat.
        </div>

        {/* Upload zone */}
        <div
          className="rounded-lg border-2 border-dashed border-primary/40 bg-background/40 p-6 text-center cursor-pointer hover:border-primary/70 transition-colors"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        >
          <Upload className="h-8 w-8 mx-auto text-primary mb-2" />
          <div className="text-sm font-mono">
            {uploadingCount > 0
              ? `Uploading ${uploadingCount} file(s)…`
              : "Drop files here or click to select"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">PDF · MD · TXT · CSV · LOG (multi-select OK)</div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="rounded border border-border/40 bg-background/30 p-2">
            <div className="text-muted-foreground">Documents</div>
            <div className="text-lg font-mono text-primary">{docs.length}</div>
          </div>
          <div className="rounded border border-border/40 bg-background/30 p-2">
            <div className="text-muted-foreground">Ready / In-flight</div>
            <div className="text-lg font-mono">
              <span className="text-green-400">{ready}</span> / <span className="text-amber-400">{inFlight}</span>
            </div>
          </div>
          <div className="rounded border border-border/40 bg-background/30 p-2">
            <div className="text-muted-foreground">Indexed chunks</div>
            <div className="text-lg font-mono text-primary">{totalChunks.toLocaleString()}</div>
          </div>
          <div className="rounded border border-border/40 bg-background/30 p-2">
            <div className="text-muted-foreground">Auto-promoted</div>
            <div className="text-lg font-mono text-orange-400">{autoPromoted}</div>
          </div>
        </div>

        <Tabs defaultValue="library">
          <TabsList>
            <TabsTrigger value="library"><FileText className="h-3 w-3 mr-1" />Library</TabsTrigger>
            <TabsTrigger value="extractions"><Sparkles className="h-3 w-3 mr-1" />Extractions</TabsTrigger>
            <TabsTrigger value="recall"><Search className="h-3 w-3 mr-1" />Test Recall</TabsTrigger>
          </TabsList>

          <TabsContent value="library">
            <ScrollArea className="h-80">
              <div className="space-y-2">
                {docs.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-6">No documents yet — upload some files.</div>
                )}
                {docs.map(d => (
                  <div key={d.id} className="rounded border border-border/40 bg-background/30 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm truncate">{d.title}</span>
                          {statusBadge(d.status)}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1 truncate">
                          {d.filename} · {d.file_size ? `${(d.file_size / 1024).toFixed(1)} KB · ` : ""}
                          {d.chunk_count || 0} chunks
                        </div>
                        {d.status_message && (
                          <div className="text-[11px] text-muted-foreground mt-1 italic">{d.status_message}</div>
                        )}
                        {d.extraction_summary?.total_extractions > 0 && (
                          <div className="flex gap-2 mt-1 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">
                              {d.extraction_summary.total_extractions} extractions
                            </Badge>
                            {d.extraction_summary.auto_promoted > 0 && (
                              <Badge className="text-[10px] bg-orange-500/20 text-orange-400 border-orange-500/40">
                                {d.extraction_summary.auto_promoted} auto-promoted
                              </Badge>
                            )}
                          </div>
                        )}
                        {["parsing", "chunking", "embedding", "analyzing"].includes(d.status) && (
                          <Progress value={
                            d.status === "parsing" ? 20 :
                            d.status === "chunking" ? 40 :
                            d.status === "embedding" ? 70 : 90
                          } className="h-1 mt-2" />
                        )}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => deleteDoc(d.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="extractions">
            <ScrollArea className="h-80">
              <div className="space-y-2">
                {extractions.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-6">No extractions yet.</div>
                )}
                {extractions.map(e => (
                  <div key={e.id} className="rounded border border-border/40 bg-background/30 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">{e.extraction_type}</Badge>
                        <span className="font-mono text-primary">{e.label}</span>
                        <span className={`text-[10px] ${e.confidence >= 0.85 ? "text-orange-400" : "text-muted-foreground"}`}>
                          {(e.confidence * 100).toFixed(0)}%
                        </span>
                        {e.status === "auto_promoted" && (
                          <Badge className="text-[10px] bg-orange-500/20 text-orange-400 border-orange-500/40">promoted</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-muted-foreground mt-1 line-clamp-2">{e.context}</div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="recall">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={recallQuery}
                  onChange={(e) => setRecallQuery(e.target.value)}
                  placeholder="Ask anything: 'KCSO N597E Huey violations'…"
                  onKeyDown={(e) => { if (e.key === "Enter") recall(); }}
                />
                <Button onClick={recall} disabled={recallLoading || recallQuery.trim().length < 3}>
                  {recallLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Database className="h-3 w-3" /> Searches across {totalChunks.toLocaleString()} indexed chunks. Results stream automatically into Josiah's chat context.
              </div>
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {recallResults.map((r, i) => (
                    <div key={r.chunk_id} className="rounded border border-border/40 bg-background/30 p-2 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-primary">[{i + 1}] {r.document_title}</span>
                        <Badge variant="outline" className="text-[10px]">
                          sim {(r.similarity * 100).toFixed(0)}%
                        </Badge>
                      </div>
                      <div className="text-muted-foreground line-clamp-4">{r.content}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </CyberPanel>
  );
};
