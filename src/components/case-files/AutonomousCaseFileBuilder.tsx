import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Bot, FileText, Zap, Search, ArrowUpCircle, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

const CASES = [
  { code: "CASE-001-RICO", name: "RICO Enterprise", icon: "🏛️", color: "text-red-400" },
  { code: "CASE-002-POSSE-COMITATUS", name: "Posse Comitatus", icon: "🎖️", color: "text-orange-400" },
  { code: "CASE-003-FAA-VIOLATIONS", name: "FAA Violations", icon: "✈️", color: "text-yellow-400" },
  { code: "CASE-004-CIVIL-RIGHTS", name: "Civil Rights", icon: "⚖️", color: "text-blue-400" },
];

const MODES = [
  { value: "scan", label: "🔍 Evidence Scan", desc: "Broad scan across all data" },
  { value: "build", label: "🏗️ Build Case File", desc: "Full case file with exhibits" },
  { value: "promote", label: "⬆️ Promote Records", desc: "Promote universe → exhibits" },
];

export function AutonomousCaseFileBuilder() {
  const [selectedCase, setSelectedCase] = useState(CASES[0].code);
  const [mode, setMode] = useState<"scan" | "build" | "promote">("scan");
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [stats, setStats] = useState({ tablesQueried: 0, recordsAnalyzed: 0 });
  const abortRef = useRef<AbortController | null>(null);

  const runAgent = useCallback(async () => {
    setIsRunning(true);
    setOutput("");
    abortRef.current = new AbortController();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/case-file-builder`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ caseCode: selectedCase, mode }),
          signal: abortRef.current.signal,
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Unknown error" }));
        toast.error(err.error || `Error: ${response.status}`);
        setIsRunning(false);
        return;
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              setOutput(fullText);
            }
          } catch {
            // partial JSON, skip
          }
        }
      }

      // Count tables/records mentioned
      const tableMatches = fullText.match(/Tables queried:.*$/m);
      const recordMatches = fullText.match(/Records analyzed:.*$/m);
      setStats({
        tablesQueried: tableMatches ? (tableMatches[0].match(/\d+/)?.[0] ? parseInt(tableMatches[0].match(/\d+/)![0]) : 0) : 0,
        recordsAnalyzed: recordMatches ? (recordMatches[0].match(/\d+/)?.[0] ? parseInt(recordMatches[0].match(/\d+/)![0]) : 0) : 0,
      });

      toast.success("Case file analysis complete!");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error((err as Error).message);
      }
    } finally {
      setIsRunning(false);
    }
  }, [selectedCase, mode]);

  const saveCaseFile = useCallback(async () => {
    if (!output) return;
    const caseInfo = CASES.find(c => c.code === selectedCase);
    try {
      const { error } = await supabase.from("agent_case_files").insert({
        agent: "case_file_builder",
        title: `${caseInfo?.name || selectedCase} - ${mode.toUpperCase()} - ${new Date().toISOString().split("T")[0]}`,
        content: output,
        document_type: "autonomous_case_file",
        tags: ["autonomous", "case_file_builder", selectedCase.toLowerCase(), mode],
      });
      if (error) throw error;
      toast.success("Case file saved to database!");
    } catch (err) {
      toast.error("Failed to save: " + (err as Error).message);
    }
  }, [output, selectedCase, mode]);

  const stopAgent = () => {
    abortRef.current?.abort();
    setIsRunning(false);
  };

  const caseInfo = CASES.find(c => c.code === selectedCase);

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-primary font-mono text-sm uppercase tracking-wider">
            <Bot className="h-5 w-5" />
            Autonomous Case File Builder
            <Badge variant="outline" className="ml-auto text-xs">
              AI-Powered • 900+ Tables • 20M+ Records
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Case selector */}
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">TARGET CASE</label>
              <Select value={selectedCase} onValueChange={setSelectedCase}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASES.map(c => (
                    <SelectItem key={c.code} value={c.code}>
                      <span className="flex items-center gap-2">
                        <span>{c.icon}</span>
                        <span>{c.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Mode selector */}
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">OPERATION MODE</label>
              <Select value={mode} onValueChange={(v) => setMode(v as "scan" | "build" | "promote")}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map(m => (
                    <SelectItem key={m.value} value={m.value}>
                      <span>{m.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action buttons */}
            <div className="flex items-end gap-2">
              {isRunning ? (
                <Button onClick={stopAgent} variant="destructive" className="flex-1">
                  Stop Agent
                </Button>
              ) : (
                <Button onClick={runAgent} className="flex-1 gap-2">
                  <Zap className="h-4 w-4" />
                  Run Agent
                </Button>
              )}
              {output && !isRunning && (
                <Button onClick={saveCaseFile} variant="outline" size="icon" title="Save to DB">
                  <Save className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Status bar */}
          {isRunning && (
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground bg-muted/50 rounded p-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Agent querying Neon DB for {caseInfo?.name}...</span>
              <span className="ml-auto">Mode: {mode.toUpperCase()}</span>
            </div>
          )}

          {/* Case context badges */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="text-xs">
              <FileText className="h-3 w-3 mr-1" />
              {caseInfo?.code}
            </Badge>
            {mode === "scan" && (
              <Badge variant="outline" className="text-xs">
                <Search className="h-3 w-3 mr-1" /> Evidence Scan
              </Badge>
            )}
            {mode === "promote" && (
              <Badge variant="outline" className="text-xs">
                <ArrowUpCircle className="h-3 w-3 mr-1" /> Universe → Exhibits
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Output panel */}
      {output && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono text-primary uppercase tracking-wider flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Agent Output
              {isRunning && <Loader2 className="h-3 w-3 animate-spin ml-2" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="prose prose-sm prose-invert max-w-none font-mono text-xs leading-relaxed">
                <ReactMarkdown>{output}</ReactMarkdown>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
