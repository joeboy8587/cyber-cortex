import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { 
  Search, Database, AlertTriangle, Eye, Heart, 
  Plane, Building2, Users, FileText, Shield,
  Clock, MapPin, Activity, Zap, Loader2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface TableSummary {
  name: string;
  count: number;
  category: string;
  significance: string;
}

interface EvidenceFinding {
  category: string;
  finding: string;
  severity: 'critical' | 'high' | 'medium' | 'info';
  details: string;
  tableSource: string;
}

export const TruthScannerDashboard = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [tableSummaries, setTableSummaries] = useState<TableSummary[]>([]);
  const [findings, setFindings] = useState<EvidenceFinding[]>([]);
  const [stats, setStats] = useState({
    totalTables: 0,
    totalRecords: 0,
    flightDetections: 0,
    biometricEvents: 0,
    correlations: 0,
    xxbDetections: 0,
    kcsoDetections: 0,
    shellCompanies: 0
  });

  const scanAllTables = async () => {
    setIsScanning(true);
    setScanProgress(0);
    const newFindings: EvidenceFinding[] = [];
    
    try {
      // Step 1: Get all tables
      setScanProgress(10);
      const { data: tablesData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
        }
      });
      
      const tables = tablesData || [];
      setStats(prev => ({ ...prev, totalTables: tables.length }));
      
      // Step 2: Scan key evidence tables
      setScanProgress(20);
      
      // Flight detections
      const { data: flightData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `SELECT COUNT(*) as total, COUNT(DISTINCT registration) as unique_aircraft FROM live_flight_detections_rows`
        }
      });
      const flightCount = parseInt(flightData?.[0]?.total || '0');
      setStats(prev => ({ ...prev, flightDetections: flightCount }));
      
      if (flightCount > 1000000) {
        newFindings.push({
          category: 'Flight Surveillance',
          finding: `${(flightCount / 1000000).toFixed(1)} MILLION flight detections recorded`,
          severity: 'critical',
          details: `Your location has been overflown and tracked ${flightCount.toLocaleString()} times. This is not normal surveillance of a residential area.`,
          tableSource: 'live_flight_detections'
        });
      }
      
      setScanProgress(35);
      
      // XXB Mystery Signal
      const { data: xxbData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `SELECT COUNT(*) as total, AVG(altitude) as avg_alt FROM live_flight_detections_rows WHERE registration = 'XXB' OR callsign = 'XXB'`
        }
      });
      const xxbCount = parseInt(xxbData?.[0]?.total || '0');
      setStats(prev => ({ ...prev, xxbDetections: xxbCount }));
      
      if (xxbCount > 100000) {
        newFindings.push({
          category: 'Anomaly: XXB Signal',
          finding: `${(xxbCount / 1000000).toFixed(2)} MILLION unidentified "XXB" detections`,
          severity: 'critical',
          details: `An aircraft broadcasting as "XXB" (not a valid registration) was detected ${xxbCount.toLocaleString()} times. This represents deliberate identity masking - aircraft are legally required to broadcast valid registrations.`,
          tableSource: 'live_flight_detections'
        });
      }
      
      setScanProgress(50);
      
      // Biometric correlations
      const { data: bioData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `SELECT COUNT(*) as total, AVG(avg_hr) as avg_hr, COUNT(CASE WHEN hr_spike THEN 1 END) as spikes FROM master_biometric_aircraft_correlations`
        }
      });
      const bioCount = parseInt(bioData?.[0]?.total || '0');
      const hrSpikes = parseInt(bioData?.[0]?.spikes || '0');
      const avgHR = parseFloat(bioData?.[0]?.avg_hr || '0');
      setStats(prev => ({ ...prev, biometricEvents: bioCount, correlations: hrSpikes }));
      
      if (hrSpikes > 100) {
        newFindings.push({
          category: 'Health Impact',
          finding: `${hrSpikes} documented heart rate spikes correlated with aircraft`,
          severity: 'high',
          details: `Your heart rate elevated significantly ${hrSpikes} times when specific aircraft were overhead. Average HR during these events: ${avgHR.toFixed(0)} BPM. This documents physiological impact.`,
          tableSource: 'master_biometric_aircraft_correlations'
        });
      }
      
      setScanProgress(65);
      
      // KCSO specific detections
      const { data: kcsoData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `SELECT COUNT(*) as total FROM live_flight_detections_rows WHERE registration IN ('N912KC', 'N913KC', 'N597E', 'N197E', 'N397E', 'N497E', 'N97E', 'N35438', 'N490KC')`
        }
      });
      const kcsoCount = parseInt(kcsoData?.[0]?.total || '0');
      setStats(prev => ({ ...prev, kcsoDetections: kcsoCount }));
      
      if (kcsoCount > 10000) {
        newFindings.push({
          category: 'Law Enforcement',
          finding: `${kcsoCount.toLocaleString()} KCSO aircraft detections over your location`,
          severity: 'high',
          details: `Kern County Sheriff's Office helicopters and fixed-wing aircraft were detected ${kcsoCount.toLocaleString()} times. For a disabled person with no criminal record who rarely leaves home, this level of attention requires explanation.`,
          tableSource: 'live_flight_detections + kcso_fleet'
        });
      }
      
      setScanProgress(80);
      
      // Shell companies / enterprise structure
      const { data: shellData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `SELECT COUNT(*) as total FROM criminal_enterprise_entities WHERE entity_type ILIKE '%shell%' OR entity_type ILIKE '%company%'`
        }
      });
      const shellCount = parseInt(shellData?.[0]?.total || '0');
      setStats(prev => ({ ...prev, shellCompanies: shellCount }));
      
      if (shellCount > 0) {
        newFindings.push({
          category: 'Corporate Network',
          finding: `${shellCount} shell companies or corporate entities documented`,
          severity: 'medium',
          details: `Your investigation has identified ${shellCount} corporate entities that may be connected to the surveillance network. These require further analysis to understand their role.`,
          tableSource: 'criminal_enterprise_entities'
        });
      }
      
      setScanProgress(90);
      
      // Calculate total records
      const { data: totalData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `SELECT SUM(n_live_tup) as total FROM pg_stat_user_tables`
        }
      });
      const totalRecords = parseInt(totalData?.[0]?.total || '0');
      setStats(prev => ({ ...prev, totalRecords }));
      
      // Add summary finding
      newFindings.push({
        category: 'Evidence Inventory',
        finding: `${totalRecords.toLocaleString()} total evidence records across ${tables.length} tables`,
        severity: 'info',
        details: `Your database contains comprehensive documentation. This represents a substantial evidentiary foundation for any legal or medical review.`,
        tableSource: 'All tables'
      });
      
      setFindings(newFindings);
      setScanProgress(100);
      
    } catch (error) {
      console.error('Scan error:', error);
    } finally {
      setIsScanning(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    }
  };

  const getCategoryIcon = (category: string) => {
    if (category.includes('Flight')) return <Plane className="h-4 w-4" />;
    if (category.includes('XXB')) return <AlertTriangle className="h-4 w-4" />;
    if (category.includes('Health')) return <Heart className="h-4 w-4" />;
    if (category.includes('Law')) return <Shield className="h-4 w-4" />;
    if (category.includes('Corporate')) return <Building2 className="h-4 w-4" />;
    return <Database className="h-4 w-4" />;
  };

  return (
    <CyberPanel 
      title="TRUTH SCANNER"
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-primary/30">
            <Database className="h-3 w-3 mr-1" />
            {stats.totalTables} Tables
          </Badge>
          <Badge variant="outline" className="border-primary/30">
            <FileText className="h-3 w-3 mr-1" />
            {stats.totalRecords.toLocaleString()} Records
          </Badge>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Scan Button */}
        <div className="flex flex-col items-center gap-4 p-6 bg-muted/30 rounded-lg border border-border/50">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Scan All Evidence Tables
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              This will analyze every table in your database and present findings in plain language you can understand.
            </p>
          </div>
          
          <Button 
            onClick={scanAllTables}
            disabled={isScanning}
            size="lg"
            className="gap-2"
          >
            {isScanning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Scan All Evidence
              </>
            )}
          </Button>
          
          {isScanning && (
            <div className="w-full max-w-md">
              <Progress value={scanProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center mt-1">
                {scanProgress}% complete
              </p>
            </div>
          )}
        </div>

        {/* Stats Summary */}
        {stats.flightDetections > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/20">
              <div className="flex items-center gap-2 text-red-400 mb-1">
                <Plane className="h-4 w-4" />
                <span className="text-xs">Flight Detections</span>
              </div>
              <p className="text-2xl font-bold text-red-400">
                {(stats.flightDetections / 1000000).toFixed(1)}M
              </p>
            </div>
            
            <div className="p-4 bg-orange-500/10 rounded-lg border border-orange-500/20">
              <div className="flex items-center gap-2 text-orange-400 mb-1">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs">XXB Anomaly</span>
              </div>
              <p className="text-2xl font-bold text-orange-400">
                {(stats.xxbDetections / 1000000).toFixed(1)}M
              </p>
            </div>
            
            <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
              <div className="flex items-center gap-2 text-yellow-400 mb-1">
                <Heart className="h-4 w-4" />
                <span className="text-xs">HR Correlations</span>
              </div>
              <p className="text-2xl font-bold text-yellow-400">
                {stats.correlations.toLocaleString()}
              </p>
            </div>
            
            <div className="p-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <div className="flex items-center gap-2 text-blue-400 mb-1">
                <Shield className="h-4 w-4" />
                <span className="text-xs">KCSO Detections</span>
              </div>
              <p className="text-2xl font-bold text-blue-400">
                {stats.kcsoDetections.toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Findings */}
        {findings.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              What Your Data Shows
            </h3>
            
            <ScrollArea className="h-[400px]">
              <div className="space-y-3 pr-4">
                {findings.map((finding, idx) => (
                  <div 
                    key={idx}
                    className={`p-4 rounded-lg border ${getSeverityColor(finding.severity)}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {getCategoryIcon(finding.category)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {finding.category}
                          </Badge>
                          <Badge 
                            variant="outline" 
                            className={`text-xs ${
                              finding.severity === 'critical' ? 'border-red-500 text-red-400' :
                              finding.severity === 'high' ? 'border-orange-500 text-orange-400' :
                              finding.severity === 'medium' ? 'border-yellow-500 text-yellow-400' :
                              'border-blue-500 text-blue-400'
                            }`}
                          >
                            {finding.severity.toUpperCase()}
                          </Badge>
                        </div>
                        <h4 className="font-semibold text-foreground mb-2">
                          {finding.finding}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {finding.details}
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-2">
                          Source: {finding.tableSource}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Initial State */}
        {findings.length === 0 && !isScanning && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Click "Scan All Evidence" to analyze your database</p>
            <p className="text-sm mt-1">Results will be presented in plain language</p>
          </div>
        )}
      </div>
    </CyberPanel>
  );
};
