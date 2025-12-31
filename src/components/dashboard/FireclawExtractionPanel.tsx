import { useState, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { firecrawlApi } from '@/lib/api/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { 
  Globe, 
  Plane, 
  Scale, 
  Shield, 
  Download, 
  Hash, 
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Archive,
  FileText,
  Link2,
  Eye
} from 'lucide-react';

interface ExtractedEvidence {
  id: string;
  url: string;
  title: string;
  content: string;
  sha256: string;
  extractedAt: string;
  category: 'flight' | 'legal' | 'civic' | 'surveillance' | 'general';
  metadata?: Record<string, unknown>;
}

// Compute SHA-256 hash of content
async function computeSHA256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function FireclawExtractionPanel() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('extract');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<ExtractedEvidence['category']>('general');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedItems, setExtractedItems] = useState<ExtractedEvidence[]>([]);
  const [selectedItem, setSelectedItem] = useState<ExtractedEvidence | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Quick extraction presets for common targets
  const presets = [
    { 
      label: 'ADS-B Exchange', 
      category: 'flight' as const,
      urlTemplate: 'https://globe.adsbexchange.com/?icao=',
      description: 'Flight tracking data'
    },
    { 
      label: 'FAA Registry', 
      category: 'flight' as const,
      urlTemplate: 'https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=',
      description: 'Aircraft registration'
    },
    { 
      label: 'FlightAware', 
      category: 'flight' as const,
      urlTemplate: 'https://flightaware.com/live/flight/',
      description: 'Flight history'
    },
    { 
      label: 'Kern County', 
      category: 'legal' as const,
      urlTemplate: 'https://www.kerncounty.com/',
      description: 'County documents'
    }
  ];

  const extractUrl = useCallback(async (targetUrl: string, targetCategory: ExtractedEvidence['category']) => {
    if (!targetUrl) {
      toast({ title: 'Error', description: 'URL is required', variant: 'destructive' });
      return;
    }

    setIsExtracting(true);
    try {
      console.log(`[FIRECLAW] Initiating extraction: ${targetUrl}`);
      
      // Scrape the URL using Firecrawl
      const response = await firecrawlApi.scrape(targetUrl, {
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        waitFor: 5000 // Wait for dynamic content
      });

      if (!response.success) {
        throw new Error(response.error || 'Extraction failed');
      }

      const content = response.data?.markdown || response.data?.html || '';
      const title = response.data?.metadata?.title || new URL(targetUrl).hostname;
      
      // Compute SHA-256 hash for chain of custody
      const sha256 = await computeSHA256(content);
      const extractedAt = new Date().toISOString();

      const evidence: ExtractedEvidence = {
        id: crypto.randomUUID(),
        url: targetUrl,
        title,
        content,
        sha256,
        extractedAt,
        category: targetCategory,
        metadata: response.data?.metadata
      };

      // Store in Supabase evidence_documents table
      const { error: dbError } = await supabase
        .from('evidence_documents')
        .insert({
          title: `[FIRECLAW] ${title}`,
          filename: `fireclaw_${Date.now()}.md`,
          content,
          file_size: new TextEncoder().encode(content).length,
          file_type: 'text/markdown',
          tags: [targetCategory, 'fireclaw', 'web-extraction'],
          sha256_hash: sha256
        });

      if (dbError) {
        console.error('[FIRECLAW] Database error:', dbError);
        // Continue anyway - we still have local copy
      }

      setExtractedItems(prev => [evidence, ...prev]);
      
      toast({
        title: 'Extraction Complete',
        description: `${title} preserved with hash ${sha256.slice(0, 12)}...`
      });

      console.log(`[FIRECLAW] Successfully extracted and hashed: ${sha256}`);
      
    } catch (error) {
      console.error('[FIRECLAW] Extraction error:', error);
      toast({
        title: 'Extraction Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsExtracting(false);
    }
  }, [toast]);

  const searchWeb = useCallback(async () => {
    if (!searchQuery) return;
    
    setIsSearching(true);
    try {
      const response = await firecrawlApi.search(searchQuery, {
        limit: 10,
        scrapeOptions: { formats: ['markdown'] }
      });

      if (!response.success) {
        throw new Error(response.error || 'Search failed');
      }

      setSearchResults(response.data || []);
      toast({
        title: 'Search Complete',
        description: `Found ${response.data?.length || 0} results`
      });
    } catch (error) {
      toast({
        title: 'Search Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, toast]);

  const extractFromSearchResult = async (result: any) => {
    if (result.url) {
      await extractUrl(result.url, 'general');
    }
  };

  const downloadEvidence = (item: ExtractedEvidence) => {
    const blob = new Blob([
      `# Fireclaw Evidence Extraction\n\n`,
      `**URL:** ${item.url}\n`,
      `**Extracted:** ${item.extractedAt}\n`,
      `**SHA-256:** ${item.sha256}\n`,
      `**Category:** ${item.category}\n\n`,
      `---\n\n`,
      item.content
    ], { type: 'text/markdown' });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fireclaw_${item.id.slice(0, 8)}_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const categoryColors: Record<ExtractedEvidence['category'], string> = {
    flight: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    legal: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    civic: 'bg-green-500/20 text-green-400 border-green-500/30',
    surveillance: 'bg-red-500/20 text-red-400 border-red-500/30',
    general: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  };

  return (
    <CyberPanel 
      title="FIRECLAW - Digital Extraction & Preservation" 
      icon={<Globe className="h-5 w-5 text-orange-400" />}
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-4 gap-2">
          <TabsTrigger value="extract" className="flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Extract
          </TabsTrigger>
          <TabsTrigger value="search" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Search
          </TabsTrigger>
          <TabsTrigger value="archive" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Archive
          </TabsTrigger>
          <TabsTrigger value="presets" className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Presets
          </TabsTrigger>
        </TabsList>

        <TabsContent value="extract" className="space-y-4">
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Enter URL to extract and preserve..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1 bg-background/50"
              />
              <select 
                value={category}
                onChange={(e) => setCategory(e.target.value as ExtractedEvidence['category'])}
                className="px-3 py-2 bg-background/50 border border-border rounded-md text-sm"
              >
                <option value="general">General</option>
                <option value="flight">Flight Data</option>
                <option value="legal">Legal/Court</option>
                <option value="civic">Civic/Gov</option>
                <option value="surveillance">Surveillance</option>
              </select>
            </div>
            
            <Button 
              onClick={() => extractUrl(url, category)}
              disabled={isExtracting || !url}
              className="w-full"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Extracting & Hashing...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" />
                  Extract & Preserve with Chain of Custody
                </>
              )}
            </Button>
          </div>

          <div className="bg-muted/30 rounded-lg p-3 text-xs space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Hash className="h-3 w-3" />
              <span>All extractions are SHA-256 hashed for cryptographic verification</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Timestamps are recorded in ISO-8601 format</span>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="search" className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search the web for evidence..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchWeb()}
              className="flex-1 bg-background/50"
            />
            <Button onClick={searchWeb} disabled={isSearching || !searchQuery}>
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
            </Button>
          </div>

          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {searchResults.map((result, idx) => (
                <div 
                  key={idx}
                  className="p-3 bg-background/30 rounded-lg border border-border/50 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm truncate">{result.title || 'Untitled'}</h4>
                      <p className="text-xs text-muted-foreground truncate">{result.url}</p>
                    </div>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => extractFromSearchResult(result)}
                    >
                      <Archive className="h-3 w-3 mr-1" />
                      Extract
                    </Button>
                  </div>
                  {result.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{result.description}</p>
                  )}
                </div>
              ))}
              {searchResults.length === 0 && !isSearching && (
                <div className="text-center text-muted-foreground py-8">
                  <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Search the web to find and preserve evidence</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="archive" className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {extractedItems.length} items preserved this session
            </span>
          </div>

          <ScrollArea className="h-[350px]">
            <div className="space-y-2">
              {extractedItems.map((item) => (
                <div 
                  key={item.id}
                  className="p-3 bg-background/30 rounded-lg border border-border/50 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge className={categoryColors[item.category]}>
                          {item.category}
                        </Badge>
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      </div>
                      <h4 className="font-medium text-sm mt-1 truncate">{item.title}</h4>
                      <p className="text-xs text-muted-foreground truncate">{item.url}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => setSelectedItem(item)}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => downloadEvidence(item)}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Hash className="h-3 w-3" />
                    <code className="bg-muted/50 px-1 rounded">{item.sha256.slice(0, 16)}...</code>
                    <Clock className="h-3 w-3 ml-2" />
                    <span>{new Date(item.extractedAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
              {extractedItems.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  <Archive className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No extractions yet this session</p>
                  <p className="text-xs mt-1">Extracted evidence is stored in your database</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="presets" className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {presets.map((preset) => (
              <div 
                key={preset.label}
                className="p-3 bg-background/30 rounded-lg border border-border/50 space-y-2"
              >
                <div className="flex items-center gap-2">
                  {preset.category === 'flight' ? (
                    <Plane className="h-4 w-4 text-blue-400" />
                  ) : (
                    <Scale className="h-4 w-4 text-purple-400" />
                  )}
                  <span className="font-medium text-sm">{preset.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{preset.description}</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="ID/N-Number..."
                    className="flex-1 text-xs h-8 bg-background/50"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const input = e.target as HTMLInputElement;
                        extractUrl(preset.urlTemplate + input.value, preset.category);
                      }
                    }}
                  />
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={(e) => {
                      const input = (e.target as HTMLElement).parentElement?.querySelector('input');
                      if (input?.value) {
                        extractUrl(preset.urlTemplate + input.value, preset.category);
                      }
                    }}
                  >
                    Go
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-400 mt-0.5" />
              <div className="text-xs">
                <p className="font-medium text-orange-400">Evidence Preservation Notice</p>
                <p className="text-muted-foreground mt-1">
                  All extracted content is immediately hashed with SHA-256 and stored with timestamps.
                  This creates an immutable chain of custody for legal proceedings.
                </p>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Evidence Viewer Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-medium">{selectedItem.title}</h3>
                <p className="text-xs text-muted-foreground">{selectedItem.url}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedItem(null)}>
                ✕
              </Button>
            </div>
            <div className="p-4 flex-1 overflow-auto">
              <div className="bg-muted/30 rounded p-3 mb-4 text-xs space-y-1">
                <div><strong>SHA-256:</strong> <code>{selectedItem.sha256}</code></div>
                <div><strong>Extracted:</strong> {selectedItem.extractedAt}</div>
                <div><strong>Category:</strong> {selectedItem.category}</div>
              </div>
              <ScrollArea className="h-[400px]">
                <pre className="text-xs whitespace-pre-wrap font-mono">{selectedItem.content}</pre>
              </ScrollArea>
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button variant="outline" onClick={() => downloadEvidence(selectedItem)}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button onClick={() => setSelectedItem(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </CyberPanel>
  );
}
