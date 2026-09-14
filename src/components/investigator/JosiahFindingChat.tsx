import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Send, ImagePlus, X, Wrench } from "lucide-react";

type Msg = {
  role: string;
  content: string;
  tool_trace?: { tool: string; args: unknown; result: unknown }[] | null;
};

const TOOL_LABEL: Record<string, string> = {
  subject_history: "checked its month-by-month history",
  co_presence: "checked who else was overhead at the same time",
  registry_identity: "pulled the FAA registry record",
  similar_tails: "looked at near-identical tail numbers and fleet-mates",
  behaviour_neighbours: "compared flight-profile fingerprints",
  shell_match: "checked the owner against known shell entities",
  biometric_correlation: "checked heart-rate correlations",
  recent_track: "read the most recent contacts",
  other_findings: "reviewed everything already recorded on this aircraft",
  record_evidence: "saved what you contributed to the case record",
};

const SUGGESTIONS = [
  "Who else was overhead at the same time?",
  "Is this aircraft still flying today?",
  "Are there other tails in the same fleet doing this?",
  "What would the other side say against this finding?",
];

export function JosiahFindingChat({
  findingId, subject, claim,
}: { findingId: string; subject: string; claim: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("wt-josiah", {
        body: { action: "history", finding_id: findingId },
      });
      if (error) throw new Error(error.message);
      setMessages(data?.messages ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [findingId]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  const attach = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).slice(0, 4).forEach((file) => {
      if (file.size > 4_000_000) { toast.error(`${file.name} is too large (4 MB limit)`); return; }
      const reader = new FileReader();
      reader.onload = () => setImages((p) => [...p, String(reader.result)].slice(0, 4));
      reader.readAsDataURL(file);
    });
  };

  const send = async (text?: string) => {
    const body = (text ?? input).trim();
    if (!body && !images.length) return;
    setSending(true);
    setMessages((p) => [...p, { role: "user", content: body || "(screenshots)" }]);
    setInput("");
    const sentImages = images;
    setImages([]);
    try {
      const { data, error } = await supabase.functions.invoke("wt-josiah", {
        body: { finding_id: findingId, message: body, attachments: sentImages },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data.error || "Josiah could not answer");
      setMessages((p) => [...p, { role: "assistant", content: data.answer, tool_trace: data.trace }]);
    } catch (e) {
      toast.error((e as Error).message);
      setMessages((p) => [...p, { role: "assistant", content: `I couldn't finish that: ${(e as Error).message}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[560px] flex-col">
      <ScrollArea className="flex-1 pr-3">
        <div className="space-y-4">
          {loading && <div className="py-8 text-center text-sm text-muted-foreground">Loading the conversation…</div>}

          {!loading && !messages.length && (
            <div className="space-y-3 rounded border border-border/60 bg-card/40 p-4">
              <p className="text-sm">
                Talk this through with Josiah. He can look up anything in the archive about{" "}
                <span className="font-mono text-primary">{subject}</span> while you two work on:{" "}
                <span className="italic">{claim}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Paste what you've found, drop in radar screenshots, or push back on the finding — anything you add is kept on the record.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} size="sm" variant="outline" className="h-7 text-xs" onClick={() => send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div className={m.role === "user"
                ? "max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                : "max-w-full space-y-2"}>
                {m.role === "assistant" && !!m.tool_trace?.length && (
                  <div className="flex flex-wrap gap-1">
                    {m.tool_trace.map((t, j) => (
                      <Badge key={j} variant="outline" className="gap-1 text-[10px] font-normal">
                        <Wrench className="h-3 w-3" /> {TOOL_LABEL[t.tool] ?? t.tool}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Josiah is checking the archive…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {!!images.length && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="Attached screenshot" className="h-14 w-14 rounded border border-border object-cover" />
              <button
                onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 rounded-full bg-background border border-border p-0.5"
                aria-label="Remove screenshot"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Ask Josiah, or tell him what you found…"
          className="min-h-[60px] resize-none text-sm"
          autoFocus
        />
        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => attach(e.target.files)} />
          <Button size="icon" variant="outline" onClick={() => fileRef.current?.click()} aria-label="Attach screenshots">
            <ImagePlus className="h-4 w-4" />
          </Button>
          <Button size="icon" onClick={() => send()} disabled={sending} aria-label="Send">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
