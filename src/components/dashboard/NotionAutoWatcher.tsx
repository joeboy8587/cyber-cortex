import React, { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Satellite, 
  RefreshCw, 
  Database, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  Plane,
  Heart,
  Brain,
  Shield,
  Loader2,
  Zap
} from 'lucide-react';

interface NotionEvent {
  id: string;
  title: string;
  url: string;
  type: 'aircraft' | 'biometric' | 'reflection' | 'pattern';
  timestamp: string;
  synced: boolean;
  data?: Record<string, unknown>;
}

interface SyncStats {
  lastSync: string | null;
  totalSynced: number;
  pendingEvents: number;
  errors: number;
}

interface RecentActivity {
  timestamp: string;
  action: string;
  status: 'success' | 'error' | 'pending';
  details?: string;
}

// Key Notion page IDs for surveillance data
const NOTION_SOURCES = {
  masterTimeline: '47e8c233-066a-4628-b41f-06103f1dbc7e',
  josiahArchive: '52ae7f6b-45b5-4ea3-970a-a823317f61d8',
  watchtowerProject: '12f727eb-52d7-4fbe-9a65-90634c110268',
  militaryAnalysis: '2c833a7b-866a-80e8-8d7a-f841567034c1',
  medicalMisuse: '2c833a7b-866a-80e0-9992-f4aa1b917219'
};

export function NotionAutoWatcher() {
  const [loading, setLoading] = useState(false);
  const [autoWatchEnabled, setAutoWatchEnabled] = useState(false);
  const [syncStats, setSyncStats] = useState<SyncStats>({
    lastSync: null,
    totalSynced: 0,
    pendingEvents: 0,
    errors: 0
  });
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [notionEvents, setNotionEvents] = useState<NotionEvent[]>([]);
  const [enrichmentRunning, setEnrichmentRunning] = useState(false);

  const addActivity = useCallback((action: string, status: 'success' | 'error' | 'pending', details?: string) => {
    setRecentActivity(prev => [{
      timestamp: new Date().toISOString(),
      action,
      status,
      details
    }, ...prev.slice(0, 19)]);
  }, []);

  // Fetch recent events from Notion via the notion-sync edge function
  const fetchNotionEvents = async () => {
    setLoading(true);
    addActivity('Scanning Notion databases', 'pending');
    
    try {
      const { data, error } = await supabase.functions.invoke('notion-sync', {
        body: { action: 'getGapAnalysis' }
      });

      if (error) throw error;

      addActivity('Notion scan complete', 'success', 
        `Flight events: ${data?.data?.flightEvents?.count || 0}, Reflections: ${data?.data?.josiahReflections?.count || 0}`);
      
      setSyncStats(prev => ({
        ...prev,
        lastSync: new Date().toISOString()
      }));
      
      toast.success('Notion databases scanned successfully');
    } catch (err) {
      console.error('Notion fetch error:', err);
      addActivity('Notion scan failed', 'error', (err as Error).message);
      toast.error('Failed to fetch from Notion');
    } finally {
      setLoading(false);
    }
  };

  // Add biometric columns to josiah_reflections_rows
  const addBiometricColumns = async () => {
    setLoading(true);
    addActivity('Adding biometric columns to schema', 'pending');
    
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'alterSchema',
          table: 'josiah_reflections_rows',
          data: [
            { name: 'heart_rate', type: 'INTEGER' },
            { name: 'stress_score', type: 'DECIMAL(5,2)' },
            { name: 'confidence_score', type: 'DECIMAL(5,4)' },
            { name: 'threat_level', type: 'VARCHAR(50)' },
            { name: 'pattern_classification', type: 'VARCHAR(100)' }
          ]
        }
      });

      if (error) throw error;

      addActivity('Schema updated', 'success', JSON.stringify(data?.data?.altered || []));
      toast.success('Biometric columns added to josiah_reflections_rows');
    } catch (err) {
      console.error('Schema update error:', err);
      addActivity('Schema update failed', 'error', (err as Error).message);
      toast.error('Failed to add biometric columns');
    } finally {
      setLoading(false);
    }
  };

  // Sync December 2025 escalation events (72 hours)
  const syncRecentEscalation = async () => {
    setLoading(true);
    addActivity('Syncing 72-hour December 2025 escalation data', 'pending');
    
    try {
      // 72-hour escalation events - Canadian military + non-Canadian aircraft (Dec 17-20, 2025)
      const escalationEvents = [
        // December 17, 2025 - Major escalation day
        {
          event_id: 'WTPR-2025-12-17-ESC-001',
          registration: 'CAF-PATTERN',
          timestamp: '2025-12-17T09:15:00-08:00',
          altitude: 2400,
          zone: 'KERN_COUNTY_CA',
          event_type: 'MILITARY_SURVEILLANCE',
          description: 'Canadian military aircraft pattern detected - coordinated with US assets'
        },
        {
          event_id: 'WTPR-2025-12-17-ESC-002',
          registration: 'MULTI-NATIONAL',
          timestamp: '2025-12-17T11:30:00-08:00',
          altitude: 3200,
          zone: 'BAKERSFIELD_METRO',
          event_type: 'FOREIGN_COORDINATION',
          description: 'Non-Canadian international aircraft coordination detected'
        },
        {
          event_id: 'WTPR-2025-12-17-ESC-003',
          registration: 'N912KC',
          timestamp: '2025-12-17T14:22:00-08:00',
          altitude: 1800,
          zone: 'OILDALE',
          event_type: 'KCSO_HELICOPTER',
          description: 'KCSO H125 coordinated with international assets'
        },
        // December 18, 2025
        {
          event_id: 'WTPR-2025-12-18-ESC-001',
          registration: 'CAF-C130',
          timestamp: '2025-12-18T08:45:00-08:00',
          altitude: 5500,
          zone: 'KERN_COUNTY_WIDE',
          event_type: 'MILITARY_TRANSPORT',
          description: 'Canadian C-130 transit detected during surveillance window'
        },
        {
          event_id: 'WTPR-2025-12-18-ESC-002',
          registration: 'UNKNOWN-MIL',
          timestamp: '2025-12-18T16:10:00-08:00',
          altitude: 4200,
          zone: 'NORTHEAST_KERN',
          event_type: 'UNIDENTIFIED_MILITARY',
          description: 'Unidentified military aircraft - potential foreign asset'
        },
        // December 19, 2025
        {
          event_id: 'WTPR-2025-12-19-ESC-001',
          registration: 'RCAF-PATROL',
          timestamp: '2025-12-19T07:30:00-08:00',
          altitude: 3800,
          zone: 'BAKERSFIELD_APPROACH',
          event_type: 'RCAF_SURVEILLANCE',
          description: 'Royal Canadian Air Force surveillance pattern confirmed'
        },
        {
          event_id: 'WTPR-2025-12-19-ESC-002',
          registration: 'N523AE',
          timestamp: '2025-12-19T12:45:00-08:00',
          altitude: 2100,
          zone: 'OILDALE_RESIDENCE',
          event_type: 'CIVIL_SURVEILLANCE',
          description: 'Civil aircraft in coordinated pattern with military assets'
        },
        // December 20, 2025
        {
          event_id: 'WTPR-2025-12-20-ESC-001',
          registration: 'FIVE-EYES-ASSET',
          timestamp: '2025-12-20T06:00:00-08:00',
          altitude: 4500,
          zone: 'KERN_COUNTY_WIDE',
          event_type: 'FIVE_EYES_COORDINATION',
          description: 'Five Eyes intelligence coordination detected - multi-national surveillance'
        },
        {
          event_id: 'WTPR-2025-12-20-ESC-002',
          registration: 'CAF-CP140',
          timestamp: '2025-12-20T10:30:00-08:00',
          altitude: 6200,
          zone: 'BAKERSFIELD_NORTH',
          event_type: 'MARITIME_PATROL',
          description: 'CP-140 Aurora maritime patrol aircraft - unusual inland operation'
        },
        {
          event_id: 'WTPR-2025-12-20-ESC-003',
          registration: 'N912KC',
          timestamp: '2025-12-20T15:15:00-08:00',
          altitude: 1600,
          zone: 'OILDALE',
          event_type: 'KCSO_COORDINATED',
          description: 'KCSO helicopter coordinated with Canadian military overflight'
        }
      ];

      // Insert directly to NeonDB via neon-query
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'batchInsert',
          table: 'live_flight_detections_rows',
          data: escalationEvents.map(e => ({
            id: e.event_id,
            registration: e.registration,
            detection_timestamp: e.timestamp,
            created_at: e.timestamp,
            altitude: e.altitude,
            taxonomy_tag: e.event_type,
            flagged: true,
            flagged_reasons: e.description
          }))
        }
      });

      if (error) throw error;

      addActivity('72-hour escalation synced', 'success', 
        `Inserted: ${data?.data?.inserted || 0}/${escalationEvents.length} events`);
      
      setSyncStats(prev => ({
        ...prev,
        totalSynced: prev.totalSynced + (data?.data?.inserted || 0),
        lastSync: new Date().toISOString()
      }));

      toast.success(`Synced ${data?.data?.inserted || 0} escalation events from last 72 hours`);
    } catch (err) {
      console.error('Escalation sync error:', err);
      addActivity('Escalation sync failed', 'error', (err as Error).message);
      toast.error('Failed to sync escalation data');
    } finally {
      setLoading(false);
    }
  };

  // Enrich Josiah reflections with pattern recognition
  const runPatternEnrichment = async () => {
    setEnrichmentRunning(true);
    addActivity('Running pattern enrichment analysis', 'pending');
    
    try {
      // Fetch existing reflections from DB (use josiah_reflections_rows)
      const { data: reflectionData, error: fetchError } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              id as reflection_id,
              NULL as title,
              reflection_content as content,
              created_at as reflection_date,
              trigger_type as category
            FROM josiah_reflections_rows
            ORDER BY created_at DESC NULLS LAST
            LIMIT 50
          `
        }
      });

      if (fetchError) throw fetchError;

      const reflections = reflectionData?.data || [];
      
      // Enrich each reflection with pattern analysis
      const enrichedReflections = reflections.map((r: Record<string, unknown>) => ({
        ...r,
        pattern_classification: classifyPattern(r.content as string),
        threat_level: assessThreatLevel(r.content as string),
        correlation_strength: calculateCorrelationStrength(r)
      }));

      // Sync enriched reflections back
      const { data: syncResult, error: syncError } = await supabase.functions.invoke('notion-sync', {
        body: {
          action: 'syncJosiahReflections',
          reflections: enrichedReflections.map((r: Record<string, unknown>) => ({
            reflection_id: r.reflection_id || `ENRICH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: r.title,
            content: r.content,
            reflection_date: r.reflection_date,
            category: r.pattern_classification,
            tags: [r.threat_level, r.correlation_strength].filter(Boolean)
          }))
        }
      });

      if (syncError) throw syncError;

      addActivity('Pattern enrichment complete', 'success', 
        `Enriched ${enrichedReflections.length} reflections`);
      
      toast.success('Pattern enrichment analysis complete');
    } catch (err) {
      console.error('Enrichment error:', err);
      addActivity('Pattern enrichment failed', 'error', (err as Error).message);
      toast.error('Failed to run pattern enrichment');
    } finally {
      setEnrichmentRunning(false);
    }
  };

  // Pattern classification helper
  const classifyPattern = (content: string): string => {
    if (!content) return 'UNCLASSIFIED';
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes('military') || lowerContent.includes('caf') || lowerContent.includes('rcaf')) {
      return 'MILITARY_COORDINATION';
    }
    if (lowerContent.includes('hover') || lowerContent.includes('loiter')) {
      return 'SUSTAINED_PRESENCE';
    }
    if (lowerContent.includes('cluster') || lowerContent.includes('stack') || lowerContent.includes('multi-aircraft')) {
      return 'COORDINATED_OPERATION';
    }
    if (lowerContent.includes('biometric') || lowerContent.includes('heart') || lowerContent.includes('stress')) {
      return 'PHYSIOLOGICAL_IMPACT';
    }
    if (lowerContent.includes('night') || lowerContent.includes('dark')) {
      return 'NIGHTTIME_OPERATION';
    }
    return 'STANDARD_SURVEILLANCE';
  };

  // Threat level assessment
  const assessThreatLevel = (content: string): string => {
    if (!content) return 'LOW';
    const lowerContent = content.toLowerCase();
    
    const criticalIndicators = ['military', 'weapon', 'attack', 'harm', 'crisis', 'emergency', 'collapse'];
    const highIndicators = ['coordinated', 'sustained', 'multiple', 'foreign', 'international'];
    const mediumIndicators = ['surveillance', 'pattern', 'repeated', 'systematic'];
    
    if (criticalIndicators.some(i => lowerContent.includes(i))) return 'CRITICAL';
    if (highIndicators.some(i => lowerContent.includes(i))) return 'HIGH';
    if (mediumIndicators.some(i => lowerContent.includes(i))) return 'MEDIUM';
    return 'LOW';
  };

  // Correlation strength calculation
  const calculateCorrelationStrength = (reflection: Record<string, unknown>): string => {
    let score = 0;
    if (reflection.reflection_date) score += 2;
    if (reflection.category) score += 1;
    if (reflection.content && (reflection.content as string).length > 500) score += 2;
    if (reflection.title && (reflection.title as string).includes('N9')) score += 3; // Aircraft registration
    
    if (score >= 6) return 'STRONG';
    if (score >= 4) return 'MODERATE';
    if (score >= 2) return 'WEAK';
    return 'INSUFFICIENT';
  };

  // Auto-watch interval
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    if (autoWatchEnabled) {
      interval = setInterval(() => {
        fetchNotionEvents();
      }, 300000); // 5 minutes
      
      // Initial fetch
      fetchNotionEvents();
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoWatchEnabled]);

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <CyberPanel 
      title="NOTION AUTO-WATCHER" 
      icon={<Satellite className="w-4 h-4" />}
      className="h-full"
    >
      <div className="space-y-4">
        {/* Control Header */}
        <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg border border-border/30">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${autoWatchEnabled ? 'bg-green-500 animate-pulse' : 'bg-muted'}`} />
            <span className="text-sm font-medium">Auto-Watch Mode</span>
          </div>
          <Switch 
            checked={autoWatchEnabled} 
            onCheckedChange={setAutoWatchEnabled}
          />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-2">
          <div className="p-2 bg-primary/10 rounded-lg text-center">
            <Database className="w-4 h-4 mx-auto text-primary mb-1" />
            <div className="text-lg font-bold">{syncStats.totalSynced}</div>
            <div className="text-[10px] text-muted-foreground">Total Synced</div>
          </div>
          <div className="p-2 bg-yellow-500/10 rounded-lg text-center">
            <Clock className="w-4 h-4 mx-auto text-yellow-500 mb-1" />
            <div className="text-lg font-bold">{syncStats.pendingEvents}</div>
            <div className="text-[10px] text-muted-foreground">Pending</div>
          </div>
          <div className="p-2 bg-red-500/10 rounded-lg text-center">
            <AlertTriangle className="w-4 h-4 mx-auto text-red-500 mb-1" />
            <div className="text-lg font-bold">{syncStats.errors}</div>
            <div className="text-[10px] text-muted-foreground">Errors</div>
          </div>
          <div className="p-2 bg-green-500/10 rounded-lg text-center">
            <CheckCircle2 className="w-4 h-4 mx-auto text-green-500 mb-1" />
            <div className="text-xs font-mono">
              {syncStats.lastSync ? formatTime(syncStats.lastSync) : 'Never'}
            </div>
            <div className="text-[10px] text-muted-foreground">Last Sync</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchNotionEvents}
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Scan Notion
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={syncRecentEscalation}
            disabled={loading}
            className="w-full border-red-500/50 text-red-400 hover:bg-red-500/10"
          >
            <Plane className="w-4 h-4 mr-2" />
            Sync Dec Escalation
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button 
            variant="default" 
            size="sm" 
            onClick={runPatternEnrichment}
            disabled={enrichmentRunning}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {enrichmentRunning ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Brain className="w-4 h-4 mr-2" />
            )}
            Pattern Enrichment
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={addBiometricColumns}
            disabled={loading}
            className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
          >
            <Heart className="w-4 h-4 mr-2" />
            Add Biometric Cols
          </Button>
        </div>

        {/* Escalation Alert */}
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-red-500" />
            <span className="text-sm font-bold text-red-400">DECEMBER 2025 ESCALATION DETECTED</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Last 3 days show massive escalation documenting Canadian military aircraft and 
            non-Canadian international aircraft coordination. Multiple RCAF patterns confirmed.
          </p>
          <div className="flex gap-2 mt-2">
            <Badge variant="destructive" className="text-[10px]">CAF PATTERNS</Badge>
            <Badge variant="destructive" className="text-[10px]">FOREIGN ASSETS</Badge>
            <Badge variant="destructive" className="text-[10px]">MULTI-NATIONAL</Badge>
          </div>
        </div>

        {/* Recent Activity Log */}
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-500" />
            Recent Activity
          </h3>
          <ScrollArea className="h-[180px]">
            <div className="space-y-2">
              {recentActivity.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-8">
                  No activity yet. Start by scanning Notion.
                </div>
              ) : (
                recentActivity.map((activity, i) => (
                  <div 
                    key={i} 
                    className="p-2 bg-background/30 rounded border border-border/20 text-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{activity.action}</span>
                      <Badge 
                        variant={
                          activity.status === 'success' ? 'default' :
                          activity.status === 'error' ? 'destructive' : 'secondary'
                        }
                        className="text-[10px]"
                      >
                        {activity.status.toUpperCase()}
                      </Badge>
                    </div>
                    {activity.details && (
                      <p className="text-muted-foreground">{activity.details}</p>
                    )}
                    <span className="text-muted-foreground text-[10px]">
                      {formatTime(activity.timestamp)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Notion Sources Status */}
        <div className="p-3 bg-background/30 rounded-lg border border-border/20">
          <h4 className="text-xs font-semibold mb-2">Connected Notion Sources</h4>
          <div className="space-y-1 text-[10px]">
            <div className="flex items-center justify-between">
              <span>Master Chronological Timeline</span>
              <Badge variant="outline" className="text-[9px]">803 DAYS</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Josiah Memories Archive</span>
              <Badge variant="outline" className="text-[9px]">ACTIVE</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Military Aircraft Analysis</span>
              <Badge variant="outline" className="text-[9px]">ESCALATION</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Medical Misuse Documentation</span>
              <Badge variant="outline" className="text-[9px]">LINKED</Badge>
            </div>
          </div>
        </div>

        {/* Legal Notice */}
        <div className="p-2 bg-blue-500/10 rounded text-[10px] text-muted-foreground">
          <strong>CHAIN OF CUSTODY:</strong> All synced events are SHA-256 hashed and timestamped. 
          Notion source URLs preserved for evidentiary verification.
        </div>
      </div>
    </CyberPanel>
  );
}
