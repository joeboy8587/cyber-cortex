import { useState, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { 
  Search, Shield, Activity, Camera, Plane, 
  AlertTriangle, CheckCircle2, Clock, Database,
  FileText, Download, RefreshCw
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface EvidenceCategory {
  tables: string[];
  totalRecords: number;
  samples: Record<string, unknown>[];
  dateRange?: { earliest: string; latest: string };
}

interface ScanResult {
  scanTimestamp: string;
  totalTablesScanned: number;
  totalRecordsFound: number;
  categories: {
    kcso_evidence: EvidenceCategory;
    biometric_correlation: EvidenceCategory;
    ocr_data: EvidenceCategory;
    adsb_detections: EvidenceCategory;
  };
  executionTimeMs: number;
}

export function ComprehensiveEvidenceScan() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [results, setResults] = useState<ScanResult | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const runScan = useCallback(async () => {
    setIsScanning(true);
    setScanProgress(10);
    setResults(null);
    
    toast.info('Starting comprehensive evidence scan...');
    
    try {
      setScanProgress(25);
      
      const { data, error } = await supabase.functions.invoke('comprehensive-evidence-scan', {
        body: { action: 'fullScan', sampleLimit: 500 }
      });

      setScanProgress(90);

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setResults(data.data);
      setScanProgress(100);
      
      toast.success(`Scan complete: ${data.data.totalRecordsFound.toLocaleString()} records across ${data.data.totalTablesScanned} tables`);
      
    } catch (err) {
      console.error('Scan error:', err);
      toast.error(`Scan failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const formatNumber = (n: number) => n.toLocaleString();
  
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'kcso_evidence': return <Shield className="h-4 w-4 text-red-400" />;
      case 'biometric_correlation': return <Activity className="h-4 w-4 text-cyan-400" />;
      case 'ocr_data': return <Camera className="h-4 w-4 text-yellow-400" />;
      case 'adsb_detections': return <Plane className="h-4 w-4 text-blue-400" />;
      default: return <Database className="h-4 w-4" />;
    }
  };

  const exportToJSON = () => {
    if (!results) return;
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidence-scan-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Evidence exported to JSON');
  };

  return (
    <CyberPanel 
      title="COMPREHENSIVE EVIDENCE SCAN" 
      icon={<Search className="h-5 w-5 text-cyan-400" />}
      className="h-full"
    >
      <div className="space-y-4">
        {/* Controls */}
        <div className="flex items-center justify-between gap-4">
          <Button
            onClick={runScan}
            disabled={isScanning}
            className="bg-cyan-600 hover:bg-cyan-500"
          >
            {isScanning ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            {isScanning ? 'Scanning...' : 'Run Full Evidence Scan'}
          </Button>
          
          {results && (
            <Button variant="outline" onClick={exportToJSON}>
              <Download className="h-4 w-4 mr-2" />
              Export Results
            </Button>
          )}
        </div>

        {/* Progress */}
        {isScanning && (
          <div className="space-y-2">
            <Progress value={scanProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              Scanning {scanProgress < 50 ? 'KCSO & biometric tables' : scanProgress < 80 ? 'OCR & ADSB detections' : 'finalizing...'}
            </p>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-red-950/30 border border-red-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="h-4 w-4 text-red-400" />
                  <span className="text-xs text-red-400 font-medium">KCSO Evidence</span>
                </div>
                <div className="text-2xl font-bold text-red-300">
                  {formatNumber(results.categories.kcso_evidence.totalRecords)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {results.categories.kcso_evidence.tables.length} tables
                </div>
              </div>

              <div className="bg-cyan-950/30 border border-cyan-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="h-4 w-4 text-cyan-400" />
                  <span className="text-xs text-cyan-400 font-medium">Biometric</span>
                </div>
                <div className="text-2xl font-bold text-cyan-300">
                  {formatNumber(results.categories.biometric_correlation.totalRecords)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {results.categories.biometric_correlation.tables.length} tables
                </div>
              </div>

              <div className="bg-yellow-950/30 border border-yellow-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Camera className="h-4 w-4 text-yellow-400" />
                  <span className="text-xs text-yellow-400 font-medium">OCR Data</span>
                </div>
                <div className="text-2xl font-bold text-yellow-300">
                  {formatNumber(results.categories.ocr_data.totalRecords)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {results.categories.ocr_data.tables.length} tables
                </div>
              </div>

              <div className="bg-blue-950/30 border border-blue-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Plane className="h-4 w-4 text-blue-400" />
                  <span className="text-xs text-blue-400 font-medium">ADSB Detections</span>
                </div>
                <div className="text-2xl font-bold text-blue-300">
                  {formatNumber(results.categories.adsb_detections.totalRecords)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {results.categories.adsb_detections.tables.length} tables
                </div>
              </div>
            </div>

            {/* Scan Metadata */}
            <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDate(results.scanTimestamp)}
                </span>
                <span className="flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  {formatNumber(results.totalRecordsFound)} total records
                </span>
              </div>
              <Badge variant="outline" className="text-xs">
                {results.executionTimeMs}ms
              </Badge>
            </div>

            {/* Detailed Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="kcso">KCSO</TabsTrigger>
                <TabsTrigger value="biometric">Biometric</TabsTrigger>
                <TabsTrigger value="ocr">OCR</TabsTrigger>
                <TabsTrigger value="adsb">ADSB</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4">
                <ScrollArea className="h-[400px]">
                  <div className="space-y-4">
                    {Object.entries(results.categories).map(([key, category]) => (
                      <div key={key} className="border border-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getCategoryIcon(key)}
                            <span className="font-medium capitalize">
                              {key.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <Badge variant="secondary">
                            {formatNumber(category.totalRecords)} records
                          </Badge>
                        </div>
                        
                        <div className="text-xs text-muted-foreground mb-2">
                          Tables: {category.tables.slice(0, 5).join(', ')}
                          {category.tables.length > 5 && ` +${category.tables.length - 5} more`}
                        </div>
                        
                        {category.dateRange && (
                          <div className="text-xs text-muted-foreground">
                            Date range: {formatDate(category.dateRange.earliest)} → {formatDate(category.dateRange.latest)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>

              {['kcso', 'biometric', 'ocr', 'adsb'].map((cat) => {
                const categoryKey = cat === 'kcso' ? 'kcso_evidence' 
                  : cat === 'biometric' ? 'biometric_correlation'
                  : cat === 'ocr' ? 'ocr_data' : 'adsb_detections';
                const category = results.categories[categoryKey as keyof typeof results.categories];
                
                return (
                  <TabsContent key={cat} value={cat} className="mt-4">
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm text-muted-foreground">
                            {category.samples.length} sample records from {category.tables.length} tables
                          </span>
                          {category.dateRange && (
                            <span className="text-xs text-muted-foreground">
                              {formatDate(category.dateRange.earliest)} → {formatDate(category.dateRange.latest)}
                            </span>
                          )}
                        </div>
                        
                        {category.samples.length === 0 ? (
                          <div className="text-center text-muted-foreground py-8">
                            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            No samples found in this category
                          </div>
                        ) : (
                          category.samples.slice(0, 50).map((sample, idx) => (
                            <div 
                              key={idx}
                              className="border border-border rounded p-2 text-xs font-mono bg-background/50"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-[10px]">
                                  {(sample as Record<string, unknown>)._source as string || 'unknown'}
                                </Badge>
                                {(sample as Record<string, unknown>)._priority === 'PRIMARY' && (
                                  <Badge className="text-[10px] bg-red-600">PRIMARY</Badge>
                                )}
                                {(sample as Record<string, unknown>)._alert && (
                                  <Badge className="text-[10px] bg-orange-600">
                                    {(sample as Record<string, unknown>)._alert as string}
                                  </Badge>
                                )}
                              </div>
                              <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">
                                {JSON.stringify(
                                  Object.fromEntries(
                                    Object.entries(sample).filter(([k]) => !k.startsWith('_')).slice(0, 8)
                                  ), 
                                  null, 1
                                )}
                              </pre>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                );
              })}
            </Tabs>
          </div>
        )}

        {/* Initial State */}
        {!results && !isScanning && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <h3 className="font-medium mb-2">Comprehensive Evidence Scanner</h3>
            <p className="text-sm max-w-md mx-auto">
              Scans all 4M+ records across KCSO evidence, biometric correlations, 
              OCR data, and ADSB flight detections. Results include samples and date ranges.
            </p>
          </div>
        )}
      </div>
    </CyberPanel>
  );
}
