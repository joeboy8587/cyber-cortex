import { useState, useEffect, useMemo } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Database, RefreshCw, Loader2, Search, Link2, AlertTriangle,
  Layers, ArrowRight, ChevronDown, ChevronRight, Globe
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface TableEntry {
  table_name: string;
  row_count: number;
  size_bytes: number;
  domain: string;
  column_count: number;
  columns: string[];
  join_keys: string[];
}

interface DomainInfo {
  tables: number;
  records: number;
  size: number;
  tableNames: string[];
}

interface LinkageEntry {
  domain_a: string;
  domain_b: string;
  shared_keys: string[];
  linkable_tables: number;
}

interface FragmentCluster {
  tables: string[];
  overlap_pct: number;
  shared_columns: string[];
}

interface CrossDomainResult {
  tableA: string;
  tableB: string;
  joinKey: string;
  linkedEntities: { join_value: string; records_a: number; records_b: number }[];
  totalLinked: number;
  error?: string;
  availableCommonColumns?: string[];
}

const DOMAIN_COLORS: Record<string, string> = {
  'Flight Detection': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Biometric': 'bg-red-500/20 text-red-400 border-red-500/30',
  'Correlation': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'OCR/Visual': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'Legal/ADA/RICO': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'KCSO': 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  'Aircraft Registry': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'Operator': 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  'Agent/Josiah': 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  'Forensic': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'Shell Company': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Military': 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  'Drone': 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  'Infrastructure': 'bg-lime-500/20 text-lime-400 border-lime-500/30',
  'Taxonomy': 'bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30',
  'Watchtower': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'Timeline': 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  'Other': 'bg-muted text-muted-foreground border-border',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatNum(n: number): string {
  return n.toLocaleString();
}

export function ArchiveManifestDashboard() {
  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState<TableEntry[]>([]);
  const [domainMap, setDomainMap] = useState<Record<string, DomainInfo>>({});
  const [linkageMatrix, setLinkageMatrix] = useState<LinkageEntry[]>([]);
  const [fragments, setFragments] = useState<FragmentCluster[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [search, setSearch] = useState("");
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'domains' | 'linkage' | 'fragments' | 'explorer' | 'tables'>('domains');

  // Cross-domain explorer state
  const [selectedDomainA, setSelectedDomainA] = useState("");
  const [selectedDomainB, setSelectedDomainB] = useState("");
  const [crossResult, setCrossResult] = useState<CrossDomainResult | null>(null);
  const [crossLoading, setCrossLoading] = useState(false);

  const fetchCensus = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'fullArchiveCensus' }
      });
      if (error) throw error;
      setTables(data.tables || []);
      setDomainMap(data.domainMap || {});
      setLinkageMatrix(data.linkageMatrix || []);
      setFragments(data.fragmentClusters || []);
      setTotalRecords(data.totalRecords || 0);
      setTotalSize(data.totalSizeBytes || 0);
    } catch (err) {
      console.error('Census failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCensus(); }, []);

  const filteredTables = useMemo(() => {
    if (!search) return tables;
    const s = search.toLowerCase();
    return tables.filter(t => t.table_name.toLowerCase().includes(s) || t.domain.toLowerCase().includes(s));
  }, [tables, search]);

  const sortedDomains = useMemo(() =>
    Object.entries(domainMap).sort((a, b) => b[1].records - a[1].records),
    [domainMap]
  );

  const runCrossDomain = async () => {
    if (!selectedDomainA || !selectedDomainB) return;
    setCrossLoading(true);
    setCrossResult(null);
    try {
      const tablesA = domainMap[selectedDomainA]?.tableNames || [];
      const tablesB = domainMap[selectedDomainB]?.tableNames || [];
      // Pick the largest table from each domain
      const bigA = tables.filter(t => tablesA.includes(t.table_name)).sort((a, b) => b.row_count - a.row_count)[0];
      const bigB = tables.filter(t => tablesB.includes(t.table_name)).sort((a, b) => b.row_count - a.row_count)[0];
      if (!bigA || !bigB) return;
      // Find best shared join key
      const sharedKeys = bigA.join_keys.filter(k => bigB.join_keys.includes(k));
      const joinKey = sharedKeys[0] || 'registration';

      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'crossDomainQuery',
          domainA: selectedDomainA,
          domainB: selectedDomainB,
          tablesA: [bigA.table_name],
          tablesB: [bigB.table_name],
          joinKey,
          limit: 50,
        }
      });
      if (error) throw error;
      setCrossResult(data);
    } catch (err) {
      console.error('Cross-domain query failed:', err);
    } finally {
      setCrossLoading(false);
    }
  };

  const tabs = [
    { key: 'domains', label: 'Domain Map', icon: <Layers className="w-3 h-3" /> },
    { key: 'linkage', label: 'Linkage Matrix', icon: <Link2 className="w-3 h-3" /> },
    { key: 'fragments', label: 'Fragmentation', icon: <AlertTriangle className="w-3 h-3" /> },
    { key: 'explorer', label: 'Cross-Domain', icon: <Globe className="w-3 h-3" /> },
    { key: 'tables', label: 'All Tables', icon: <Database className="w-3 h-3" /> },
  ] as const;

  return (
    <CyberPanel
      title="Archive Manifest — Full Connection Engine"
      icon={<Database className="w-4 h-4" />}
      headerActions={
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={fetchCensus} disabled={loading}>
          <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Scan
        </Button>
      }
    >
      <div className="p-4 space-y-4">
        {loading && (
          <div className="flex items-center gap-2 justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Scanning all Neon tables…</span>
          </div>
        )}

        {!loading && tables.length > 0 && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-primary/10 rounded-lg p-3 text-center border border-primary/20">
                <div className="text-2xl font-bold text-primary">{formatNum(tables.length)}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Tables</div>
              </div>
              <div className="bg-primary/10 rounded-lg p-3 text-center border border-primary/20">
                <div className="text-2xl font-bold text-primary">{formatNum(totalRecords)}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Records</div>
              </div>
              <div className="bg-primary/10 rounded-lg p-3 text-center border border-primary/20">
                <div className="text-2xl font-bold text-primary">{formatBytes(totalSize)}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Size</div>
              </div>
              <div className="bg-primary/10 rounded-lg p-3 text-center border border-primary/20">
                <div className="text-2xl font-bold text-primary">{sortedDomains.length}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Domains</div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 flex-wrap">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                    activeTab === t.key
                      ? 'bg-primary/20 text-primary border border-primary/40'
                      : 'bg-muted/30 text-muted-foreground border border-border hover:border-primary/30'
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Domain Map */}
            {activeTab === 'domains' && (
              <div className="space-y-2">
                {sortedDomains.map(([domain, info]) => (
                  <div key={domain} className="border border-border rounded">
                    <button
                      onClick={() => setExpandedDomain(expandedDomain === domain ? null : domain)}
                      className="w-full flex items-center justify-between p-3 hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {expandedDomain === domain
                          ? <ChevronDown className="w-4 h-4 text-primary" />
                          : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        }
                        <Badge className={`text-xs ${DOMAIN_COLORS[domain] || DOMAIN_COLORS['Other']}`}>
                          {domain}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{info.tables} tables</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-mono">
                        <span className="text-primary">{formatNum(info.records)} records</span>
                        <span className="text-muted-foreground">{formatBytes(info.size)}</span>
                      </div>
                    </button>
                    {expandedDomain === domain && (
                      <div className="px-3 pb-3 space-y-1">
                        {info.tableNames.map(tn => {
                          const t = tables.find(x => x.table_name === tn);
                          return (
                            <div key={tn} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/10">
                              <span className="font-mono truncate max-w-[250px]">{tn}</span>
                              <div className="flex items-center gap-3">
                                <span className="text-primary font-bold">{formatNum(t?.row_count || 0)}</span>
                                <span className="text-muted-foreground">{t?.join_keys.length || 0} keys</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Linkage Matrix */}
            {activeTab === 'linkage' && (
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {linkageMatrix.map((link, i) => (
                    <div key={i} className="border border-border rounded p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`text-xs ${DOMAIN_COLORS[link.domain_a] || ''}`}>{link.domain_a}</Badge>
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <Badge className={`text-xs ${DOMAIN_COLORS[link.domain_b] || ''}`}>{link.domain_b}</Badge>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {link.linkable_tables} linkable pairs
                        </span>
                      </div>
                      <div className="mt-2 flex gap-1 flex-wrap">
                        {link.shared_keys.map(k => (
                          <span key={k} className="px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] font-mono rounded">
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Fragmentation */}
            {activeTab === 'fragments' && (
              <ScrollArea className="h-[500px]">
                {fragments.length === 0 ? (
                  <div className="text-center text-muted-foreground text-sm py-8">No fragmentation detected (80%+ overlap threshold)</div>
                ) : (
                  <div className="space-y-2">
                    {fragments.map((f, i) => (
                      <div key={i} className="border border-destructive/30 rounded p-3 bg-destructive/5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-destructive" />
                            <span className="text-xs font-bold text-destructive">{f.overlap_pct}% overlap</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{f.shared_columns.length} shared columns</span>
                        </div>
                        <div className="space-y-1">
                          {f.tables.map(tn => (
                            <div key={tn} className="text-xs font-mono text-foreground">{tn}</div>
                          ))}
                        </div>
                        <Progress value={f.overlap_pct} className="h-1.5 mt-2" />
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            )}

            {/* Cross-Domain Explorer */}
            {activeTab === 'explorer' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <select
                    value={selectedDomainA}
                    onChange={(e) => setSelectedDomainA(e.target.value)}
                    className="bg-muted/50 border border-border rounded px-3 py-2 text-xs font-mono"
                  >
                    <option value="">Select Domain A</option>
                    {sortedDomains.map(([d]) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select
                    value={selectedDomainB}
                    onChange={(e) => setSelectedDomainB(e.target.value)}
                    className="bg-muted/50 border border-border rounded px-3 py-2 text-xs font-mono"
                  >
                    <option value="">Select Domain B</option>
                    {sortedDomains.map(([d]) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <Button
                    onClick={runCrossDomain}
                    disabled={!selectedDomainA || !selectedDomainB || crossLoading}
                    className="text-xs"
                    size="sm"
                  >
                    {crossLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Link2 className="w-3 h-3 mr-1" />}
                    Find Connections
                  </Button>
                </div>

                {crossResult && (
                  <div className="border border-border rounded p-3 space-y-3">
                    <div className="text-xs font-mono text-muted-foreground">
                      {crossResult.tableA} ↔ {crossResult.tableB} via <span className="text-primary">{crossResult.joinKey}</span>
                    </div>
                    {crossResult.error ? (
                      <div className="text-xs text-destructive">{crossResult.error}
                        {crossResult.availableCommonColumns && (
                          <div className="mt-1 text-muted-foreground">
                            Available keys: {crossResult.availableCommonColumns.join(', ')}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="text-sm font-bold text-primary">{crossResult.totalLinked} linked entities found</div>
                        <ScrollArea className="h-[200px]">
                          <div className="space-y-1">
                            {crossResult.linkedEntities?.map((e, i) => (
                              <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/10">
                                <span className="font-mono text-foreground">{e.join_value}</span>
                                <span className="text-muted-foreground">{e.records_a}↔{e.records_b}</span>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* All Tables */}
            {activeTab === 'tables' && (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${tables.length} tables…`}
                    className="pl-10 h-8 text-xs font-mono"
                  />
                </div>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-1">
                    {filteredTables.map((t, i) => (
                      <div key={t.table_name} className="flex items-center justify-between p-2 rounded hover:bg-muted/20 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-muted-foreground w-6 text-right shrink-0">{i + 1}</span>
                          <span className="font-mono truncate">{t.table_name}</span>
                          <Badge className={`text-[9px] shrink-0 ${DOMAIN_COLORS[t.domain] || DOMAIN_COLORS['Other']}`}>
                            {t.domain}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-muted-foreground">{t.join_keys.length}k</span>
                          <span className={`font-bold ${t.row_count > 100000 ? 'text-primary' : t.row_count > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {formatNum(t.row_count)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </>
        )}
      </div>
    </CyberPanel>
  );
}
