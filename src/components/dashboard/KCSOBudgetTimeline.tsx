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

// The imported JSON data
const KCSO_AIRCRAFT_DATA: AircraftBudgetData[] = [
  {
    "aircraft_tail_number": "N912KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2020,
    "year_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
    "budget": null,
    "budget_citation": null,
    "purchases": [],
    "spending_patterns": "Aircraft N912KC did not exist in 2020. Kern County Sheriff's Office was operating aging MD500 and Bell OH-58A+ helicopters from 1960s-era fleet. Evaluation and vetting process for new helicopters began, with flight demonstrations conducted throughout 2020 and 2021. Staffing levels were cut around this time.",
    "spending_patterns_citation": "https://www.scanriverside.com/viewtopic.php?t=1300"
  },
  {
    "aircraft_tail_number": "N913KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2020,
    "year_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
    "budget": null,
    "budget_citation": null,
    "purchases": [],
    "spending_patterns": "Aircraft N913KC did not exist in 2020. Kern County Sheriff's Office was operating aging MD500 and Bell OH-58A+ helicopters from 1960s-era fleet. Evaluation and vetting process for new helicopters began, with flight demonstrations conducted throughout 2020 and 2021. Staffing levels were cut around this time.",
    "spending_patterns_citation": "https://www.scanriverside.com/viewtopic.php?t=1300"
  },
  {
    "aircraft_tail_number": "N912KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2021,
    "year_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
    "budget": null,
    "budget_citation": null,
    "purchases": [],
    "spending_patterns": "Aircraft N912KC did not exist in 2021. Kern County Sheriff's Office continued operating aging MD500 and Bell OH-58A+ helicopters. Flight demonstrations for new helicopter evaluation continued throughout 2021.",
    "spending_patterns_citation": "https://www.scanriverside.com/viewtopic.php?t=1300"
  },
  {
    "aircraft_tail_number": "N913KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2021,
    "year_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
    "budget": null,
    "budget_citation": null,
    "purchases": [],
    "spending_patterns": "Aircraft N913KC did not exist in 2021. Kern County Sheriff's Office continued operating aging MD500 and Bell OH-58A+ helicopters. Flight demonstrations for new helicopter evaluation continued throughout 2021.",
    "spending_patterns_citation": "https://www.scanriverside.com/viewtopic.php?t=1300"
  },
  {
    "aircraft_tail_number": "N912KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2022,
    "year_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
    "budget": 6000000,
    "budget_citation": "https://www.kget.com/news/local-news/sheriffs-office-buys-new-helicopters-for-12-million/",
    "purchases": [
      {
        "item": "Airbus H125 helicopter order (c/n 9252)",
        "item_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
        "vendor": "Airbus Helicopters Inc.",
        "vendor_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
        "amount": 6000000,
        "amount_citation": "https://www.kget.com/news/local-news/sheriffs-office-buys-new-helicopters-for-12-million/",
        "date": "2022-03-10",
        "date_citation": "https://www.scanriverside.com/viewtopic.php?t=1300"
      }
    ],
    "spending_patterns": "Kern County Sheriff's Office ordered new Airbus H125 helicopter N912KC on March 10, 2022 for $6 million as part of $12 million fleet modernization plan. Board of Supervisors approved the purchase. Aircraft not yet delivered or operational in 2022. Rising fuel costs noted during this period.",
    "spending_patterns_citation": "https://www.scanriverside.com/viewtopic.php?t=1300"
  },
  {
    "aircraft_tail_number": "N913KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2022,
    "year_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
    "budget": 6000000,
    "budget_citation": "https://www.kget.com/news/local-news/sheriffs-office-buys-new-helicopters-for-12-million/",
    "purchases": [
      {
        "item": "Airbus H125 helicopter order (c/n 9262)",
        "item_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
        "vendor": "Airbus Helicopters Inc.",
        "vendor_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
        "amount": 6000000,
        "amount_citation": "https://www.kget.com/news/local-news/sheriffs-office-buys-new-helicopters-for-12-million/",
        "date": "2022-03-10",
        "date_citation": "https://www.scanriverside.com/viewtopic.php?t=1300"
      }
    ],
    "spending_patterns": "Kern County Sheriff's Office ordered new Airbus H125 helicopter N913KC on March 10, 2022 for $6 million as part of $12 million fleet modernization plan. Board of Supervisors approved the purchase. Aircraft not yet delivered or operational in 2022. Rising fuel costs noted during this period.",
    "spending_patterns_citation": "https://www.scanriverside.com/viewtopic.php?t=1300"
  },
  {
    "aircraft_tail_number": "N912KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2023,
    "year_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
    "budget": 6000000,
    "budget_citation": "https://www.kget.com/news/local-news/sheriffs-office-buys-new-helicopters-for-12-million/",
    "purchases": [
      {
        "item": "Airbus H125 helicopter (c/n 9252)",
        "item_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
        "vendor": "Airbus Helicopters Inc.",
        "vendor_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
        "amount": 6000000,
        "amount_citation": "https://www.kget.com/news/local-news/sheriffs-office-buys-new-helicopters-for-12-million/",
        "date": "2023-04",
        "date_citation": "http://www.policeaviationnews.com/Acrobat/331PANNovember2023.pdf"
      },
      {
        "item": "Fit-out and modifications including 380HDc FLIR, Shotover moving map system, Spectrolab SX-16 searchlight, Axnes wireless intercom, and Garmin autopilot",
        "item_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/",
        "vendor": "Hangar 1 Avionics",
        "vendor_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
        "amount": null,
        "amount_citation": null,
        "date": "2023",
        "date_citation": "https://www.scanriverside.com/viewtopic.php?t=1300"
      },
      {
        "item": "New tools for mechanics (un-budgeted)",
        "item_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/",
        "vendor": null,
        "vendor_citation": null,
        "amount": null,
        "amount_citation": null,
        "date": "2023",
        "date_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/"
      }
    ],
    "spending_patterns": "Aircraft ordered March 10, 2022 as part of fleet modernization to replace 1960s-era Bell OH-58A helicopters. Delivered April 2023, operational by summer 2023. Unit operates on self-billing system where annual operating budget is billed for every flight hour, with funds transferred to long-term account for consumables, maintenance, overhauls, and repairs. Budgets for 1,500 combined yearly flight hours for both H125s. As of February 2025, accumulated over 600 flight hours. Maintenance performed in-house. Staffing levels cut around 2020, being rebuilt to support increased flight hours and return of Search and Rescue program.",
    "spending_patterns_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/"
  },
  {
    "aircraft_tail_number": "N912KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2024,
    "year_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/",
    "budget": null,
    "budget_citation": null,
    "purchases": [
      {
        "item": "Search and Rescue equipment replacement",
        "item_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/",
        "vendor": null,
        "vendor_citation": null,
        "amount": null,
        "amount_citation": null,
        "date": "2024",
        "date_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/"
      }
    ],
    "spending_patterns": "Operational year with ongoing maintenance and operational costs. Unit continues self-billing system budgeting for flight hours. Search and Rescue program returned requiring future spending on equipment replacement after multi-year hiatus.",
    "spending_patterns_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/"
  },
  {
    "aircraft_tail_number": "N912KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2025,
    "year_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/",
    "budget": null,
    "budget_citation": null,
    "purchases": [],
    "spending_patterns": "Continued operations with over 600 flight hours accumulated by February 2025. In-house maintenance continues. Planning for third H125 purchase in 2026-2027 pending county finances.",
    "spending_patterns_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/"
  },
  {
    "aircraft_tail_number": "N913KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2023,
    "year_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
    "budget": 6000000,
    "budget_citation": "https://www.kget.com/news/local-news/sheriffs-office-buys-new-helicopters-for-12-million/",
    "purchases": [
      {
        "item": "Airbus H125 helicopter (c/n 9262)",
        "item_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
        "vendor": "Airbus Helicopters Inc.",
        "vendor_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
        "amount": 6000000,
        "amount_citation": "https://www.kget.com/news/local-news/sheriffs-office-buys-new-helicopters-for-12-million/",
        "date": "2023-04",
        "date_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf"
      },
      {
        "item": "Fit-out and modifications including 380HDc FLIR, Shotover moving map system, Spectrolab SX-16 searchlight, Axnes wireless intercom, and Garmin autopilot",
        "item_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/",
        "vendor": "Hangar 1 Avionics",
        "vendor_citation": "https://www.scanriverside.com/viewtopic.php?t=1300",
        "amount": null,
        "amount_citation": null,
        "date": "2023",
        "date_citation": "https://www.scanriverside.com/viewtopic.php?t=1300"
      }
    ],
    "spending_patterns": "Aircraft ordered March 10, 2022 as part of fleet modernization to replace 1960s-era Bell OH-58A helicopters. Delivered April 2023, operational by summer 2023. Unit operates on self-billing system where annual operating budget is billed for every flight hour, with funds transferred to long-term account for consumables, maintenance, overhauls, and repairs. Budgets for 1,500 combined yearly flight hours for both H125s. As of February 2025, accumulated over 600 flight hours. Maintenance performed in-house.",
    "spending_patterns_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/"
  },
  {
    "aircraft_tail_number": "N913KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2024,
    "year_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/",
    "budget": null,
    "budget_citation": null,
    "purchases": [],
    "spending_patterns": "Operational year with ongoing maintenance and operational costs. Unit continues self-billing system budgeting for flight hours.",
    "spending_patterns_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/"
  },
  {
    "aircraft_tail_number": "N913KC",
    "aircraft_tail_number_citation": "http://www.policeaviationnews.com/Acrobat/325PanMay2023.pdf",
    "year": 2025,
    "year_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/",
    "budget": null,
    "budget_citation": null,
    "purchases": [],
    "spending_patterns": "Continued operations with over 600 flight hours accumulated by February 2025. In-house maintenance continues.",
    "spending_patterns_citation": "https://www.heliopsmag.com/heliops/articles/the-third-generation-kern-county-sheriffs-office-upgrades-to-the-h125/"
  }
];

export const KCSOBudgetTimeline: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [dbRecordCount, setDbRecordCount] = useState<number | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  // Get unique years and aircraft
  const years = [...new Set(KCSO_AIRCRAFT_DATA.map(d => d.year))].sort();
  const aircraft = [...new Set(KCSO_AIRCRAFT_DATA.map(d => d.aircraft_tail_number))];

  // Filter data
  const filteredData = KCSO_AIRCRAFT_DATA.filter(d => {
    if (selectedAircraft !== 'all' && d.aircraft_tail_number !== selectedAircraft) return false;
    if (selectedYear !== null && d.year !== selectedYear) return false;
    return true;
  });

  // Calculate summary stats
  const totalBudget = KCSO_AIRCRAFT_DATA.reduce((sum, d) => sum + (d.budget || 0), 0);
  const totalPurchases = KCSO_AIRCRAFT_DATA.reduce((sum, d) => sum + d.purchases.length, 0);
  const citationCount = KCSO_AIRCRAFT_DATA.reduce((count, d) => {
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

  // Check DB record count
  useEffect(() => {
    checkDbRecords();
  }, []);

  const checkDbRecords = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getKCSOBudgetData' }
      });
      if (!error && data?.data) {
        setDbRecordCount(data.data.length);
      }
    } catch {
      setDbRecordCount(null);
    }
  };

  const importToDatabase = async () => {
    setIsImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'importKCSOBudgetData',
          data: KCSO_AIRCRAFT_DATA
        }
      });

      if (error) throw error;
      
      toast.success(`Imported ${data?.inserted || KCSO_AIRCRAFT_DATA.length} records to kcso_aircraft_budget_history`);
      checkDbRecords();
    } catch (err) {
      console.error('Import error:', err);
      toast.error('Failed to import data to database');
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
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Plane className="h-3 w-3" />
            Records
          </div>
          <div className="text-xl font-bold text-foreground">{KCSO_AIRCRAFT_DATA.length}</div>
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
        <div className="bg-background/50 border border-border/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Database className="h-3 w-3" />
            In NeonDB
          </div>
          <div className="text-xl font-bold text-purple-400">
            {dbRecordCount !== null ? dbRecordCount : '—'}
          </div>
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
