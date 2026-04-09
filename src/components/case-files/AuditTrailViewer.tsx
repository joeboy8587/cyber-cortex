import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, ClipboardList } from "lucide-react";

interface AuditEntry {
  audit_id: string;
  action: string;
  rule_applied: string | null;
  records_evaluated: number | null;
  records_promoted: number | null;
  performed_by: string;
  performed_at: string;
}

export function AuditTrailViewer() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('exhibit_audit_trail')
      .select('*')
      .order('performed_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setEntries(data as unknown as AuditEntry[]);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="border border-border rounded-lg p-4 space-y-4">
      <h2 className="font-mono text-sm text-muted-foreground uppercase tracking-widest flex items-center gap-2">
        <ClipboardList className="w-4 h-4" /> Audit Trail
      </h2>

      {entries.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground space-y-2">
          <ClipboardList className="w-10 h-10 mx-auto opacity-30" />
          <p className="text-sm">No audit entries yet</p>
          <p className="text-xs">Every promotion, filter, and export operation will be logged here with SHA-256 verification</p>
        </div>
      ) : (
        <ScrollArea className="h-[300px]">
          <div className="space-y-1 pr-4">
            {entries.map(e => (
              <div key={e.audit_id} className="flex items-center gap-3 p-2 rounded bg-muted/10 text-xs">
                <span className="text-muted-foreground w-36 flex-shrink-0">
                  {e.performed_at?.slice(0, 19).replace('T', ' ')}
                </span>
                <Badge variant="outline" className="text-[9px]">{e.action}</Badge>
                {e.rule_applied && <span className="font-mono text-[10px]">{e.rule_applied}</span>}
                <span className="ml-auto text-muted-foreground">{e.performed_by}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
