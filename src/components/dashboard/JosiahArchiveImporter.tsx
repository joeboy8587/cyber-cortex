import { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import JSZip from 'jszip';
import { 
  Archive, 
  Upload, 
  Database, 
  AlertTriangle, 
  CheckCircle, 
  Plane, 
  Heart, 
  Brain,
  FileJson,
  Link,
  Loader2,
  FileArchive
} from 'lucide-react';
import { toast } from 'sonner';

interface ImportStats {
  imported_flights?: number;
  hypotheses?: number;
  unique_aircraft?: number;
}

interface CorrelationResult {
  registration: string;
  correlation_count: number;
  avg_hr: number;
  min_hrv: number;
  avg_time_diff: number;
}

interface ExtractedFile {
  name: string;
  content: string;
}

export const JosiahArchiveImporter = () => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentAction, setCurrentAction] = useState('');
  const [stats, setStats] = useState<ImportStats>({});
  const [correlations, setCorrelations] = useState<CorrelationResult[]>([]);
  const [extractedFiles, setExtractedFiles] = useState<ExtractedFile[]>([]);
  const [importResults, setImportResults] = useState<{
    flights?: { inserted: number; skipped: number };
    biometrics?: { inserted: number; skipped: number };
    hypotheses?: { inserted: number; skipped: number };
    logs?: { inserted: number; skipped: number };
  }>({});

  const extractZipFile = async (file: File): Promise<ExtractedFile[]> => {
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);
    const extracted: ExtractedFile[] = [];
    
    for (const [filename, zipEntry] of Object.entries(contents.files)) {
      if (!zipEntry.dir && (filename.endsWith('.json') || filename.endsWith('.txt'))) {
        const content = await zipEntry.async('string');
        extracted.push({ name: filename, content });
      }
    }
    
    return extracted;
  };

  const parseJSONContent = (content: string): any[] => {
    try {
      const data = JSON.parse(content);
      return Array.isArray(data) ? data : [data];
    } catch {
      // Try to parse as JSONL
      return content.split('\n')
        .filter(line => line.trim())
        .map(line => {
          try { return JSON.parse(line); } 
          catch { return null; }
        })
        .filter(Boolean);
    }
  };

  const categorizeData = (filename: string, data: any[]): { type: string; records: any[] } => {
    const lowerName = filename.toLowerCase();
    
    if (lowerName.includes('flight') || lowerName.includes('detection')) {
      return { type: 'flights', records: data };
    }
    if (lowerName.includes('biometric') || lowerName.includes('heart') || lowerName.includes('hrv')) {
      return { type: 'biometrics', records: data };
    }
    if (lowerName.includes('hypothesis') || lowerName.includes('pattern')) {
      return { type: 'hypotheses', records: data };
    }
    if (lowerName.includes('log') || lowerName.includes('reflection')) {
      return { type: 'logs', records: data };
    }
    
    // Auto-detect based on content
    if (data.length > 0) {
      const sample = data[0];
      if (sample.registration || sample.icao24 || sample.altitude) {
        return { type: 'flights', records: data };
      }
      if (sample.heart_rate || sample.hrv || sample.stress_level) {
        return { type: 'biometrics', records: data };
      }
      if (sample.hypothesis || sample.confidence || sample.pattern_type) {
        return { type: 'hypotheses', records: data };
      }
    }
    
    return { type: 'logs', records: data };
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    setProgress(0);
    setImportResults({});
    setExtractedFiles([]);

    const categorizedData: Record<string, any[]> = {
      flights: [],
      biometrics: [],
      hypotheses: [],
      logs: []
    };

    const allExtracted: ExtractedFile[] = [];

    try {
      // Extract and parse all files
      setCurrentAction('Extracting files...');
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(Math.round((i / files.length) * 20));
        
        if (file.name.endsWith('.zip')) {
          // Extract ZIP file
          const extracted = await extractZipFile(file);
          allExtracted.push(...extracted);
          
          for (const ef of extracted) {
            const data = parseJSONContent(ef.content);
            const { type, records } = categorizeData(ef.name, data);
            categorizedData[type].push(...records);
          }
        } else if (file.name.endsWith('.json') || file.name.endsWith('.txt')) {
          const content = await file.text();
          allExtracted.push({ name: file.name, content });
          const data = parseJSONContent(content);
          const { type, records } = categorizeData(file.name, data);
          categorizedData[type].push(...records);
        }
      }

      setExtractedFiles(allExtracted);
      setProgress(30);

      // Import flights
      if (categorizedData.flights.length > 0) {
        setCurrentAction(`Importing ${categorizedData.flights.length} flight detections...`);
        setProgress(40);
        
        const { data: flightResult } = await supabase.functions.invoke('josiah-archive-import', {
          body: { action: 'importFlightDetections', data: categorizedData.flights }
        });
        
        if (flightResult?.success) {
          setImportResults(prev => ({ ...prev, flights: flightResult }));
        }
      }

      // Import biometrics
      if (categorizedData.biometrics.length > 0) {
        setCurrentAction(`Importing ${categorizedData.biometrics.length} biometric records...`);
        setProgress(55);
        
        const { data: bioResult } = await supabase.functions.invoke('josiah-archive-import', {
          body: { action: 'importBiometrics', data: categorizedData.biometrics }
        });
        
        if (bioResult?.success) {
          setImportResults(prev => ({ ...prev, biometrics: bioResult }));
        }
      }

      // Import hypotheses
      if (categorizedData.hypotheses.length > 0) {
        setCurrentAction(`Importing ${categorizedData.hypotheses.length} hypotheses...`);
        setProgress(70);
        
        const { data: hypResult } = await supabase.functions.invoke('josiah-archive-import', {
          body: { action: 'importHypotheses', data: categorizedData.hypotheses }
        });
        
        if (hypResult?.success) {
          setImportResults(prev => ({ ...prev, hypotheses: hypResult }));
        }
      }

      // Import logs
      if (categorizedData.logs.length > 0) {
        setCurrentAction(`Importing ${categorizedData.logs.length} log entries...`);
        setProgress(85);
        
        const { data: logResult } = await supabase.functions.invoke('josiah-archive-import', {
          body: { action: 'importLogs', data: categorizedData.logs }
        });
        
        if (logResult?.success) {
          setImportResults(prev => ({ ...prev, logs: logResult }));
        }
      }

      // Run correlations
      setCurrentAction('Running biometric-flight correlations...');
      setProgress(95);
      
      const { data: correlationResult } = await supabase.functions.invoke('josiah-archive-import', {
        body: { action: 'correlateWithExisting' }
      });
      
      if (correlationResult?.data) {
        setCorrelations(correlationResult.data);
      }

      // Get final stats
      const { data: statsResult } = await supabase.functions.invoke('josiah-archive-import', {
        body: { action: 'getImportStats' }
      });
      
      if (statsResult?.stats) {
        setStats(statsResult.stats);
      }

      setProgress(100);
      setCurrentAction('Import complete!');
      toast.success('Archive import completed successfully');

    } catch (error) {
      console.error('Import error:', error);
      toast.error('Import failed: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const runCorrelations = async () => {
    setLoading(true);
    setCurrentAction('Running deep correlations...');
    
    try {
      const { data } = await supabase.functions.invoke('josiah-archive-import', {
        body: { action: 'correlateWithExisting' }
      });
      
      if (data?.data) {
        setCorrelations(data.data);
        toast.success(`Found ${data.correlations} aircraft-biometric correlations`);
      }
    } catch (error) {
      toast.error('Correlation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <CyberPanel 
      title="JOSIAH ARCHIVE IMPORTER" 
      icon={<Archive className="h-5 w-5" />}
      className="col-span-2"
    >
      {/* Upload Section */}
      <div className="mb-6">
        <div className="border-2 border-dashed border-primary/30 rounded-lg p-6 text-center bg-background/50">
          <FileArchive className="h-12 w-12 mx-auto mb-4 text-primary/60" />
          <p className="text-sm text-muted-foreground mb-4">
            Upload ZIP archives or JSON files from Josiah OCR/NLP processing
          </p>
          <input
            type="file"
            multiple
            accept=".json,.txt,.zip"
            onChange={handleFileUpload}
            className="hidden"
            id="archive-upload"
            disabled={loading}
          />
          <label htmlFor="archive-upload">
            <Button variant="outline" disabled={loading} asChild>
              <span>
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Select Files or ZIPs
              </span>
            </Button>
          </label>
          <p className="text-xs text-muted-foreground mt-2">
            Supports: .zip archives, flight_detections.json, biometrics.json, hypotheses.json
          </p>
        </div>
      </div>

      {/* Extracted Files List */}
      {extractedFiles.length > 0 && (
        <div className="mb-4 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <FileArchive className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Extracted {extractedFiles.length} files</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {extractedFiles.slice(0, 10).map((f, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {f.name.split('/').pop()}
              </Badge>
            ))}
            {extractedFiles.length > 10 && (
              <Badge variant="secondary" className="text-xs">
                +{extractedFiles.length - 10} more
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Progress */}
      {loading && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{currentAction}</span>
            <span className="text-primary font-mono">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Import Results */}
      {Object.keys(importResults).length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-center">
            <Plane className="h-5 w-5 mx-auto mb-1 text-blue-400" />
            <div className="text-lg font-mono text-blue-400">
              {importResults.flights?.inserted || 0}
            </div>
            <div className="text-xs text-muted-foreground">Flights Imported</div>
          </div>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
            <Heart className="h-5 w-5 mx-auto mb-1 text-red-400" />
            <div className="text-lg font-mono text-red-400">
              {importResults.biometrics?.inserted || 0}
            </div>
            <div className="text-xs text-muted-foreground">Biometrics</div>
          </div>
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 text-center">
            <Brain className="h-5 w-5 mx-auto mb-1 text-purple-400" />
            <div className="text-lg font-mono text-purple-400">
              {importResults.hypotheses?.inserted || 0}
            </div>
            <div className="text-xs text-muted-foreground">Hypotheses</div>
          </div>
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 text-center">
            <FileJson className="h-5 w-5 mx-auto mb-1 text-cyan-400" />
            <div className="text-lg font-mono text-cyan-400">
              {importResults.logs?.inserted || 0}
            </div>
            <div className="text-xs text-muted-foreground">Logs</div>
          </div>
        </div>
      )}

      {/* Database Stats */}
      {stats.imported_flights !== undefined && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Database className="h-4 w-4 text-primary" />
            <span className="font-medium">Archive Import Totals</span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Flights: </span>
              <span className="font-mono text-primary">{stats.imported_flights?.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Hypotheses: </span>
              <span className="font-mono text-primary">{stats.hypotheses?.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Unique Aircraft: </span>
              <span className="font-mono text-primary">{stats.unique_aircraft?.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Correlations */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Link className="h-4 w-4 text-primary" />
          <span className="font-medium">Aircraft-Biometric Correlations</span>
        </div>
        <Button variant="outline" size="sm" onClick={runCorrelations} disabled={loading}>
          Run Correlations
        </Button>
      </div>

      {correlations.length > 0 ? (
        <ScrollArea className="h-[200px]">
          <div className="space-y-2">
            {correlations.map((corr, idx) => (
              <div 
                key={idx}
                className={`p-3 rounded-lg border ${
                  corr.correlation_count > 10 
                    ? 'border-red-500/30 bg-red-500/5' 
                    : 'border-border/30 bg-background/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Plane className="h-4 w-4 text-primary" />
                    <span className="font-mono text-primary font-bold">{corr.registration}</span>
                  </div>
                  <Badge 
                    className={
                      corr.correlation_count > 10 
                        ? 'bg-red-500/20 text-red-400 border-red-500/30'
                        : 'bg-primary/20 text-primary border-primary/30'
                    }
                  >
                    {corr.correlation_count} correlations
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs text-muted-foreground">
                  <div>Avg HR: <span className="text-red-400">{Math.round(corr.avg_hr)} BPM</span></div>
                  <div>Min HRV: <span className="text-orange-400">{Math.round(corr.min_hrv)}ms</span></div>
                  <div>Avg Δt: <span className="text-cyan-400">{Math.round(corr.avg_time_diff)}s</span></div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No correlations found yet. Import archive data first.</p>
        </div>
      )}

      {/* Legal Note */}
      <div className="mt-6 border-t border-border/30 pt-4">
        <div className="text-xs text-muted-foreground">
          <strong className="text-foreground">Chain of Custody:</strong> All imported records 
          are SHA-256 hashed and tagged with source provenance for federal evidence standards. 
          Correlations use ±5 minute temporal windows for Bradford-Hill causation analysis.
        </div>
      </div>
    </CyberPanel>
  );
};
