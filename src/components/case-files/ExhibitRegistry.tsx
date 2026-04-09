import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, FileText } from "lucide-react";

interface Exhibit {
  exhibit_id: string;
  exhibit_code: string;
  exhibit_name: string;
  tier: number;
  evidence_type: string | null;
  description: string | null;
  legal_significance: string | null;
  file_count: number;
  status: string;
  case_id: string;
}

interface Case {
  case_id: string;
  case_code: string;
}

const tierLabels: Record<number, { label: string; color: string }> = {
  1: { label: 'SMOKING GUN', color: 'bg-destructive text-destructive-foreground' },
  2: { label: 'PATTERN', color: 'bg-orange-500 text-white' },
  3: { label: 'COMPLICITY', color: 'bg-yellow-500 text-black' },
  4: { label: 'SUPPORTING', color: 'bg-muted text-muted-foreground' },
};

export function ExhibitRegistry() {
  const [exhibits, setExhibits] = useState<Exhibit[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTier, setFilterTier] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      const [exRes, caseRes] = await Promise.all([
        supabase.from('exhibits').select('*').order('tier').order('exhibit_code'),
        supabase.from('cases').select('case_id, case_code'),
      ]);
      if (exRes.data) setExhibits(exRes.data as unknown as Exhibit[]);
      if (caseRes.data) setCases(caseRes.data as unknown as Case[]);
      setLoading(false);
    };
    load();
  }, []);

  const getCaseCode = (caseId: string) => cases.find(c => c.case_id === caseId)?.case_code || '';
  const filtered = filterTier ? exhibits.filter(e => e.tier === filterTier) : exhibits;

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm text-muted-foreground uppercase tracking-widest flex items-center gap-2">
          <FileText className="w-4 h-4" /> Exhibit Registry ({exhibits.length})
        </h2>
        <div className="flex gap-1.5">
          <Badge
            variant={filterTier === null ? "default" : "outline"}
            className="cursor-pointer text-[10px]"
            onClick={() => setFilterTier(null)}
          >ALL</Badge>
          {[1, 2, 3, 4].map(t => (
            <Badge
              key={t}
              variant={filterTier === t ? "default" : "outline"}
              className="cursor-pointer text-[10px]"
              onClick={() => setFilterTier(t)}
            >T{t}</Badge>
          ))}
        </div>
      </div>

      <ScrollArea className="h-[500px]">
        <div className="space-y-2 pr-4">
          {filtered.map(ex => {
            const tier = tierLabels[ex.tier] || tierLabels[4];
            return (
              <div key={ex.exhibit_id} className="border border-border rounded p-3 space-y-2 hover:bg-muted/10 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-primary">{ex.exhibit_code}</span>
                    <Badge className={`text-[9px] ${tier.color}`}>{tier.label}</Badge>
                    <Badge variant="outline" className="text-[9px]">{getCaseCode(ex.case_id)}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-mono">{ex.file_count?.toLocaleString()} files</span>
                    <Badge variant={ex.status === 'draft' ? 'secondary' : 'default'} className="text-[9px]">{ex.status}</Badge>
                  </div>
                </div>
                <h3 className="text-sm font-semibold">{ex.exhibit_name}</h3>
                {ex.description && <p className="text-xs text-muted-foreground">{ex.description}</p>}
                {ex.legal_significance && (
                  <p className="text-xs text-primary/80 italic">⚖️ {ex.legal_significance}</p>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
