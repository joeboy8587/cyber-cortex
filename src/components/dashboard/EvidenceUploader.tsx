import React, { useState, useCallback } from 'react';
import { Upload, FileText, Trash2, Eye, Download, Hash, Calendar, Tag } from 'lucide-react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface EvidenceDocument {
  id: string;
  title: string;
  filename: string;
  content: string;
  file_size: number | null;
  document_type: string | null;
  tags: string[] | null;
  sha256_hash: string | null;
  uploaded_at: string;
}

async function computeSHA256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function EvidenceUploader() {
  const [documents, setDocuments] = useState<EvidenceDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<EvidenceDocument | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const { toast } = useToast();

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('evidence_documents')
        .select('*')
        .order('uploaded_at', { ascending: false });
      
      if (error) throw error;
      setDocuments((data as EvidenceDocument[]) || []);
    } catch (err) {
      toast({
        title: 'Error fetching documents',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsLoading(true);
    let successCount = 0;

    for (const file of Array.from(files)) {
      if (!file.name.endsWith('.md') && !file.name.endsWith('.txt')) {
        toast({
          title: 'Invalid file type',
          description: `${file.name} is not a markdown or text file`,
          variant: 'destructive'
        });
        continue;
      }

      try {
        const content = await file.text();
        const sha256 = await computeSHA256(content);
        
        // Extract title from first heading or filename
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : file.name.replace(/\.(md|txt)$/, '');
        
        // Extract tags from content (look for keywords)
        const tags: string[] = [];
        if (content.toLowerCase().includes('rico')) tags.push('RICO');
        if (content.toLowerCase().includes('qui tam')) tags.push('Qui Tam');
        if (content.toLowerCase().includes('false claims')) tags.push('FCA');
        if (content.toLowerCase().includes('kcso')) tags.push('KCSO');
        if (content.toLowerCase().includes('fraud')) tags.push('Fraud');
        if (content.toLowerCase().includes('evidence')) tags.push('Evidence');

        // Insert into local Supabase table (for local reference)
        const { error } = await supabase
          .from('evidence_documents')
          .insert({
            title,
            filename: file.name,
            content,
            file_size: file.size,
            document_type: 'evidence',
            tags: tags.length > 0 ? tags : null,
            sha256_hash: sha256
          });

        if (error) throw error;

        // ALSO mirror to Neon evidence_documents table for cross-case correlation
        try {
          await supabase.functions.invoke('neon-query', {
            body: {
              action: 'customQuery',
              query: `
                INSERT INTO evidence_documents (
                  document_id, document_type, file_name, file_type, file_size_bytes,
                  sha256_hash, upload_timestamp, content_summary, tags, processing_status, classification, admissible
                ) VALUES (
                  '${sha256.slice(0, 32)}',
                  'evidence',
                  '${file.name.replace(/'/g, "''")}',
                  '${file.name.endsWith('.md') ? 'markdown' : 'text'}',
                  ${file.size},
                  '${sha256}',
                  NOW(),
                  '${title.replace(/'/g, "''")}',
                  ARRAY[${tags.map(t => `'${t}'`).join(',') || "''"}]::text[],
                  'indexed',
                  'legal_evidence',
                  true
                )
                ON CONFLICT (sha256_hash) DO NOTHING
              `
            }
          });
          console.log(`Mirrored ${file.name} to Neon evidence_documents`);
        } catch (neonErr) {
          console.warn('Neon mirror optional, continuing:', neonErr);
        }

        successCount++;
      } catch (err) {
        toast({
          title: `Failed to upload ${file.name}`,
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive'
        });
      }
    }

    if (successCount > 0) {
      toast({
        title: 'Upload complete',
        description: `${successCount} document(s) uploaded successfully`
      });
      fetchDocuments();
    }
    setIsLoading(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('evidence_documents')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      toast({ title: 'Document deleted' });
      fetchDocuments();
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const downloadDocument = (doc: EvidenceDocument) => {
    const blob = new Blob([doc.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <CyberPanel title="EVIDENCE DOCUMENT UPLOADER" icon={<Upload className="w-5 h-5" />}>
      <div className="space-y-4">
        {/* Upload Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive
              ? 'border-primary bg-primary/10'
              : 'border-muted-foreground/30 hover:border-primary/50'
          }`}
        >
          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-2">
            Drag & drop markdown (.md) or text (.txt) files here
          </p>
          <p className="text-xs text-muted-foreground mb-4">or</p>
          <Input
            type="file"
            accept=".md,.txt"
            multiple
            onChange={(e) => handleFileUpload(e.target.files)}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload">
            <Button variant="outline" asChild disabled={isLoading}>
              <span>{isLoading ? 'Uploading...' : 'Browse Files'}</span>
            </Button>
          </label>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-primary">{documents.length}</div>
            <div className="text-xs text-muted-foreground">Documents</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-400">
              {documents.filter(d => d.sha256_hash).length}
            </div>
            <div className="text-xs text-muted-foreground">SHA-256 Verified</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-cyan-400">
              {formatSize(documents.reduce((acc, d) => acc + (d.file_size || 0), 0))}
            </div>
            <div className="text-xs text-muted-foreground">Total Size</div>
          </div>
        </div>

        {/* Document List */}
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {documents.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No documents uploaded yet
              </div>
            ) : (
              documents.map((doc) => (
                <div
                  key={doc.id}
                  className="bg-muted/20 rounded-lg p-3 border border-border/50 hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                        <span className="font-medium text-sm truncate">{doc.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        {doc.filename} • {formatSize(doc.file_size)}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <Calendar className="w-3 h-3" />
                        {formatDate(doc.uploaded_at)}
                      </div>
                      {doc.tags && doc.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {doc.tags.map((tag, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              <Tag className="w-2 h-2 mr-1" />
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {doc.sha256_hash && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-green-400 font-mono">
                          <Hash className="w-3 h-3" />
                          {doc.sha256_hash.slice(0, 16)}...
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedDoc(doc)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl max-h-[80vh]">
                          <DialogHeader>
                            <DialogTitle>{doc.title}</DialogTitle>
                          </DialogHeader>
                          <ScrollArea className="h-[60vh]">
                            <pre className="whitespace-pre-wrap text-sm font-mono p-4 bg-muted/30 rounded">
                              {doc.content}
                            </pre>
                          </ScrollArea>
                        </DialogContent>
                      </Dialog>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadDocument(doc)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(doc.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Chain of Custody Notice */}
        <div className="text-xs text-muted-foreground bg-muted/20 rounded p-3 border-l-2 border-primary">
          <strong>Chain of Custody:</strong> All uploaded documents are SHA-256 fingerprinted upon upload.
          This cryptographic hash ensures tamper-evidence for legal proceedings.
        </div>
      </div>
    </CyberPanel>
  );
}
