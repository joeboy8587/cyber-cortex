import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Filter } from "lucide-react";

interface PromotionRule {
  rule_id: string;
  rule_name: string;
  rule_category: string;
  sql_condition: string;
  priority: number;
  description: string | null;
  is_active: boolean;
}

const categoryColors: Record<string, string> = {
  'altitude_trigger': 'bg-destructive/10 text-destructive border-destructive/30',
  'flag_indicator': 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  'severity_level': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
  'temporal_proximity': 'bg-primary/10 text-primary border-primary/30',
};

export function PromotionRulesPanel() {
  const [rules, setRules] = useState<PromotionRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('promotion_rules').select('*').order('priority').then(({ data }) => {
      if (data) setRules(data as unknown as PromotionRule[]);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm text-muted-foreground uppercase tracking-widest flex items-center gap-2">
          <Filter className="w-4 h-4" /> Promotion Rules ({rules.length})
        </h2>
        <p className="text-[10px] text-muted-foreground">
          Objective criteria that promote Universe records → Exhibits
        </p>
      </div>

      <ScrollArea className="h-[350px]">
        <div className="space-y-2 pr-4">
          {rules.map(r => (
            <div key={r.rule_id} className="border border-border rounded p-3 flex items-start gap-4">
              <div className="flex-shrink-0 w-8 text-center">
                <span className="font-mono text-lg font-bold text-primary">{r.priority}</span>
                <p className="text-[8px] text-muted-foreground">PRI</p>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{r.rule_name}</span>
                  <Badge variant="outline" className={`text-[9px] ${categoryColors[r.rule_category] || ''}`}>
                    {r.rule_category.replace('_', ' ')}
                  </Badge>
                  {!r.is_active && <Badge variant="secondary" className="text-[9px]">INACTIVE</Badge>}
                </div>
                <code className="block text-[11px] font-mono text-muted-foreground bg-muted/30 rounded px-2 py-1">
                  {r.sql_condition}
                </code>
                {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
