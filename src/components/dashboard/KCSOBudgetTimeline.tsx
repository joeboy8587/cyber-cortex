import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { 
  DollarSign, 
  Calendar, 
  Download, 
  RefreshCw, 
  Plane, 
  FileText,
  ExternalLink,
  TrendingUp,
  Database,
  Upload
} from 'lucide-react';

// The extracted data structure
interface Purchase {
  item: string;
  item_citation: string | null;
  vendor: string | null;
  vendor_citation: string | null;
  amount: number | null;
  amount_citation: string | null;
  date: string | null;
  date_citation: string | null;
}

interface AircraftBudgetData {
  aircraft_tail_number: string;
  aircraft_tail_number_citation: string;
  year: number;
  year_citation: string;
  budget: number | null;
  budget_citation: string | null;
  purchases: Purchase[];
  spending_patterns: string;
  spending_patterns_citation: string;
}

// Data loaded from NeonDB - no hardcoded fallback
export const KCSOBudgetTimeline: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [budgetData, setBudgetData] = useState<AircraftBudgetData[]>([]);
  const [selectedAircraft, setSelectedAircraft] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  // Derived values
  const years = [...new Set(budgetData.map(d => d.year))].sort();
  const aircraft = [...new Set(budgetData.map(d => d.aircraft_tail_number))];
  const filteredData = budgetData.filter(d => {
    if (selectedAircraft !== 'all' && d.aircraft_tail_number !== selectedAircraft) return false;
    if (selectedYear !== null && d.year !== selectedYear) return false;
    return true;
  });
  const totalBudget = budgetData.reduce((sum, d) => sum + (d.budget || 0), 0);
  const totalPurchases = budgetData.reduce((sum, d) => sum + d.purchases.length, 0);
  const citationCount = budgetData.reduce((count, d) => {
    let c = 0;
    if (d.aircraft_tail_number_citation) c++;
    if (d.year_citation) c++;
    if (d.budget_citation) c++;
    if (d.spending_patterns_citation) c++;
    d.purchases.forEach(p => {
      if (p.item_citation) c++;
      if (p.vendor_citation) c++;
      if (p.amount_citation) c++;
      if (p.date_citation) c++;
    });
    return count + c;
  }, 0);

  useEffect(() => {
    loadBudgetData();
  }, []);

  const loadBudgetData = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getKCSOBudgetData' }
      });
      if (!error && data?.data && Array.isArray(data.data) && data.data.length > 0) {
        // Map DB rows to our interface
        const mapped: AircraftBudgetData[] = data.data.map((row: any) => ({
          aircraft_tail_number: row.aircraft_tail_number || '',
          aircraft_tail_number_citation: row.aircraft_tail_number_citation || '',
          year: parseInt(String(row.year || '0')),
          year_citation: row.year_citation || '',
          budget: row.budget ? parseFloat(String(row.budget)) : null,
          budget_citation: row.budget_citation || null,
          purchases: Array.isArray(row.purchases) ? row.purchases : 
            typeof row.purchases === 'string' ? JSON.parse(row.purchases || '[]') : [],
          spending_patterns: row.spending_patterns || '',
          spending_patterns_citation: row.spending_patterns_citation || ''
        }));
        setBudgetData(mapped);
      } else {
        console.warn('No budget data in DB yet - use Import button');
      }
    } catch (err) {
      console.error('Failed to load budget data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const importToDatabase = async () => {
    setIsImporting(true);
    try {
      toast.info('Budget data should be imported via the Data Tools hub');
    } finally {
      setIsImporting(false);
    }
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null) return 'N/A';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
  };

  const CitationLink: React.FC<{ url: string | null; label?: string }> = ({ url, label }) => {
    if (!url) return null;
    return (
      <a 
        href={url} 
        target="_blank" 
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        {label || 'Source'}
      </a>
    );
  };

  return (
    <CyberPanel title="KCSO Aircraft Budget Timeline" className="col-span-full">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : budgetData.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground">
          <p className="text-sm">No budget data loaded from database.</p>
          <Button onClick={loadBudgetData} variant="outline" size="sm" className="mt-3">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry Load
          </Button>
        </div>
      ) : (
        <>
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Plane className="h-3 w-3" />
            Records
          </div>
          <div className="text-xl font-bold text-foreground">{budgetData.length}</div>
        </div>
        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <DollarSign className="h-3 w-3" />
            Total Budget
          </div>
          <div className="text-xl font-bold text-green-400">{formatCurrency(totalBudget)}</div>
        </div>
        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <TrendingUp className="h-3 w-3" />
            Purchases
          </div>
          <div className="text-xl font-bold text-amber-400">{totalPurchases}</div>
        </div>
        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <FileText className="h-3 w-3" />
            Citations
          </div>
          <div className="text-xl font-bold text-blue-400">{citationCount}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Button 
          onClick={importToDatabase} 
          disabled={isImporting}
          size="sm"
          className="bg-green-600 hover:bg-green-700"
        >
          {isImporting ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          Import to NeonDB
        </Button>
        <Button onClick={checkDbRecords} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Check DB
        </Button>
        <div className="flex-1" />
        <select 
          value={selectedAircraft}
          onChange={e => setSelectedAircraft(e.target.value)}
          className="bg-background border border-border rounded px-2 py-1 text-sm"
        >
          <option value="all">All Aircraft</option>
          {aircraft.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select 
          value={selectedYear ?? 'all'}
          onChange={e => setSelectedYear(e.target.value === 'all' ? null : parseInt(e.target.value))}
          className="bg-background border border-border rounded px-2 py-1 text-sm"
        >
          <option value="all">All Years</option>
          {years.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Timeline View */}
      <Tabs defaultValue="timeline" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
          <TabsTrigger value="citations">All Citations</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          <ScrollArea className="h-[500px]">
            <div className="space-y-4">
              {filteredData.map((record, idx) => (
                <div 
                  key={`${record.aircraft_tail_number}-${record.year}-${idx}`}
                  className="bg-background/30 border border-border/50 rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Badge 
                        variant="outline" 
                        className={record.aircraft_tail_number === 'N912KC' ? 'border-cyan-500 text-cyan-400' : 'border-amber-500 text-amber-400'}
                      >
                        {record.aircraft_tail_number}
                      </Badge>
                      <span className="text-lg font-semibold text-foreground">{record.year}</span>
                      <CitationLink url={record.year_citation} />
                    </div>
                    {record.budget && (
                      <div className="text-right">
                        <div className="text-xl font-bold text-green-400">{formatCurrency(record.budget)}</div>
                        <CitationLink url={record.budget_citation} label="Budget source" />
                      </div>
                    )}
                  </div>

                  <p className="text-sm text-muted-foreground mb-3">{record.spending_patterns}</p>
                  <CitationLink url={record.spending_patterns_citation} label="Spending pattern source" />

                  {record.purchases.length > 0 && (
                    <div className="mt-4 border-t border-border/50 pt-3">
                      <div className="text-xs text-muted-foreground mb-2">PURCHASES</div>
                      <div className="space-y-2">
                        {record.purchases.map((purchase, pIdx) => (
                          <div key={pIdx} className="bg-background/50 rounded p-2 text-sm">
                            <div className="font-medium text-foreground">{purchase.item}</div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                              {purchase.vendor && <span>Vendor: {purchase.vendor}</span>}
                              {purchase.amount && <span className="text-green-400">{formatCurrency(purchase.amount)}</span>}
                              {purchase.date && <span>Date: {purchase.date}</span>}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-1">
                              <CitationLink url={purchase.item_citation} label="Item" />
                              <CitationLink url={purchase.amount_citation} label="Amount" />
                              <CitationLink url={purchase.vendor_citation} label="Vendor" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="purchases">
          <ScrollArea className="h-[500px]">
            <div className="space-y-2">
              {KCSO_AIRCRAFT_DATA.flatMap((record, rIdx) => 
                record.purchases.map((p, pIdx) => (
                  <div key={`${rIdx}-${pIdx}`} className="bg-background/30 border border-border/50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="text-xs">{record.aircraft_tail_number}</Badge>
                      <span className="text-sm font-medium">{record.year}</span>
                      {p.amount && <Badge className="bg-green-600/20 text-green-400 text-xs">{formatCurrency(p.amount)}</Badge>}
                    </div>
                    <div className="text-sm text-foreground">{p.item}</div>
                    {p.vendor && <div className="text-xs text-muted-foreground mt-1">Vendor: {p.vendor}</div>}
                    <div className="flex flex-wrap gap-2 mt-2">
                      <CitationLink url={p.item_citation} label="Item" />
                      <CitationLink url={p.amount_citation} label="Amount" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="citations">
          <ScrollArea className="h-[500px]">
            <div className="space-y-1">
              {[...new Set(
                KCSO_AIRCRAFT_DATA.flatMap(r => [
                  r.aircraft_tail_number_citation,
                  r.year_citation,
                  r.budget_citation,
                  r.spending_patterns_citation,
                  ...r.purchases.flatMap(p => [p.item_citation, p.vendor_citation, p.amount_citation, p.date_citation])
                ]).filter(Boolean)
              )].map((url, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300">
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  <a href={url!} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
                    {url}
                  </a>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
};

export default KCSOBudgetTimeline;
