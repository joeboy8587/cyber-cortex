import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Upload, FileText, Plane, Scale, Calendar, DollarSign, 
  Building2, CheckCircle2, AlertCircle, Loader2, Database,
  Link2, Hash
} from 'lucide-react';

interface ExtractionResult {
  aircraft: string[];
  legalCitations: { type: string; title: string; section: string; raw: string }[];
  dollarAmounts: string[];
  dates: { raw: string; parsed: string | null }[];
  entities: { name: string; confidence: number }[];
  exhibits: string[];
  wordCount: number;
  sectionHeadings: string[];
}

interface ParseResult {
  success: boolean;
  documentHash: string;
  extractions: ExtractionResult;
  crossLinks: {
    aircraftMatches: number;
    entityMatches: number;
    flightCorrelations: number;
  };
  summary: {
    aircraftFound: number;
    citationsFound: number;
    entitiesFound: number;
    datesFound: number;
    amountsFound: number;
    exhibitsFound: number;
    existingAircraftMatches: number;
    existingEntityMatches: number;
    flightCorrelations: number;
  };
}

export function LegalIntelUploader() {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const { toast } = useToast();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.md') || droppedFile.name.endsWith('.txt'))) {
      processFile(droppedFile);
    } else {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a markdown (.md) or text (.txt) file',
        variant: 'destructive'
      });
    }
  }, [toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
    }
  }, []);

  const processFile = async (f: File) => {
    setFile(f);
    const text = await f.text();
    setContent(text);
    setParseResult(null);
  };

  const handleParse = async () => {
    if (!content) return;
    
    setParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke('legal-intel-parser', {
        body: { action: 'parse', content, filename: file?.name }
      });

      if (error) throw error;
      
      setParseResult(data);
      toast({
        title: 'Document Parsed',
        description: `Found ${data.summary.aircraftFound} aircraft, ${data.summary.citationsFound} citations, ${data.summary.entitiesFound} entities`
      });
    } catch (error: any) {
      toast({
        title: 'Parse Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setParsing(false);
    }
  };

  const handleEnrich = async () => {
    if (!content) return;
    
    setEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke('legal-intel-parser', {
        body: { action: 'enrich', content, filename: file?.name }
      });

      if (error) throw error;
      
      setParseResult(data);
      toast({
        title: 'Database Enriched',
        description: 'Document stored and cross-linked in NeonDB'
      });
    } catch (error: any) {
      toast({
        title: 'Enrichment Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setEnriching(false);
    }
  };

  const getConfidenceBadgeVariant = (confidence: number): "default" | "secondary" | "destructive" | "outline" => {
    if (confidence >= 70) return 'default';
    if (confidence >= 40) return 'secondary';
    return 'outline';
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Legal Intel Document Uploader
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragging 
              ? 'border-primary bg-primary/10' 
              : 'border-muted-foreground/30 hover:border-primary/50'
          }`}
        >
          <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-2">
            Drag and drop your Watchtower investigation files here
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Supports .md and .txt files (EXHIBIT_E, FALSE_CLAIMS_ACT, etc.)
          </p>
          <input
            type="file"
            accept=".md,.txt"
            onChange={handleFileSelect}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload">
            <Button variant="outline" asChild>
              <span>Select File</span>
            </Button>
          </label>
        </div>

        {/* File Info */}
        {file && (
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{file.name}</span>
              <Badge variant="outline">{(file.size / 1024).toFixed(1)} KB</Badge>
            </div>
            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={handleParse}
                disabled={parsing || enriching}
              >
                {parsing ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Parsing...</>
                ) : (
                  <><Scale className="h-4 w-4 mr-2" /> Parse Document</>
                )}
              </Button>
              <Button 
                size="sm" 
                variant="default"
                onClick={handleEnrich}
                disabled={parsing || enriching || !parseResult}
              >
                {enriching ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enriching...</>
                ) : (
                  <><Database className="h-4 w-4 mr-2" /> Enrich NeonDB</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Parse Results */}
        {parseResult && (
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="aircraft">Aircraft</TabsTrigger>
              <TabsTrigger value="citations">Citations</TabsTrigger>
              <TabsTrigger value="entities">Entities</TabsTrigger>
              <TabsTrigger value="dates">Dates</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="space-y-4">
              {/* Hash & Cross-links */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="p-4 bg-muted/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Hash className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Document Hash</span>
                  </div>
                  <code className="text-xs text-muted-foreground break-all">
                    {parseResult.documentHash?.substring(0, 32)}...
                  </code>
                </Card>
                <Card className="p-4 bg-muted/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Link2 className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Cross-Links Found</span>
                  </div>
                  <div className="flex gap-2">
                    <Badge>{parseResult.crossLinks.aircraftMatches} aircraft</Badge>
                    <Badge variant="secondary">{parseResult.crossLinks.flightCorrelations} flights</Badge>
                    <Badge variant="outline">{parseResult.crossLinks.entityMatches} entities</Badge>
                  </div>
                </Card>
              </div>

              {/* Extraction Stats */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                <div className="p-3 bg-muted rounded-lg text-center">
                  <Plane className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <div className="text-2xl font-bold">{parseResult.summary.aircraftFound}</div>
                  <div className="text-xs text-muted-foreground">Aircraft</div>
                </div>
                <div className="p-3 bg-muted rounded-lg text-center">
                  <Scale className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <div className="text-2xl font-bold">{parseResult.summary.citationsFound}</div>
                  <div className="text-xs text-muted-foreground">Citations</div>
                </div>
                <div className="p-3 bg-muted rounded-lg text-center">
                  <Building2 className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <div className="text-2xl font-bold">{parseResult.summary.entitiesFound}</div>
                  <div className="text-xs text-muted-foreground">Entities</div>
                </div>
                <div className="p-3 bg-muted rounded-lg text-center">
                  <Calendar className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <div className="text-2xl font-bold">{parseResult.summary.datesFound}</div>
                  <div className="text-xs text-muted-foreground">Dates</div>
                </div>
                <div className="p-3 bg-muted rounded-lg text-center">
                  <DollarSign className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <div className="text-2xl font-bold">{parseResult.summary.amountsFound}</div>
                  <div className="text-xs text-muted-foreground">Amounts</div>
                </div>
                <div className="p-3 bg-muted rounded-lg text-center">
                  <FileText className="h-5 w-5 mx-auto mb-1 text-primary" />
                  <div className="text-2xl font-bold">{parseResult.summary.exhibitsFound}</div>
                  <div className="text-xs text-muted-foreground">Exhibits</div>
                </div>
              </div>

              {/* Section Headings */}
              {parseResult.extractions.sectionHeadings.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Document Structure</h4>
                  <div className="flex flex-wrap gap-1">
                    {parseResult.extractions.sectionHeadings.slice(0, 10).map((heading, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {heading.length > 40 ? heading.substring(0, 40) + '...' : heading}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="aircraft">
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {parseResult.extractions.aircraft.map((aircraft, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-muted rounded">
                      <div className="flex items-center gap-2">
                        <Plane className="h-4 w-4 text-primary" />
                        <span className="font-mono font-medium">{aircraft}</span>
                      </div>
                      {parseResult.crossLinks.aircraftMatches > 0 && (
                        <Badge variant="default">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          In Database
                        </Badge>
                      )}
                    </div>
                  ))}
                  {parseResult.extractions.aircraft.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No aircraft registrations found
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="citations">
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {parseResult.extractions.legalCitations.map((citation, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-muted rounded">
                      <div className="flex items-center gap-2">
                        <Scale className="h-4 w-4 text-primary" />
                        <span className="font-medium">{citation.raw}</span>
                      </div>
                      <Badge variant="secondary">{citation.type}</Badge>
                    </div>
                  ))}
                  {parseResult.extractions.legalCitations.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No legal citations found
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="entities">
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {parseResult.extractions.entities.map((entity, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-muted rounded">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary" />
                        <span className="font-medium">{entity.name}</span>
                      </div>
                      <Badge variant={getConfidenceBadgeVariant(entity.confidence)}>
                        {entity.confidence}% confidence
                      </Badge>
                    </div>
                  ))}
                  {parseResult.extractions.entities.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No entities found
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="dates">
              <ScrollArea className="h-64">
                <div className="grid grid-cols-2 gap-2">
                  {parseResult.extractions.dates.map((date, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-muted rounded">
                      <Calendar className="h-4 w-4 text-primary" />
                      <span className="text-sm">{date.raw}</span>
                    </div>
                  ))}
                  {parseResult.extractions.dollarAmounts.map((amount, i) => (
                    <div key={`amt-${i}`} className="flex items-center gap-2 p-2 bg-muted rounded">
                      <DollarSign className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-medium">{amount}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
