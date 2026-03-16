import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { Download, FileText, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface ExportPackage {
  metadata: {
    generated_at: string;
    package_type: string;
    classification: string;
    total_events: number;
    total_chain_links: number;
    total_entities: number;
    bradford_hill_threshold: number;
    merkle_chain_integrity: string;
    merkle_latest_sequence: number;
    merkle_latest_hash: string;
  };
  forensic_events: Array<{
    forensic_event_id: string;
    event_timestamp: string;
    event_type: string;
    primary_entity_id: string;
    bradford_hill_score: number;
    confidence_score: number;
    summary: string;
    is_physical_verified: boolean;
    chain_links: Array<{
      source_table: string;
      source_id: string;
      link_type: string;
      link_confidence: number;
    }>;
  }>;
  entity_profiles: Array<{
    canonical_identifier: string;
    entity_type: string;
    threat_classification: string;
  }>;
  merkle_proof: {
    chain_status: string;
    verification_note: string;
  };
  legal_framework: {
    statutes: string[];
    bradford_hill_criteria: string;
    evidence_standard: string;
  };
}

interface ForensicExportPanelProps {
  onClose?: () => void;
}

export function ForensicExportPanel({ onClose }: ForensicExportPanelProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportData, setExportData] = useState<ExportPackage | null>(null);
  const [minBH, setMinBH] = useState(40);

  const generateExport = async () => {
    setIsExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('forensic-linker', {
        body: { action: 'exportFederalPackage', minBradfordHill: minBH, limit: 200 }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const pkg = data?.data ?? data;
      setExportData(pkg);
      toast.success(`Export generated: ${pkg.metadata.total_events} verified events`);
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const downloadJSON = () => {
    if (!exportData) return;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FEDERAL_EVIDENCE_PACKAGE_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Evidence package downloaded');
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground font-mono">Min BH Score:</label>
          <select
            value={minBH}
            onChange={(e) => setMinBH(Number(e.target.value))}
            className="bg-card border border-border rounded px-2 py-1 text-xs font-mono text-foreground"
          >
            <option value={20}>20+ (All Evidence)</option>
            <option value={40}>40+ (Strong)</option>
            <option value={60}>60+ (Prosecutorial)</option>
            <option value={80}>80+ (Irrefutable)</option>
          </select>
        </div>
        <Button
          onClick={generateExport}
          disabled={isExporting}
          className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400"
        >
          <Shield className="w-4 h-4 mr-2" />
          {isExporting ? 'Generating...' : 'Generate Federal Package'}
        </Button>
        {exportData && (
          <Button onClick={downloadJSON} variant="outline" className="border-green-500/50 text-green-400">
            <Download className="w-4 h-4 mr-2" />
            Download JSON
          </Button>
        )}
        {onClose && (
          <Button onClick={onClose} variant="ghost" size="sm" className="ml-auto">Close</Button>
        )}
      </div>

      {/* Export Preview */}
      {exportData && (
        <div className="space-y-4">
          {/* Metadata Header */}
          <div className="p-4 rounded-lg bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-5 h-5 text-red-400" />
              <span className="font-mono text-sm font-bold text-foreground">
                {exportData.metadata.package_type}
              </span>
              <Badge className={exportData.metadata.merkle_chain_integrity === 'VERIFIED'
                ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}>
                {exportData.metadata.merkle_chain_integrity === 'VERIFIED' ? (
                  <><CheckCircle2 className="w-3 h-3 mr-1" /> CHAIN VERIFIED</>
                ) : (
                  <><AlertTriangle className="w-3 h-3 mr-1" /> {exportData.metadata.merkle_chain_integrity}</>
                )}
              </Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
              <div><span className="text-muted-foreground">Events:</span> <span className="text-foreground">{exportData.metadata.total_events}</span></div>
              <div><span className="text-muted-foreground">Chain Links:</span> <span className="text-foreground">{exportData.metadata.total_chain_links}</span></div>
              <div><span className="text-muted-foreground">Entities:</span> <span className="text-foreground">{exportData.metadata.total_entities}</span></div>
              <div><span className="text-muted-foreground">Merkle Seq:</span> <span className="text-foreground">#{exportData.metadata.merkle_latest_sequence}</span></div>
            </div>
          </div>

          {/* Legal Statutes */}
          <div className="p-3 rounded-lg bg-card/50 border border-border/50">
            <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <FileText className="w-3 h-3" /> Applicable Federal Statutes
            </h4>
            <div className="flex flex-wrap gap-1">
              {exportData.legal_framework.statutes.map((s) => (
                <Badge key={s} variant="outline" className="text-xs font-mono">{s}</Badge>
              ))}
            </div>
          </div>

          {/* Events Preview */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">
              Top Verified Events ({exportData.forensic_events.length})
            </h4>
            <ScrollArea className="h-[250px]">
              <div className="space-y-2">
                {exportData.forensic_events.slice(0, 20).map((evt) => (
                  <div key={evt.forensic_event_id} className="p-2 rounded bg-card/30 border border-border/30 text-xs font-mono">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{evt.event_type}</Badge>
                        <span className="text-muted-foreground">{evt.primary_entity_id}</span>
                        {evt.is_physical_verified && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                      </div>
                      <Badge className="bg-red-500/20 text-red-400 text-[10px]">
                        BH: {evt.bradford_hill_score?.toFixed(0)}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 truncate">{evt.summary}</p>
                    <span className="text-muted-foreground/60">{evt.chain_links?.length || 0} chain links</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
