import { useState } from "react";
import { Upload, CheckCircle2, Loader2, AlertTriangle, Database } from "lucide-react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BATCH_SIZE = 200;

interface ImportProgress {
  total: number;
  imported: number;
  failed: number;
  status: "idle" | "parsing" | "importing" | "done" | "error";
}

export default function FlaggedAircraftImporter() {
  const [progress, setProgress] = useState<ImportProgress>({
    total: 0, imported: 0, failed: 0, status: "idle",
  });

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === "," && !inQuotes) { result.push(current.trim()); current = ""; }
      else { current += char; }
    }
    result.push(current.trim());
    return result;
  };

  const importFromPublicCSV = async () => {
    setProgress({ total: 0, imported: 0, failed: 0, status: "parsing" });

    try {
      const response = await fetch("/data/flagged_aircraft_rows_rows.csv");
      if (!response.ok) throw new Error("CSV file not found");
      const text = await response.text();
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      const headers = parseCSVLine(lines[0]);
      const dataLines = lines.slice(1);

      setProgress((p) => ({ ...p, total: dataLines.length, status: "importing" }));

      let imported = 0;
      let failed = 0;

      for (let i = 0; i < dataLines.length; i += BATCH_SIZE) {
        const batch = dataLines.slice(i, i + BATCH_SIZE).map((line) => {
          const vals = parseCSVLine(line);
          const row: Record<string, string | number | null> = {};
          headers.forEach((h, idx) => {
            const v = vals[idx] || null;
            if (h === "id" && v) row[h] = parseInt(v);
            else if ((h === "lat" || h === "lon" || h === "alt") && v) row[h] = parseFloat(v);
            else row[h] = v;
          });
          return row;
        });

        try {
          const { data, error } = await supabase.functions.invoke("neon-query", {
            body: { action: "batchInsert", table: "flagged_aircraft_rows_rows", data: batch },
          });
          if (error) { failed += batch.length; console.error("Batch error:", error); }
          else { imported += batch.length; }
        } catch {
          failed += batch.length;
        }

        setProgress((p) => ({ ...p, imported, failed }));
      }

      setProgress((p) => ({ ...p, status: "done" }));
      toast.success(`Imported ${imported.toLocaleString()} flagged aircraft records`);
    } catch (err) {
      console.error("Import failed:", err);
      setProgress((p) => ({ ...p, status: "error" }));
      toast.error("Import failed: " + (err as Error).message);
    }
  };

  const pct = progress.total > 0 ? Math.round((progress.imported / progress.total) * 100) : 0;

  return (
    <CyberPanel
      title="FLAGGED AIRCRAFT DATA IMPORT"
      icon={<Database className="text-warning" />}
      className="col-span-full"
    >
      <div className="space-y-4">
        <div className="bg-card/50 border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground mb-3">
            Import 35,512 flagged aircraft records from the archived CSV into the Neon database.
            This restores the <code className="text-primary">flagged_aircraft_rows_rows</code> table
            used by dashboard counts and threat analytics.
          </p>

          {progress.status === "idle" && (
            <Button onClick={importFromPublicCSV} className="gap-2">
              <Upload className="h-4 w-4" />
              Import Flagged Aircraft CSV
            </Button>
          )}

          {(progress.status === "parsing" || progress.status === "importing") && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm">
                  {progress.status === "parsing" ? "Parsing CSV..." : `Importing... ${progress.imported.toLocaleString()} / ${progress.total.toLocaleString()}`}
                </span>
              </div>
              <Progress value={pct} className="h-2" />
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Progress: {pct}%</span>
                <span>Imported: {progress.imported.toLocaleString()}</span>
                {progress.failed > 0 && <span className="text-destructive">Failed: {progress.failed}</span>}
              </div>
            </div>
          )}

          {progress.status === "done" && (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <span className="text-sm text-success font-medium">
                Import complete: {progress.imported.toLocaleString()} records imported
              </span>
              {progress.failed > 0 && (
                <Badge variant="destructive">{progress.failed} failed</Badge>
              )}
            </div>
          )}

          {progress.status === "error" && (
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span className="text-sm text-destructive">Import failed. Check console for details.</span>
              <Button variant="outline" size="sm" onClick={importFromPublicCSV}>Retry</Button>
            </div>
          )}
        </div>
      </div>
    </CyberPanel>
  );
}
