import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, Search, Link2, Ghost, Plane, Shield, AlertTriangle, RefreshCw, Plus, Database } from 'lucide-react';

interface UnifiedIdentity {
  id: string;
  canonical: string;
  type: 'aircraft' | 'operator' | 'shell_company' | 'agency';
  aliases: string[];
  threatClass: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  sources: string[];
  linkedEvents: number;
  metadata: Record<string, unknown>;
}

interface NeonCallsignMatch {
  registration: string;
  hex: string | null;
  callsign: string | null;
  detections: number;
  minAlt: number | null;
  maxAlt: number | null;
  firstDetected: string;
  lastDetected: string;
  tables: string[];
}

interface MergeCandidate {
  groupKey: string;
  identifiers: string[];
  sources: string[];
  confidence: number;
  reason: string;
}

export default function CrossCallsignTracker() {
  const [searchQuery, setSearchQuery] = useState('');
  const [entities, setEntities] = useState<UnifiedIdentity[]>([]);
  const [neonMatches, setNeonMatches] = useState<NeonCallsignMatch[]>([]);
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [stats, setStats] = useState({ entities: 0, aliases: 0, threats: 0, ghostFlags: 0 });

  const loadStats = useCallback(async () => {
    try {
      const [entityRes, threatRes, flagRes] = await Promise.all([
        supabase.from('entity_registry').select('entity_id, aliases', { count: 'exact' }),
        supabase.from('sentinel_learned_threats').select('id', { count: 'exact' }),
        supabase.from('watchtower_autonomous_flags').select('id', { count: 'exact' }).eq('flag_type', 'GHOST_AIRCRAFT_XXB_QUARANTINED'),
      ]);

      const ents = entityRes.data || [];
      const totalAliases = ents.reduce((sum, e) => sum + (e.aliases?.length || 0), 0);

      setStats({
        entities: entityRes.count || 0,
        aliases: totalAliases,
        threats: threatRes.count || 0,
        ghostFlags: flagRes.count || 0,
      });
    } catch (err) {
      console.error('Stats load error:', err);
    }
  }, []);

  const searchEntities = useCallback(async () => {
    if (!searchQuery.trim()) {
      toast.error('Enter a callsign, N-number, or hex code');
      return;
    }
    setLoading(true);
    try {
      const q = searchQuery.trim().toUpperCase();

      // Search entity_registry by canonical_identifier or aliases
      const { data: entityData } = await supabase
        .from('entity_registry')
        .select('*')
        .or(`canonical_identifier.ilike.%${q}%`);

      const mapped: UnifiedIdentity[] = (entityData || []).map((e: any) => ({
        id: e.entity_id,
        canonical: e.canonical_identifier,
        type: e.entity_type,
        aliases: e.aliases || [],
        threatClass: e.threat_classification,
        firstSeen: e.first_seen,
        lastSeen: e.last_seen,
        sources: Array.isArray(e.source_tables) ? e.source_tables : [],
        linkedEvents: e.linked_forensic_events?.length || 0,
        metadata: (e.metadata as Record<string, unknown>) || {},
      }));

      // Also search by alias match
      const { data: aliasData } = await supabase
        .from('entity_registry')
        .select('*');

      const aliasMatches = (aliasData || [])
        .filter((e: any) => (e.aliases || []).some((a: string) => a.toUpperCase().includes(q)))
        .filter((e: any) => !mapped.some(m => m.id === e.entity_id))
        .map((e: any) => ({
          id: e.entity_id,
          canonical: e.canonical_identifier,
          type: e.entity_type,
          aliases: e.aliases || [],
          threatClass: e.threat_classification,
          firstSeen: e.first_seen,
          lastSeen: e.last_seen,
          sources: Array.isArray(e.source_tables) ? e.source_tables : [],
          linkedEvents: e.linked_forensic_events?.length || 0,
          metadata: (e.metadata as Record<string, unknown>) || {},
        }));

      setEntities([...mapped, ...aliasMatches]);

      // Search Neon archive for cross-table callsign matches
      const { data: neonData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT registration, hex, callsign, COUNT(*) as detections,
                   MIN(alt::numeric) as min_alt, MAX(alt::numeric) as max_alt,
                   MIN(created_at) as first_detected, MAX(created_at) as last_detected,
                   'live_flight_detections_rows' as source_table
            FROM live_flight_detections_rows
            WHERE UPPER(registration) LIKE '%${q}%'
               OR UPPER(hex) LIKE '%${q}%'
               OR UPPER(callsign) LIKE '%${q}%'
            GROUP BY registration, hex, callsign
            UNION ALL
            SELECT registration, icao_code as hex, callsign, COUNT(*) as detections,
                   MIN(altitude::numeric) as min_alt, MAX(altitude::numeric) as max_alt,
                   MIN(created_at) as first_detected, MAX(created_at) as last_detected,
                   'flagged_aircraft_rows_rows' as source_table
            FROM flagged_aircraft_rows_rows
            WHERE UPPER(registration) LIKE '%${q}%'
               OR UPPER(icao_code) LIKE '%${q}%'
               OR UPPER(callsign) LIKE '%${q}%'
            GROUP BY registration, icao_code, callsign
            ORDER BY detections DESC
            LIMIT 50
          `
        }
      });

      if (neonData?.data) {
        const grouped = new Map<string, NeonCallsignMatch>();
        for (const row of neonData.data) {
          const key = (row.registration || row.hex || 'UNKNOWN').toUpperCase();
          const existing = grouped.get(key);
          if (existing) {
            existing.detections += Number(row.detections) || 0;
            if (row.source_table && !existing.tables.includes(row.source_table)) {
              existing.tables.push(row.source_table);
            }
          } else {
            grouped.set(key, {
              registration: row.registration || '',
              hex: row.hex || null,
              callsign: row.callsign || null,
              detections: Number(row.detections) || 0,
              minAlt: row.min_alt ? Number(row.min_alt) : null,
              maxAlt: row.max_alt ? Number(row.max_alt) : null,
              firstDetected: row.first_detected || '',
              lastDetected: row.last_detected || '',
              tables: [row.source_table],
            });
          }
        }
        setNeonMatches(Array.from(grouped.values()));
      }

      toast.success(`Found ${mapped.length + aliasMatches.length} entities, ${neonData?.data?.length || 0} archive matches`);
    } catch (err) {
      console.error('Search error:', err);
      toast.error('Search failed');
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  const scanMergeCandidates = useCallback(async () => {
    setScanLoading(true);
    try {
      // Pull all entities and look for merge opportunities
      const { data: allEntities } = await supabase.from('entity_registry').select('*');
      const { data: threats } = await supabase.from('sentinel_learned_threats').select('registration, threat_type');
      const { data: flags } = await supabase.from('watchtower_autonomous_flags').select('registration, flag_type, description');

      const candidates: MergeCandidate[] = [];

      // Find threats not yet in entity_registry
      const entityIds = new Set((allEntities || []).map((e: any) => e.canonical_identifier?.toUpperCase()));

      for (const t of (threats || [])) {
        if (!entityIds.has(t.registration?.toUpperCase())) {
          candidates.push({
            groupKey: t.registration,
            identifiers: [t.registration],
            sources: ['sentinel_learned_threats'],
            confidence: 70,
            reason: `Threat "${t.threat_type}" not linked to entity registry`,
          });
        }
      }

      // Find ghost-flagged aircraft not in entity_registry
      for (const f of (flags || [])) {
        if (f.registration && !entityIds.has(f.registration.toUpperCase())) {
          const existing = candidates.find(c => c.groupKey === f.registration);
          if (existing) {
            existing.sources.push('watchtower_autonomous_flags');
            existing.confidence += 10;
            existing.reason += ` + Ghost flag: ${f.flag_type}`;
          } else {
            candidates.push({
              groupKey: f.registration,
              identifiers: [f.registration],
              sources: ['watchtower_autonomous_flags'],
              confidence: 65,
              reason: `Ghost flag "${f.flag_type}" — not in entity registry`,
            });
          }
        }
      }

      // Known military callsign patterns to auto-detect
      const milPatterns = [
        { prefix: 'RCH', type: 'REACH Military Airlift' },
        { prefix: 'KOME', type: 'DRON/UAV Operations' },
        { prefix: 'KOMEG', type: 'DRON/UAV Operations' },
        { prefix: 'MMF', type: 'Military Mobility Flight' },
      ];

      // Scan Neon for military callsigns not yet tracked
      const { data: milData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'custom_query',
          query: `
            SELECT callsign, COUNT(*) as cnt
            FROM live_flight_detections_rows
            WHERE callsign ~ '^(RCH|KOME|KOMEG|MMF)'
            GROUP BY callsign
            ORDER BY cnt DESC
            LIMIT 30
          `
        }
      });

      for (const row of (milData?.data || [])) {
        const cs = row.callsign;
        if (!entityIds.has(cs?.toUpperCase())) {
          const matched = milPatterns.find(p => cs?.startsWith(p.prefix));
          candidates.push({
            groupKey: cs,
            identifiers: [cs],
            sources: ['live_flight_detections_rows'],
            confidence: 85,
            reason: `Military callsign (${matched?.type || 'unknown'}) with ${row.cnt} detections — not in entity registry`,
          });
        }
      }

      setMergeCandidates(candidates);
      toast.success(`Discovered ${candidates.length} unlinked identities`);
    } catch (err) {
      console.error('Scan error:', err);
      toast.error('Scan failed');
    } finally {
      setScanLoading(false);
    }
  }, []);

  const promoteToEntity = useCallback(async (candidate: MergeCandidate) => {
    try {
      const milPrefixes = ['RCH', 'KOME', 'KOMEG', 'MMF', 'EVAC', 'SAM'];
      const isMilitary = milPrefixes.some(p => candidate.groupKey?.startsWith(p));

      const { error } = await supabase.from('entity_registry').insert({
        canonical_identifier: candidate.groupKey,
        entity_type: isMilitary ? 'agency' : 'aircraft',
        aliases: candidate.identifiers,
        source_tables: candidate.sources as any,
        threat_classification: isMilitary ? 'military_tracked' : 'unclassified',
        metadata: { auto_promoted: true, confidence: candidate.confidence, reason: candidate.reason } as any,
      });

      if (error) throw error;
      toast.success(`Promoted ${candidate.groupKey} to entity registry`);
      setMergeCandidates(prev => prev.filter(c => c.groupKey !== candidate.groupKey));
      loadStats();
    } catch (err) {
      console.error('Promote error:', err);
      toast.error('Failed to promote entity');
    }
  }, [loadStats]);

  // Load stats on mount
  useState(() => { loadStats(); });

  return (
    <Card className="border-primary/30 bg-card/80">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
              <Link2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="font-display text-lg uppercase tracking-wider text-primary">
                Cross-Callsign Tracker
              </CardTitle>
              <p className="font-mono text-xs text-muted-foreground">
                UNIFIED IDENTITY RESOLUTION // N-NUMBER ↔ HEX ↔ CALLSIGN ↔ GHOST
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadStats} className="font-mono text-xs">
              <RefreshCw className="w-3 h-3 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          {[
            { label: 'Entities', value: stats.entities, icon: Database, color: 'text-primary' },
            { label: 'Aliases', value: stats.aliases, icon: Link2, color: 'text-chart-2' },
            { label: 'Threats', value: stats.threats, icon: AlertTriangle, color: 'text-destructive' },
            { label: 'Ghost Flags', value: stats.ghostFlags, icon: Ghost, color: 'text-chart-4' },
          ].map(s => (
            <div key={s.label} className="rounded border border-border/50 bg-muted/30 p-3 text-center">
              <s.icon className={`w-4 h-4 mx-auto mb-1 ${s.color}`} />
              <div className={`font-mono text-lg font-bold ${s.color}`}>{s.value}</div>
              <div className="font-mono text-[10px] text-muted-foreground uppercase">{s.label}</div>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Search */}
        <div className="flex gap-2">
          <Input
            placeholder="Search N-number, hex, callsign (e.g. N786FA, KOME6670, RCH180)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchEntities()}
            className="font-mono text-sm"
          />
          <Button onClick={searchEntities} disabled={loading} className="font-mono text-xs">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
            Search
          </Button>
          <Button variant="outline" onClick={scanMergeCandidates} disabled={scanLoading} className="font-mono text-xs">
            {scanLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4 mr-1" />}
            Scan Unlinked
          </Button>
        </div>

        <Tabs defaultValue="results" className="space-y-4">
          <TabsList className="grid grid-cols-3 bg-muted/30">
            <TabsTrigger value="results" className="font-mono text-xs">
              Entity Results ({entities.length})
            </TabsTrigger>
            <TabsTrigger value="archive" className="font-mono text-xs">
              Archive Matches ({neonMatches.length})
            </TabsTrigger>
            <TabsTrigger value="unlinked" className="font-mono text-xs">
              Unlinked ({mergeCandidates.length})
            </TabsTrigger>
          </TabsList>

          {/* Entity Registry Results */}
          <TabsContent value="results">
            {entities.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground font-mono text-sm">
                Search for a callsign to find unified identities
              </div>
            ) : (
              <div className="rounded border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="font-mono text-xs">Canonical ID</TableHead>
                      <TableHead className="font-mono text-xs">Type</TableHead>
                      <TableHead className="font-mono text-xs">Aliases</TableHead>
                      <TableHead className="font-mono text-xs">Threat</TableHead>
                      <TableHead className="font-mono text-xs">Events</TableHead>
                      <TableHead className="font-mono text-xs">First Seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-sm font-bold text-primary">{e.canonical}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {e.type === 'aircraft' && <Plane className="w-3 h-3 mr-1" />}
                            {e.type === 'agency' && <Shield className="w-3 h-3 mr-1" />}
                            {e.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {e.aliases.slice(0, 5).map(a => (
                              <Badge key={a} variant="secondary" className="font-mono text-[10px]">{a}</Badge>
                            ))}
                            {e.aliases.length > 5 && (
                              <Badge variant="secondary" className="font-mono text-[10px]">+{e.aliases.length - 5}</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {e.threatClass ? (
                            <Badge variant="destructive" className="font-mono text-[10px]">{e.threatClass}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{e.linkedEvents}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {e.firstSeen ? new Date(e.firstSeen).toLocaleDateString() : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Neon Archive Matches */}
          <TabsContent value="archive">
            {neonMatches.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground font-mono text-sm">
                Search to find cross-table archive matches
              </div>
            ) : (
              <div className="rounded border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="font-mono text-xs">Registration</TableHead>
                      <TableHead className="font-mono text-xs">Hex</TableHead>
                      <TableHead className="font-mono text-xs">Callsign</TableHead>
                      <TableHead className="font-mono text-xs">Detections</TableHead>
                      <TableHead className="font-mono text-xs">Alt Range</TableHead>
                      <TableHead className="font-mono text-xs">Tables</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {neonMatches.map((m, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-sm font-bold text-primary">{m.registration || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{m.hex || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{m.callsign || '—'}</TableCell>
                        <TableCell className="font-mono text-sm font-bold">{m.detections}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.minAlt != null && m.maxAlt != null
                            ? `${m.minAlt.toFixed(0)}-${m.maxAlt.toFixed(0)} ft`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {m.tables.map(t => (
                              <Badge key={t} variant="outline" className="font-mono text-[9px]">
                                {t.replace(/_rows$/g, '').replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Unlinked / Merge Candidates */}
          <TabsContent value="unlinked">
            {mergeCandidates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground font-mono text-sm">
                Click "Scan Unlinked" to discover identities not yet in the entity registry
              </div>
            ) : (
              <div className="rounded border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="font-mono text-xs">Identity</TableHead>
                      <TableHead className="font-mono text-xs">Sources</TableHead>
                      <TableHead className="font-mono text-xs">Confidence</TableHead>
                      <TableHead className="font-mono text-xs">Reason</TableHead>
                      <TableHead className="font-mono text-xs">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mergeCandidates.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-sm font-bold text-primary">{c.groupKey}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {c.sources.map(s => (
                              <Badge key={s} variant="outline" className="font-mono text-[9px]">{s.replace(/_/g, ' ')}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={c.confidence >= 80 ? 'destructive' : 'secondary'}
                            className="font-mono text-[10px]"
                          >
                            {c.confidence}%
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground max-w-[300px] truncate">
                          {c.reason}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => promoteToEntity(c)} className="font-mono text-xs">
                            <Plus className="w-3 h-3 mr-1" /> Promote
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
