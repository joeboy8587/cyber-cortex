import { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { firecrawlApi } from '@/lib/api/firecrawl';
import { parseFAAMarkdown, formatRecordForDisplay, FAARegistryRecord } from '@/lib/parsers/faaParser';
import { useAircraftRegistry, AircraftRegistryEntry } from '@/hooks/useAircraftRegistry';
import { toast } from 'sonner';
import { 
  Search, 
  Plane, 
  Building2, 
  Database,
  RefreshCw,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Save,
  History,
  List
} from 'lucide-react';

interface ScrapeResult {
  source: string;
  registration?: string;
  timestamp: string;
  success: boolean;
  data?: any;
  error?: string;
  parsedRecords?: FAARegistryRecord[];
  savedToDb?: boolean;
}

export function FlightDataScraper() {
  const [nNumber, setNNumber] = useState('');
  const [operatorSearch, setOperatorSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ScrapeResult[]>([]);
  const [activeTab, setActiveTab] = useState('faa');
  const [recentRecords, setRecentRecords] = useState<AircraftRegistryEntry[]>([]);
  const [autoSave, setAutoSave] = useState(true);
  
  const { isSaving, saveMultipleRecords, getRecentRecords } = useAircraftRegistry();

  useEffect(() => {
    loadRecentRecords();
  }, []);

  const loadRecentRecords = async () => {
    const records = await getRecentRecords(10);
    setRecentRecords(records);
  };

  const addResult = (result: ScrapeResult) => {
    setResults(prev => [result, ...prev].slice(0, 50));
  };

  const handleFaaLookup = async () => {
    if (!nNumber.trim()) {
      toast.error('Please enter an N-Number');
      return;
    }

    setIsLoading(true);
    const cleanNNumber = nNumber.trim().toUpperCase().replace(/^N/, '');
    
    try {
      toast.info(`Looking up N${cleanNNumber} in FAA Registry...`);
      const response = await firecrawlApi.lookupFaaRegistry(cleanNNumber);
      
      const rawData = response.data?.data || response.data;
      const markdown = rawData?.markdown || '';
      
      // Parse the FAA response into structured records
      const parsedRecords = parseFAAMarkdown(markdown, `N${cleanNNumber}`);
      
      const result: ScrapeResult = {
        source: 'FAA Registry',
        registration: `N${cleanNNumber}`,
        timestamp: new Date().toISOString(),
        success: response.success,
        data: rawData,
        error: response.error,
        parsedRecords,
        savedToDb: false
      };

      // Auto-save if enabled and we have parsed records
      if (autoSave && response.success && parsedRecords.length > 0) {
        const savedCount = await saveMultipleRecords(parsedRecords, rawData);
        result.savedToDb = savedCount > 0;
        if (savedCount > 0) {
          loadRecentRecords();
        }
      }

      addResult(result);

      if (response.success) {
        const recordCount = parsedRecords.length;
        toast.success(`FAA data retrieved for N${cleanNNumber} (${recordCount} record${recordCount !== 1 ? 's' : ''})`);
      } else {
        toast.error(`FAA lookup failed: ${response.error}`);
      }
    } catch (error) {
      toast.error('Failed to scrape FAA Registry');
      addResult({
        source: 'FAA Registry',
        registration: `N${cleanNNumber}`,
        timestamp: new Date().toISOString(),
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFlightAwareLookup = async () => {
    if (!nNumber.trim()) {
      toast.error('Please enter a registration');
      return;
    }

    setIsLoading(true);
    const cleanReg = nNumber.trim().toUpperCase();
    
    try {
      toast.info(`Looking up ${cleanReg} on FlightAware...`);
      const response = await firecrawlApi.lookupFlightAware(cleanReg);
      
      addResult({
        source: 'FlightAware',
        registration: cleanReg,
        timestamp: new Date().toISOString(),
        success: response.success,
        data: response.data?.data || response.data,
        error: response.error
      });

      if (response.success) {
        toast.success(`FlightAware data retrieved for ${cleanReg}`);
      } else {
        toast.error(`FlightAware lookup failed: ${response.error}`);
      }
    } catch (error) {
      toast.error('Failed to scrape FlightAware');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOperatorSearch = async () => {
    if (!operatorSearch.trim()) {
      toast.error('Please enter operator/company name');
      return;
    }

    setIsLoading(true);
    
    try {
      toast.info(`Searching for "${operatorSearch}"...`);
      const response = await firecrawlApi.searchShellCompany(operatorSearch);
      
      addResult({
        source: 'Web Search',
        timestamp: new Date().toISOString(),
        success: response.success,
        data: response.data || response,
        error: response.error
      });

      if (response.success) {
        toast.success(`Found results for "${operatorSearch}"`);
      } else {
        toast.error(`Search failed: ${response.error}`);
      }
    } catch (error) {
      toast.error('Search failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkLookup = async (registrations: string[]) => {
    setIsLoading(true);
    toast.info(`Starting bulk lookup for ${registrations.length} aircraft...`);

    for (const reg of registrations) {
      try {
        const cleanReg = reg.replace(/^N/, '');
        const response = await firecrawlApi.lookupFaaRegistry(cleanReg);
        
        const rawData = response.data?.data || response.data;
        const markdown = rawData?.markdown || '';
        const parsedRecords = parseFAAMarkdown(markdown, reg);
        
        const result: ScrapeResult = {
          source: 'FAA Registry (Bulk)',
          registration: reg,
          timestamp: new Date().toISOString(),
          success: response.success,
          data: rawData,
          error: response.error,
          parsedRecords,
          savedToDb: false
        };

        if (autoSave && response.success && parsedRecords.length > 0) {
          const savedCount = await saveMultipleRecords(parsedRecords, rawData);
          result.savedToDb = savedCount > 0;
        }

        addResult(result);
        
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 1500));
      } catch (error) {
        addResult({
          source: 'FAA Registry (Bulk)',
          registration: reg,
          timestamp: new Date().toISOString(),
          success: false,
          error: 'Lookup failed'
        });
      }
    }

    setIsLoading(false);
    toast.success('Bulk lookup complete');
    loadRecentRecords();
  };

  const handleSaveResult = async (result: ScrapeResult) => {
    if (!result.parsedRecords || result.parsedRecords.length === 0) {
      toast.error('No parsed data to save');
      return;
    }

    const savedCount = await saveMultipleRecords(result.parsedRecords, result.data);
    if (savedCount > 0) {
      // Update the result to show it's saved
      setResults(prev => prev.map(r => 
        r === result ? { ...r, savedToDb: true } : r
      ));
      loadRecentRecords();
    }
  };

  // Known watchlist for quick lookup
  const watchlistAircraft = [
    'N912KC', 'N913KC', 'N790FA', 'N788FA', 'N791FA',
    'N2464D', 'N743AM', 'N229AM', 'N139HP', 'N74FF'
  ];

  return (
    <CyberPanel title="Flight Data Scraper" icon={<Search className="h-5 w-5" />}>
      <div className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="faa" className="text-xs">
              <Plane className="h-3 w-3 mr-1" />
              FAA Registry
            </TabsTrigger>
            <TabsTrigger value="flightaware" className="text-xs">
              <Database className="h-3 w-3 mr-1" />
              FlightAware
            </TabsTrigger>
            <TabsTrigger value="operator" className="text-xs">
              <Building2 className="h-3 w-3 mr-1" />
              Operator
            </TabsTrigger>
            <TabsTrigger value="saved" className="text-xs">
              <History className="h-3 w-3 mr-1" />
              Saved
            </TabsTrigger>
          </TabsList>

          <TabsContent value="faa" className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Enter N-Number (e.g., N912KC)"
                value={nNumber}
                onChange={(e) => setNNumber(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleFaaLookup()}
              />
              <Button onClick={handleFaaLookup} disabled={isLoading}>
                {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Lookup'}
              </Button>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-1">
                {watchlistAircraft.slice(0, 5).map(reg => (
                  <Badge 
                    key={reg}
                    variant="outline"
                    className="cursor-pointer hover:bg-primary/20 text-xs"
                    onClick={() => setNNumber(reg)}
                  >
                    {reg}
                  </Badge>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input 
                  type="checkbox" 
                  checked={autoSave} 
                  onChange={(e) => setAutoSave(e.target.checked)}
                  className="rounded"
                />
                Auto-save
              </label>
            </div>
            
            <Button 
              variant="secondary" 
              size="sm" 
              className="w-full"
              onClick={() => handleBulkLookup(watchlistAircraft)}
              disabled={isLoading}
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              Bulk Lookup All Watchlist ({watchlistAircraft.length})
            </Button>
          </TabsContent>

          <TabsContent value="flightaware" className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Enter registration (e.g., N912KC)"
                value={nNumber}
                onChange={(e) => setNNumber(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleFlightAwareLookup()}
              />
              <Button onClick={handleFlightAwareLookup} disabled={isLoading}>
                {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Search'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Scrapes flight history, routes, and operator information from FlightAware.
            </p>
          </TabsContent>

          <TabsContent value="operator" className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Enter operator/company name (e.g., ALF IX LLC)"
                value={operatorSearch}
                onChange={(e) => setOperatorSearch(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleOperatorSearch()}
              />
              <Button onClick={handleOperatorSearch} disabled={isLoading}>
                {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Search'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {['ALF IX LLC', 'FF22 LLC', 'AERO EQUITIES LLC', 'Air Methods', 'Christiansen Aviation'].map(op => (
                <Badge 
                  key={op}
                  variant="outline"
                  className="cursor-pointer hover:bg-primary/20 text-xs"
                  onClick={() => setOperatorSearch(op)}
                >
                  {op}
                </Badge>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="saved" className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Recently Saved Aircraft</span>
              <Button variant="ghost" size="sm" onClick={loadRecentRecords}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Refresh
              </Button>
            </div>
            <ScrollArea className="h-[250px]">
              {recentRecords.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No saved records yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentRecords.map(record => (
                    <div key={record.id} className="p-2 rounded border bg-background/50">
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary">{record.n_number}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(record.scraped_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs mt-1">
                        {[record.aircraft_manufacturer, record.aircraft_model].filter(Boolean).join(' ') || 'Unknown aircraft'}
                      </p>
                      {record.registrant_name && (
                        <p className="text-xs text-muted-foreground">{record.registrant_name}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Results */}
        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Scrape Results ({results.length})</span>
            {results.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setResults([])}>
                Clear
              </Button>
            )}
          </div>
          
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {results.map((result, idx) => (
                <div 
                  key={idx} 
                  className={`p-3 rounded border ${
                    result.success 
                      ? 'border-green-500/30 bg-green-500/5' 
                      : 'border-red-500/30 bg-red-500/5'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      {result.success ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="font-medium text-sm">{result.source}</span>
                      {result.registration && (
                        <Badge variant="secondary" className="text-xs">{result.registration}</Badge>
                      )}
                      {result.parsedRecords && result.parsedRecords.length > 1 && (
                        <Badge variant="outline" className="text-xs">
                          <List className="h-3 w-3 mr-1" />
                          {result.parsedRecords.length} records
                        </Badge>
                      )}
                      {result.savedToDb && (
                        <Badge variant="default" className="text-xs bg-blue-500">
                          <Save className="h-3 w-3 mr-1" />
                          Saved
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {new Date(result.timestamp).toLocaleTimeString()}
                      </span>
                      {result.success && result.parsedRecords && !result.savedToDb && (
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => handleSaveResult(result)}
                          disabled={isSaving}
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {result.error && (
                    <p className="text-xs text-red-400">{result.error}</p>
                  )}
                  
                  {result.success && result.parsedRecords && result.parsedRecords.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {result.parsedRecords.map((record, rIdx) => (
                        <div key={rIdx} className="text-xs bg-background/50 p-2 rounded">
                          <div className="font-medium text-primary">{record.nNumber}</div>
                          <div className="text-muted-foreground">
                            {formatRecordForDisplay(record) || 'No structured data extracted'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {result.success && (!result.parsedRecords || result.parsedRecords.length === 0) && result.data && (
                    <div className="mt-2">
                      {result.data.markdown ? (
                        <pre className="text-xs bg-background/50 p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap">
                          {result.data.markdown.slice(0, 500)}
                          {result.data.markdown.length > 500 && '...'}
                        </pre>
                      ) : (
                        <pre className="text-xs bg-background/50 p-2 rounded max-h-32 overflow-auto">
                          {JSON.stringify(result.data, null, 2).slice(0, 500)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
              
              {results.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No scrape results yet</p>
                  <p className="text-xs">Use the tools above to scrape flight data</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </CyberPanel>
  );
}
