import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { neonQuery } from "@/lib/neonQueryRetry";
import {
  Database, Search, Network, Table2, Loader2, ArrowRight,
  HardDrive, Columns3, Link2, Brain, BarChart3
} from "lucide-react";

interface TableInfo {
  name: string;
  type: string;
  estimatedRows: number;
  totalBytes: number;
  columnCount: number;
  columns: { name: string; type: string; nullable: boolean }[];
}

interface InferredRelationship {
  column: string;
  tables: string[];
  count: number;
}

interface CatalogData {
  tables: TableInfo[];
  foreignKeys: any[];
  inferredRelationships: InferredRelationship[];
  categories: Record<string, string[]>;
  summary: {
    totalTables: number;
    totalColumns: number;
    totalForeignKeys: number;
    totalInferredLinks: number;
    totalRows: number;
    totalBytes: number;
  };
}

const CATEGORY_COLORS: Record<string, string> = {
  surveillance: "bg-red-500/20 text-red-400 border-red-500/30",
  biometric: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  legal: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  forensic: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  agent: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  registry: "bg-green-500/20 text-green-400 border-green-500/30",
  infrastructure: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  other: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const CATEGORY_ICONS: Record<string, string> = {
  surveillance: "📡",
  biometric: "💓",
  legal: "⚖️",
  forensic: "🔬",
  agent: "🤖",
  registry: "📋",
  infrastructure: "⚙️",
  other: "📁",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export function SchemaDiscoveryDashboard() {
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null);
  const [selectedRelationship, setSelectedRelationship] = useState<InferredRelationship | null>(null);
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searching, setSearching] = useState(false);

  const runCatalogScan = async () => {
    setLoading(true);
    try {
      const { data, error } = await neonQuery({ action: "schemaCatalog" });
      if (error) throw new Error(typeof error === 'string' ? error : error.message);
      setCatalog(data as CatalogData);
      toast.success(`Cataloged ${(data as CatalogData).summary.totalTables} tables`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const { data, error } = await neonQuery({ action: "schemaSearch", query: searchQuery });
      if (error) throw new Error(typeof error === 'string' ? error : error.message);
      setSearchResults(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSearching(false);
    }
  };

  const filteredTables = catalog?.tables.filter(t =>
    !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.columns.some(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Brain className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wider text-primary">
              Knowledge Engine
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              SCHEMA DISCOVERY // RELATIONSHIP INFERENCE // CROSS-TABLE INTELLIGENCE
            </p>
          </div>
        </div>
        <Button onClick={runCatalogScan} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          {catalog ? "Rescan" : "Scan Schema"}
        </Button>
      </div>

      {/* Summary Stats */}
      {catalog && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Tables", value: catalog.summary.totalTables, icon: Table2 },
            { label: "Columns", value: catalog.summary.totalColumns.toLocaleString(), icon: Columns3 },
            { label: "Foreign Keys", value: catalog.summary.totalForeignKeys, icon: Link2 },
            { label: "Inferred Links", value: catalog.summary.totalInferredLinks, icon: Network },
            { label: "Total Rows", value: catalog.summary.totalRows.toLocaleString(), icon: BarChart3 },
            { label: "Total Size", value: formatBytes(catalog.summary.totalBytes), icon: HardDrive },
          ].map(stat => (
            <Card key={stat.label} className="bg-card/50 border-border/50">
              <CardContent className="p-3 flex items-center gap-3">
                <stat.icon className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="text-lg font-bold text-foreground">{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Search */}
      {catalog && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search tables, columns, relationships... (e.g. 'registration', 'biometric', 'shell')"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runSearch()}
                className="font-mono text-sm"
              />
              <Button onClick={runSearch} disabled={searching} variant="outline" className="gap-2 shrink-0">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Deep Search
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {catalog && (
        <Tabs defaultValue="categories" className="w-full">
          <TabsList className="w-full flex flex-wrap h-auto gap-1">
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="tables">All Tables ({filteredTables.length})</TabsTrigger>
            <TabsTrigger value="relationships">Relationships ({catalog.inferredRelationships.length})</TabsTrigger>
            <TabsTrigger value="search">Search Results</TabsTrigger>
          </TabsList>

          {/* Categories View */}
          <TabsContent value="categories">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(catalog.categories).filter(([, tbls]) => tbls.length > 0).map(([cat, tbls]) => (
                <Card key={cat} className="bg-card/50 border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span>{CATEGORY_ICONS[cat]}</span>
                      <span className="uppercase">{cat}</span>
                      <Badge variant="outline" className="ml-auto">{tbls.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-40">
                      <div className="space-y-1">
                        {tbls.map(t => {
                          const info = catalog.tables.find(x => x.name === t);
                          return (
                            <button
                              key={t}
                              onClick={() => setSelectedTable(info || null)}
                              className="w-full text-left px-2 py-1 rounded text-xs font-mono hover:bg-primary/10 flex justify-between items-center"
                            >
                              <span className="text-foreground truncate">{t}</span>
                              <span className="text-muted-foreground shrink-0 ml-2">
                                {info ? info.estimatedRows.toLocaleString() + " rows" : ""}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* All Tables */}
          <TabsContent value="tables">
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="border-b border-border/50">
                        <th className="text-left p-2 text-muted-foreground">TABLE</th>
                        <th className="text-right p-2 text-muted-foreground">ROWS</th>
                        <th className="text-right p-2 text-muted-foreground">SIZE</th>
                        <th className="text-right p-2 text-muted-foreground">COLS</th>
                        <th className="text-center p-2 text-muted-foreground">ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTables.map(t => (
                        <tr key={t.name} className="border-b border-border/20 hover:bg-primary/5">
                          <td className="p-2 text-foreground">{t.name}</td>
                          <td className="p-2 text-right text-muted-foreground">{t.estimatedRows.toLocaleString()}</td>
                          <td className="p-2 text-right text-muted-foreground">{formatBytes(t.totalBytes)}</td>
                          <td className="p-2 text-right text-muted-foreground">{t.columnCount}</td>
                          <td className="p-2 text-center">
                            <Button size="sm" variant="ghost" className="h-6 text-xs"
                              onClick={() => setSelectedTable(t)}>
                              Inspect
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Relationships */}
          <TabsContent value="relationships">
            <div className="space-y-4">
              {/* Explicit FK */}
              {catalog.foreignKeys.length > 0 && (
                <Card className="bg-card/50 border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-primary" />
                      Explicit Foreign Keys
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {catalog.foreignKeys.map((fk: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs font-mono py-1">
                          <Badge variant="outline" className="text-[10px]">{fk.source_table}</Badge>
                          <span className="text-muted-foreground">.{fk.source_column}</span>
                          <ArrowRight className="w-3 h-3 text-primary" />
                          <Badge variant="outline" className="text-[10px]">{fk.target_table}</Badge>
                          <span className="text-muted-foreground">.{fk.target_column}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Inferred */}
              <Card className="bg-card/50 border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Network className="w-4 h-4 text-primary" />
                    Inferred Join Keys (Shared Column Names)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-3">
                      {catalog.inferredRelationships.map((rel, i) => (
                        <div key={i} className="p-3 rounded border border-border/30 bg-background/50">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge className="bg-primary/20 text-primary border-primary/30 font-mono text-xs">
                                {rel.column}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                appears in {rel.count} tables
                              </span>
                            </div>
                            <Button size="sm" variant="ghost" className="h-6 text-xs"
                              onClick={() => setSelectedRelationship(rel)}>
                              Explore
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {rel.tables.slice(0, 15).map(t => (
                              <Badge key={t} variant="outline" className="text-[10px] font-mono">
                                {t}
                              </Badge>
                            ))}
                            {rel.tables.length > 15 && (
                              <Badge variant="outline" className="text-[10px]">
                                +{rel.tables.length - 15} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Search Results */}
          <TabsContent value="search">
            {searchResults ? (
              <div className="space-y-4">
                {searchResults.tableMatches?.length > 0 && (
                  <Card className="bg-card/50 border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Table Matches ({searchResults.tableMatches.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-1">
                        {searchResults.tableMatches.map((t: any) => (
                          <Badge key={t.table_name} variant="outline" className="font-mono text-xs cursor-pointer hover:bg-primary/10"
                            onClick={() => {
                              const info = catalog?.tables.find(x => x.name === t.table_name);
                              if (info) setSelectedTable(info);
                            }}>
                            {t.table_name}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {searchResults.columnMatches?.length > 0 && (
                  <Card className="bg-card/50 border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Column Matches ({searchResults.columnMatches.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-60">
                        <table className="w-full text-xs font-mono">
                          <thead>
                            <tr className="border-b border-border/50">
                              <th className="text-left p-1 text-muted-foreground">TABLE</th>
                              <th className="text-left p-1 text-muted-foreground">COLUMN</th>
                              <th className="text-left p-1 text-muted-foreground">TYPE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {searchResults.columnMatches.map((c: any, i: number) => (
                              <tr key={i} className="border-b border-border/20">
                                <td className="p-1 text-foreground">{c.table_name}</td>
                                <td className="p-1 text-primary">{c.column_name}</td>
                                <td className="p-1 text-muted-foreground">{c.data_type}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-8 text-center text-muted-foreground text-sm">
                  Use the search bar above and click "Deep Search" to find tables and columns across the entire schema.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Table Inspector Modal */}
      {selectedTable && (
        <Card className="bg-card/80 border-primary/30 border-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Table2 className="w-4 h-4 text-primary" />
              {selectedTable.name}
              <Badge variant="outline" className="text-[10px] ml-2">
                {selectedTable.estimatedRows.toLocaleString()} rows
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {formatBytes(selectedTable.totalBytes)}
              </Badge>
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setSelectedTable(null)}>✕</Button>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-60">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left p-1 text-muted-foreground">#</th>
                    <th className="text-left p-1 text-muted-foreground">COLUMN</th>
                    <th className="text-left p-1 text-muted-foreground">TYPE</th>
                    <th className="text-left p-1 text-muted-foreground">NULLABLE</th>
                    <th className="text-left p-1 text-muted-foreground">JOIN KEY?</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTable.columns.map((c, i) => {
                    const isJoinKey = catalog?.inferredRelationships.some(
                      r => r.column === c.name && r.tables.includes(selectedTable.name)
                    );
                    return (
                      <tr key={c.name} className="border-b border-border/20">
                        <td className="p-1 text-muted-foreground">{i + 1}</td>
                        <td className={`p-1 ${isJoinKey ? 'text-primary font-bold' : 'text-foreground'}`}>{c.name}</td>
                        <td className="p-1 text-muted-foreground">{c.type}</td>
                        <td className="p-1">{c.nullable ? "✓" : "—"}</td>
                        <td className="p-1">{isJoinKey ? <Badge className="text-[9px] bg-primary/20 text-primary">JOIN</Badge> : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Relationship Explorer */}
      {selectedRelationship && (
        <Card className="bg-card/80 border-primary/30 border-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Network className="w-4 h-4 text-primary" />
              Join Key: <span className="text-primary">{selectedRelationship.column}</span>
              <Badge variant="outline">{selectedRelationship.count} tables</Badge>
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setSelectedRelationship(null)}>✕</Button>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              These {selectedRelationship.count} tables share the column <code className="text-primary">{selectedRelationship.column}</code> and can potentially be joined for cross-table analysis.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {selectedRelationship.tables.map(t => {
                const info = catalog?.tables.find(x => x.name === t);
                return (
                  <button
                    key={t}
                    onClick={() => {
                      if (info) setSelectedTable(info);
                    }}
                    className="text-left p-2 rounded border border-border/30 hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  >
                    <p className="font-mono text-xs text-foreground truncate">{t}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {info ? `${info.estimatedRows.toLocaleString()} rows · ${info.columnCount} cols` : ""}
                    </p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!catalog && !loading && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-12 text-center space-y-4">
            <Brain className="w-16 h-16 mx-auto text-primary/30" />
            <h2 className="text-lg font-display text-foreground uppercase">Watchtower Knowledge Engine</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Automated schema discovery across 900+ tables. Discovers join keys, infers relationships,
              and categorizes your entire forensic archive into a navigable intelligence map.
            </p>
            <Button onClick={runCatalogScan} className="gap-2">
              <Database className="w-4 h-4" /> Initialize Schema Catalog
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
