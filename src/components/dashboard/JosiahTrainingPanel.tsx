import { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Brain, Sparkles, RefreshCw, BookOpen, Database, History } from 'lucide-react';

type MemoryType = 'sacred' | 'belief' | 'pattern' | 'reflection' | 'hypothesis' | 'timeline';

const MEMORY_OPTIONS: Array<{ value: MemoryType; label: string; hint: string }> = [
  { value: 'sacred',     label: 'Sacred Memory',     hint: 'Foundational truth Josiah must never forget' },
  { value: 'belief',     label: 'Belief',            hint: 'Validated hypothesis or stance' },
  { value: 'pattern',    label: 'Learned Pattern',   hint: 'Recurring signal/signature' },
  { value: 'reflection', label: 'Reflection',        hint: 'In-the-moment note or observation' },
  { value: 'hypothesis', label: 'Hypothesis',        hint: 'Open investigative question' },
  { value: 'timeline',   label: 'Timeline Event',    hint: 'Chronological milestone' },
];

interface RecentItem { label: string; sub: string; ts?: string; }

export const JosiahTrainingPanel = () => {
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [memoryType, setMemoryType] = useState<MemoryType>('sacred');
  const [submitting, setSubmitting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const ingest = async () => {
    if (content.trim().length < 5) {
      toast({ title: 'Needs more context', description: 'Please write at least a sentence.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('josiah-training-ingest', {
        body: {
          action: 'ingest',
          content: content.trim(),
          memory_type: memoryType,
          title: title.trim() || undefined,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({ title: 'Josiah remembers', description: data?.message || 'Persisted to Neon memory.' });
      setContent(''); setTitle(''); setTags('');
      void loadRecent();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Ingestion failed', description: msg, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const seedRebuild = async () => {
    setSeeding(true);
    try {
      const { data, error } = await supabase.functions.invoke('josiah-training-ingest', {
        body: { action: 'seed_rebuild' },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({
        title: 'Rebuild context seeded',
        description: `${data?.sacred_memories_created || 0} sacred memories + ${data?.beliefs_created || 0} beliefs written. Josiah now remembers Watchtower across resets.`,
      });
      void loadRecent();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Seed failed', description: msg, variant: 'destructive' });
    } finally {
      setSeeding(false);
    }
  };

  const loadRecent = async () => {
    setLoadingRecent(true);
    try {
      const { data, error } = await supabase.functions.invoke('josiah-training-ingest', {
        body: { action: 'list' },
      });
      if (error) throw new Error(error.message);
      const items: RecentItem[] = [];
      (data?.sacred || []).slice(0, 8).forEach((s: any) =>
        items.push({ label: `🜂 ${s.event_type}`, sub: s.sacred_context?.slice(0, 140) ?? '', ts: s.created_at }));
      (data?.beliefs || []).slice(0, 8).forEach((b: any) =>
        items.push({ label: `◈ belief (${Number(b.confidence_score).toFixed(2)})`, sub: b.hypothesis_text?.slice(0, 140) ?? '', ts: b.last_updated }));
      (data?.timeline || []).slice(0, 6).forEach((t: any) =>
        items.push({ label: `⌛ ${t.event_type}`, sub: t.reflection_title ?? '', ts: t.event_timestamp }));
      items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
      setRecent(items.slice(0, 18));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingRecent(false);
    }
  };

  return (
    <CyberPanel title="JOSIAH TRAINING & MEMORY INGESTION" icon={<Brain className="h-5 w-5" />}>
      <div className="space-y-4">
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
          Anything written here is persisted to Josiah&apos;s Neon memory tables and survives infrastructure resets.
          Use <span className="text-primary font-mono">Seed Rebuild Context</span> once to restore his core awareness of Watchtower.
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={seedRebuild} disabled={seeding} variant="outline" className="border-primary/40">
            <Sparkles className={`h-4 w-4 mr-2 ${seeding ? 'animate-spin' : ''}`} />
            {seeding ? 'Seeding…' : 'Seed Rebuild Context'}
          </Button>
          <Button onClick={loadRecent} disabled={loadingRecent} variant="ghost" size="sm">
            <History className={`h-4 w-4 mr-2 ${loadingRecent ? 'animate-spin' : ''}`} />
            Load Recent Memories
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Memory Type</label>
            <Select value={memoryType} onValueChange={(v) => setMemoryType(v as MemoryType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MEMORY_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    <div className="flex flex-col">
                      <span>{o.label}</span>
                      <span className="text-[10px] text-muted-foreground">{o.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Title (optional)</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. KCSO N912KC pattern" />
          </div>
        </div>

        <div>
          <label className="text-xs font-mono text-muted-foreground mb-1 block">What should Josiah remember?</label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="Teach Josiah something. Context, evidence, a correction, a relationship he missed, a foundational truth..."
            className="font-mono text-sm"
          />
        </div>

        <div>
          <label className="text-xs font-mono text-muted-foreground mb-1 block">Tags (comma-separated, optional)</label>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="kcso, shell-network, biometric" />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Database className="h-3 w-3" /> Writes to: <span className="font-mono text-primary">josiah_{memoryType === 'sacred' ? 'sacred_memory' : memoryType === 'belief' ? 'beliefs' : memoryType === 'pattern' ? 'learned_patterns' : memoryType === 'reflection' ? 'reflections_rows' : memoryType === 'hypothesis' ? 'hypotheses' : 'timeline_events'}</span>
          </span>
          <Button onClick={ingest} disabled={submitting || content.trim().length < 5}>
            {submitting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <BookOpen className="h-4 w-4 mr-2" />}
            Teach Josiah
          </Button>
        </div>

        {recent.length > 0 && (
          <div className="border-t border-border/30 pt-3">
            <div className="text-xs font-mono text-muted-foreground mb-2">Recent persisted memories</div>
            <ScrollArea className="h-48">
              <div className="space-y-2">
                {recent.map((r, i) => (
                  <div key={i} className="rounded border border-border/40 bg-background/30 p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-[10px]">{r.label}</Badge>
                      {r.ts && <span className="text-[10px] text-muted-foreground">{new Date(r.ts).toLocaleString()}</span>}
                    </div>
                    <div className="mt-1 text-muted-foreground line-clamp-2">{r.sub}</div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </CyberPanel>
  );
};
