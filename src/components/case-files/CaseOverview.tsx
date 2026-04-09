import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Loader2, Scale, Shield, Plane, Users } from "lucide-react";

interface Case {
  case_id: string;
  case_code: string;
  case_name: string;
  legal_theory: string;
  statute_cited: string | null;
  description: string | null;
  status: string;
  priority: number;
}

const caseIcons: Record<string, React.ReactNode> = {
  'RICO': <Scale className="w-5 h-5" />,
  'Posse Comitatus': <Shield className="w-5 h-5" />,
  'FAA Regulatory': <Plane className="w-5 h-5" />,
  'Civil Rights': <Users className="w-5 h-5" />,
};

const caseColors: Record<string, string> = {
  'RICO': 'border-destructive/40 bg-destructive/5',
  'Posse Comitatus': 'border-orange-500/40 bg-orange-500/5',
  'FAA Regulatory': 'border-yellow-500/40 bg-yellow-500/5',
  'Civil Rights': 'border-primary/40 bg-primary/5',
};

export function CaseOverview() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [exhibitCounts, setExhibitCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const load = async () => {
      const [casesRes, exhibitsRes] = await Promise.all([
        supabase.from('cases').select('*').order('priority'),
        supabase.from('exhibits').select('case_id'),
      ]);
      if (casesRes.data) setCases(casesRes.data as unknown as Case[]);
      if (exhibitsRes.data) {
        const counts: Record<string, number> = {};
        (exhibitsRes.data as unknown as { case_id: string }[]).forEach(e => {
          counts[e.case_id] = (counts[e.case_id] || 0) + 1;
        });
        setExhibitCounts(counts);
      }
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <h2 className="font-mono text-sm text-muted-foreground uppercase tracking-widest">Active Cases</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {cases.map(c => (
          <div key={c.case_id} className={`rounded-lg border p-4 space-y-3 ${caseColors[c.legal_theory] || 'border-border bg-muted/10'}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {caseIcons[c.legal_theory]}
                <Badge variant="outline" className="font-mono text-[10px]">{c.case_code}</Badge>
              </div>
              <Badge variant={c.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                {c.status}
              </Badge>
            </div>
            <div>
              <h3 className="text-sm font-bold">{c.case_name}</h3>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{c.statute_cited}</p>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-3">{c.description}</p>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Priority: {c.priority}</span>
              <span className="font-mono">{exhibitCounts[c.case_id] || 0} exhibits</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
