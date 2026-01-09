import { useState, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Database, RefreshCw, Plane, Heart, Scale, Shield, Building2,
  Brain, Eye, FileText, AlertTriangle, TrendingUp, Activity
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface CategoryStats {
  category: string;
  table_count: number;
  total_records: number;
  icon: React.ReactNode;
  color: string;
}

interface TableDetail {
  tablename: string;
  row_count: number;
  category: string;
}

const CATEGORY_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  FLIGHT_SURVEILLANCE: { icon: <Plane className="w-4 h-4" />, color: "text-blue-400", label: "Flight Surveillance" },
  BIOMETRIC: { icon: <Heart className="w-4 h-4" />, color: "text-red-400", label: "Biometric" },
  LEGAL: { icon: <Scale className="w-4 h-4" />, color: "text-purple-400", label: "Legal Evidence" },
  KCSO_LAW_ENFORCEMENT: { icon: <Shield className="w-4 h-4" />, color: "text-yellow-400", label: "KCSO/Law Enforcement" },
  CRIMINAL_NETWORK: { icon: <Building2 className="w-4 h-4" />, color: "text-orange-400", label: "Criminal Network" },
  JOSIAH_AI: { icon: <Brain className="w-4 h-4" />, color: "text-cyan-400", label: "Josiah AI" },
  OCR_VISUAL: { icon: <Eye className="w-4 h-4" />, color: "text-green-400", label: "OCR/Visual" },
  FORENSIC_CUSTODY: { icon: <FileText className="w-4 h-4" />, color: "text-pink-400", label: "Forensic/Custody" },
  TIMELINE_SURVEILLANCE: { icon: <Activity className="w-4 h-4" />, color: "text-indigo-400", label: "Timeline/Watchtower" },
  CORRELATIONS: { icon: <TrendingUp className="w-4 h-4" />, color: "text-emerald-400", label: "Correlations" },
  OTHER: { icon: <Database className="w-4 h-4" />, color: "text-muted-foreground", label: "Other" },
};

export function DatabaseIntelligenceScanner() {
  const [categories, setCategories] = useState<CategoryStats[]>([]);
  const [tables, setTables] = useState<TableDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalTables, setTotalTables] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<Date | null>(null);

  const scanDatabase = useCallback(async () => {
    setLoading(true);
    setProgress(10);

    try {
      // Category aggregation query
      const categoryQuery = `
        SELECT 
          CASE 
            WHEN tablename ILIKE '%kcso%' OR tablename ILIKE '%sheriff%' OR tablename ILIKE '%kern%' THEN 'KCSO_LAW_ENFORCEMENT'
            WHEN tablename ILIKE '%biometric%' OR tablename ILIKE '%heart%' OR tablename ILIKE '%ecg%' OR tablename ILIKE '%stress%' OR tablename ILIKE '%physician%' THEN 'BIOMETRIC'
            WHEN tablename ILIKE '%flight%' OR tablename ILIKE '%aircraft%' OR tablename ILIKE '%adsb%' OR tablename ILIKE '%radar%' OR tablename ILIKE '%detection%' OR tablename ILIKE '%watchtower%' THEN 'FLIGHT_SURVEILLANCE'
            WHEN tablename ILIKE '%josiah%' THEN 'JOSIAH_AI'
            WHEN tablename ILIKE '%legal%' OR tablename ILIKE '%ada%' OR tablename ILIKE '%rico%' OR tablename ILIKE '%nuremberg%' THEN 'LEGAL'
            WHEN tablename ILIKE '%shell%' OR tablename ILIKE '%enterprise%' OR tablename ILIKE '%criminal%' OR tablename ILIKE '%operator%' THEN 'CRIMINAL_NETWORK'
            WHEN tablename ILIKE '%ocr%' OR tablename ILIKE '%screenshot%' OR tablename ILIKE '%image%' THEN 'OCR_VISUAL'
            WHEN tablename ILIKE '%custody%' OR tablename ILIKE '%forensic%' OR tablename ILIKE '%chain%' OR tablename ILIKE '%evidence%' THEN 'FORENSIC_CUSTODY'
            WHEN tablename ILIKE '%timeline%' THEN 'TIMELINE_SURVEILLANCE'
            WHEN tablename ILIKE '%correlation%' THEN 'CORRELATIONS'
            ELSE 'OTHER'
          END as category,
          COUNT(*) as table_count,
          COALESCE(SUM(row_count), 0) as total_records
        FROM (
          SELECT c.relname as tablename, c.reltuples::bigint as row_count 
          FROM pg_class c 
          JOIN pg_namespace n ON n.oid = c.relnamespace 
          WHERE c.relkind = 'r' AND n.nspname = 'public'
        ) t 
        GROUP BY category 
        ORDER BY total_records DESC
      `;

      setProgress(30);

      const { data: categoryData, error: catError } = await supabase.functions.invoke('neon-query', {
        body: { action: 'customQuery', query: categoryQuery }
      });

      if (catError) throw catError;

      setProgress(60);

      // Get detailed table list
      const tableQuery = `
        SELECT 
          tablename,
          row_count,
          CASE 
            WHEN tablename ILIKE '%kcso%' OR tablename ILIKE '%sheriff%' OR tablename ILIKE '%kern%' THEN 'KCSO_LAW_ENFORCEMENT'
            WHEN tablename ILIKE '%biometric%' OR tablename ILIKE '%heart%' OR tablename ILIKE '%ecg%' OR tablename ILIKE '%stress%' OR tablename ILIKE '%physician%' THEN 'BIOMETRIC'
            WHEN tablename ILIKE '%flight%' OR tablename ILIKE '%aircraft%' OR tablename ILIKE '%adsb%' OR tablename ILIKE '%radar%' OR tablename ILIKE '%detection%' OR tablename ILIKE '%watchtower%' THEN 'FLIGHT_SURVEILLANCE'
            WHEN tablename ILIKE '%josiah%' THEN 'JOSIAH_AI'
            WHEN tablename ILIKE '%legal%' OR tablename ILIKE '%ada%' OR tablename ILIKE '%rico%' OR tablename ILIKE '%nuremberg%' THEN 'LEGAL'
            WHEN tablename ILIKE '%shell%' OR tablename ILIKE '%enterprise%' OR tablename ILIKE '%criminal%' OR tablename ILIKE '%operator%' THEN 'CRIMINAL_NETWORK'
            WHEN tablename ILIKE '%ocr%' OR tablename ILIKE '%screenshot%' OR tablename ILIKE '%image%' THEN 'OCR_VISUAL'
            WHEN tablename ILIKE '%custody%' OR tablename ILIKE '%forensic%' OR tablename ILIKE '%chain%' OR tablename ILIKE '%evidence%' THEN 'FORENSIC_CUSTODY'
            WHEN tablename ILIKE '%timeline%' THEN 'TIMELINE_SURVEILLANCE'
            WHEN tablename ILIKE '%correlation%' THEN 'CORRELATIONS'
            ELSE 'OTHER'
          END as category
        FROM (
          SELECT c.relname as tablename, c.reltuples::bigint as row_count 
          FROM pg_class c 
          JOIN pg_namespace n ON n.oid = c.relnamespace 
          WHERE c.relkind = 'r' AND n.nspname = 'public'
        ) t 
        ORDER BY row_count DESC
      `;

      const { data: tableData } = await supabase.functions.invoke('neon-query', {
        body: { action: 'customQuery', query: tableQuery }
      });

      setProgress(90);

      // Process category data
      const processedCategories: CategoryStats[] = (categoryData || []).map((cat: any) => {
        const config = CATEGORY_CONFIG[cat.category] || CATEGORY_CONFIG.OTHER;
        return {
          category: cat.category,
          table_count: parseInt(cat.table_count) || 0,
          total_records: parseInt(cat.total_records) || 0,
          icon: config.icon,
          color: config.color,
        };
      });

      setCategories(processedCategories);
      setTables(tableData || []);
      setTotalRecords(processedCategories.reduce((sum, c) => sum + c.total_records, 0));
      setTotalTables(processedCategories.reduce((sum, c) => sum + c.table_count, 0));
      setLastScan(new Date());
      setProgress(100);

    } catch (error) {
      console.error('Database scan error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scanDatabase();
  }, [scanDatabase]);

  const filteredTables = selectedCategory
    ? tables.filter(t => t.category === selectedCategory)
    : tables;

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  return (
    <CyberPanel
      title="DATABASE INTELLIGENCE SCANNER"
      icon={<Database className="w-4 h-4" />}
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {totalTables} Tables • {formatNumber(totalRecords)} Records
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6"
            onClick={scanDatabase}
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Progress Bar */}
        {loading && (
          <div className="space-y-2">
            <Progress value={progress} className="h-1" />
            <p className="text-xs text-muted-foreground text-center">
              Scanning {totalTables} tables across all modalities...
            </p>
          </div>
        )}

        {/* Category Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {categories.map((cat) => {
            const config = CATEGORY_CONFIG[cat.category] || CATEGORY_CONFIG.OTHER;
            const isSelected = selectedCategory === cat.category;
            
            return (
              <button
                key={cat.category}
                onClick={() => setSelectedCategory(isSelected ? null : cat.category)}
                className={`p-3 rounded-lg border transition-all text-left ${
                  isSelected 
                    ? 'bg-primary/20 border-primary' 
                    : 'bg-muted/20 border-border/50 hover:border-primary/50'
                }`}
              >
                <div className={`flex items-center gap-2 ${config.color} mb-1`}>
                  {config.icon}
                  <span className="text-xs font-medium truncate">{config.label}</span>
                </div>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-lg font-bold">{formatNumber(cat.total_records)}</p>
                    <p className="text-[10px] text-muted-foreground">{cat.table_count} tables</p>
                  </div>
                  {cat.category === 'KCSO_LAW_ENFORCEMENT' && (
                    <AlertTriangle className="w-4 h-4 text-yellow-400 animate-pulse" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Table List */}
        <Tabs defaultValue="tables" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="tables">Table Details</TabsTrigger>
            <TabsTrigger value="critical">Critical Tables</TabsTrigger>
          </TabsList>
          
          <TabsContent value="tables">
            <ScrollArea className="h-[300px]">
              <div className="space-y-1 pr-4">
                {filteredTables.slice(0, 50).map((table, idx) => {
                  const config = CATEGORY_CONFIG[table.category] || CATEGORY_CONFIG.OTHER;
                  return (
                    <div
                      key={table.tablename}
                      className="flex items-center justify-between p-2 rounded hover:bg-muted/30 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground w-6">{idx + 1}.</span>
                        <span className={config.color}>{config.icon}</span>
                        <span className="font-mono truncate">{table.tablename}</span>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {formatNumber(parseInt(String(table.row_count)) || 0)}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="critical">
            <ScrollArea className="h-[300px]">
              <div className="space-y-2 pr-4">
                {tables
                  .filter(t => 
                    t.category === 'KCSO_LAW_ENFORCEMENT' || 
                    t.category === 'BIOMETRIC' ||
                    t.tablename.toLowerCase().includes('n912') ||
                    t.tablename.toLowerCase().includes('n913')
                  )
                  .map((table) => {
                    const config = CATEGORY_CONFIG[table.category] || CATEGORY_CONFIG.OTHER;
                    return (
                      <div
                        key={table.tablename}
                        className="p-3 rounded-lg bg-destructive/10 border border-destructive/30"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={config.color}>{config.icon}</span>
                            <span className="font-mono font-bold">{table.tablename}</span>
                          </div>
                          <Badge variant="destructive">
                            {formatNumber(parseInt(String(table.row_count)) || 0)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Category: {config.label}
                        </p>
                      </div>
                    );
                  })}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Last Scan Info */}
        {lastScan && (
          <p className="text-xs text-muted-foreground text-center">
            Last scan: {lastScan.toLocaleTimeString()} • Neon Database (public schema)
          </p>
        )}
      </div>
    </CyberPanel>
  );
}
