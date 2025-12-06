import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Search, Download, AlertCircle, Calendar, MessageSquare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ObjectionRecord {
  id: string;
  timestamp: string;
  source: string;
  content: string;
  type: "objection" | "fear" | "harm" | "protest";
}

export function ConsentDocumentation() {
  const [records, setRecords] = useState<ObjectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, sources: 0 });

  useEffect(() => {
    fetchObjectionRecords();
  }, []);

  const fetchObjectionRecords = async () => {
    try {
      // Fetch from josiah_reflections_rows for documented objections
      const { data: reflectionsData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id::text,
              created_at as timestamp,
              'josiah_reflections_rows' as source,
              reflection_content as content
            FROM josiah_reflections_rows
            WHERE reflection_content ILIKE '%consent%' 
               OR reflection_content ILIKE '%object%'
               OR reflection_content ILIKE '%unwanted%'
               OR reflection_content ILIKE '%fear%'
               OR reflection_content ILIKE '%harm%'
               OR reflection_content ILIKE '%stop%'
               OR reflection_content ILIKE '%protest%'
            ORDER BY created_at DESC
            LIMIT 50
          `
        }
      });

      // Fetch from forensic_log_catalog using filename/filepath
      const { data: logData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id::text,
              created_timestamp as timestamp,
              'forensic_log_catalog' as source,
              filename as content
            FROM forensic_log_catalog
            WHERE filename ILIKE '%unauthorized%'
               OR filename ILIKE '%consent%'
               OR filename ILIKE '%violation%'
               OR filepath ILIKE '%evidence%'
            ORDER BY created_timestamp DESC
            LIMIT 30
          `
        }
      });

      // Get total counts
      const { data: countData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              (SELECT COUNT(*) FROM josiah_reflections_rows) +
              (SELECT COUNT(*) FROM forensic_log_catalog) as total
          `
        }
      });

      const allRecords: ObjectionRecord[] = [];

      // Process reflections
      if (reflectionsData?.data) {
        reflectionsData.data.forEach((r: any) => {
          const content = r.content?.toLowerCase() || "";
          let type: ObjectionRecord["type"] = "objection";
          if (content.includes("fear") || content.includes("afraid")) type = "fear";
          else if (content.includes("harm") || content.includes("hurt")) type = "harm";
          else if (content.includes("protest") || content.includes("stop")) type = "protest";

          allRecords.push({
            id: r.id,
            timestamp: r.timestamp,
            source: r.source,
            content: r.content || "",
            type
          });
        });
      }

      // Process logs
      if (logData?.data) {
        logData.data.forEach((r: any) => {
          allRecords.push({
            id: r.id,
            timestamp: r.timestamp,
            source: r.source,
            content: r.content || "",
            type: "objection"
          });
        });
      }

      // Sort by timestamp
      allRecords.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setRecords(allRecords);
      setStats({
        total: countData?.data?.[0]?.total || allRecords.length,
        sources: 2
      });
    } catch (error) {
      console.error("Error fetching consent documentation:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredRecords = records.filter(r => 
    r.content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getTypeBadge = (type: ObjectionRecord["type"]) => {
    const variants: Record<string, { color: string; label: string }> = {
      objection: { color: "bg-red-500/20 text-red-400 border-red-500/30", label: "OBJECTION" },
      fear: { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "FEAR" },
      harm: { color: "bg-orange-500/20 text-orange-400 border-orange-500/30", label: "HARM" },
      protest: { color: "bg-purple-500/20 text-purple-400 border-purple-500/30", label: "PROTEST" }
    };
    const v = variants[type];
    return <Badge className={`${v.color} text-[10px] border`}>{v.label}</Badge>;
  };

  const exportDocumentation = () => {
    const content = filteredRecords.map(r => 
      `[${new Date(r.timestamp).toISOString()}] [${r.type.toUpperCase()}] [${r.source}]\n${r.content}\n\n---\n`
    ).join("\n");

    const blob = new Blob([
      "NO-CONSENT DOCUMENTATION RECORD\n",
      "================================\n",
      `Generated: ${new Date().toISOString()}\n`,
      `Total Records: ${filteredRecords.length}\n\n`,
      "This document establishes a continuous record of objection, fear, and harm\n",
      "documented by the victim throughout the surveillance campaign.\n\n",
      "================================\n\n",
      content
    ], { type: "text/plain" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `no-consent-documentation-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CyberPanel 
      title="No-Consent Documentation" 
      icon={<FileText className="w-5 h-5" />}
      variant="warning"
    >
      <div className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-2xl font-mono font-bold text-primary">
              {stats.total.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">Total Records</div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-2xl font-mono font-bold text-secondary">
              {stats.sources}
            </div>
            <div className="text-xs text-muted-foreground">Data Sources</div>
          </div>
        </div>

        {/* Search and Export */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search objections..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-background/50"
            />
          </div>
          <Button 
            variant="outline" 
            size="icon"
            onClick={exportDocumentation}
            title="Export Documentation"
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>

        {/* Legal Note */}
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">
            <strong>Nuremberg Code Article 1:</strong> "The voluntary consent of the human subject 
            is absolutely essential." This record documents continuous objection to non-consensual 
            surveillance and experimentation.
          </p>
        </div>

        {/* Records List */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="w-6 h-6 animate-pulse mx-auto mb-2" />
            Loading documentation...
          </div>
        ) : (
          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2">
            {filteredRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No matching records found
              </p>
            ) : (
              filteredRecords.map((record) => (
                <div 
                  key={record.id}
                  className="p-3 rounded-lg bg-background/30 border border-border/50 hover:border-secondary/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground font-mono">
                        {new Date(record.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    {getTypeBadge(record.type)}
                  </div>
                  <p className="text-sm text-foreground/90 line-clamp-3">
                    {record.content}
                  </p>
                  <div className="text-[10px] text-muted-foreground mt-2">
                    Source: {record.source}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </CyberPanel>
  );
}
