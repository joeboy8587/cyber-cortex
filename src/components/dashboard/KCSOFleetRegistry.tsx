import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Plane, 
  RefreshCw, 
  ExternalLink, 
  Eye, 
  MapPin,
  Shield,
  AlertTriangle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface FleetAircraft {
  id: string;
  tail_number: string;
  model: string;
  model_citation: string | null;
  tail_number_citation: string | null;
  frequent_oildale_operation: boolean | null;
  oildale_citation: string | null;
  surveillance_capabilities: string | null;
  surveillance_citation: string | null;
}

export const KCSOFleetRegistry: React.FC = () => {
  const [fleet, setFleet] = useState<FleetAircraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchFleet = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `SELECT * FROM kcso_fleet ORDER BY tail_number`
        }
      });

      if (error) throw error;
      setFleet(data?.data || []);
    } catch (err) {
      console.error('Failed to fetch KCSO fleet:', err);
      toast.error('Failed to load fleet data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFleet();
  }, []);

  const getAircraftType = (model: string): 'helicopter' | 'fixed-wing' => {
    const helicopterKeywords = ['H125', 'AS350', 'UH-1', 'Huey', 'MD 500', 'OH-58', 'Bell'];
    return helicopterKeywords.some(k => model.includes(k)) ? 'helicopter' : 'fixed-wing';
  };

  const oildaleAircraft = fleet.filter(a => a.frequent_oildale_operation === true);
  const helicopters = fleet.filter(a => getAircraftType(a.model) === 'helicopter');
  const fixedWing = fleet.filter(a => getAircraftType(a.model) === 'fixed-wing');

  return (
    <CyberPanel title="KCSO Fleet Registry" icon={<Shield className="h-5 w-5" />}>
      <div className="space-y-4">
        {/* Stats Bar */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-muted/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-primary">{fleet.length}</div>
            <div className="text-xs text-muted-foreground">Total Aircraft</div>
          </div>
          <div className="bg-muted/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-cyan-400">{helicopters.length}</div>
            <div className="text-xs text-muted-foreground">Helicopters</div>
          </div>
          <div className="bg-muted/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-blue-400">{fixedWing.length}</div>
            <div className="text-xs text-muted-foreground">Fixed-Wing</div>
          </div>
          <div className="bg-muted/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-destructive">{oildaleAircraft.length}</div>
            <div className="text-xs text-muted-foreground">Oildale Active</div>
          </div>
        </div>

        {/* Oildale Alert */}
        {oildaleAircraft.length > 0 && (
          <div className="bg-destructive/10 border border-destructive/30 rounded p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm font-semibold text-destructive">Confirmed Oildale Operations</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {oildaleAircraft.map(a => (
                <Badge key={a.id} variant="destructive" className="font-mono">
                  {a.tail_number}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Refresh */}
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={fetchFleet} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Fleet List */}
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {fleet.map((aircraft) => {
              const isExpanded = expandedId === aircraft.id;
              const isOildale = aircraft.frequent_oildale_operation === true;
              const type = getAircraftType(aircraft.model);

              return (
                <div 
                  key={aircraft.id}
                  className={`border rounded-lg p-3 transition-all ${
                    isOildale 
                      ? 'border-destructive/50 bg-destructive/5' 
                      : 'border-border/50 bg-muted/20'
                  }`}
                >
                  <div 
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : aircraft.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Plane className={`h-5 w-5 ${
                        type === 'helicopter' ? 'text-cyan-400' : 'text-blue-400'
                      }`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">{aircraft.tail_number}</span>
                          {isOildale && (
                            <Badge variant="destructive" className="text-xs">
                              <MapPin className="h-3 w-3 mr-1" />
                              OILDALE
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{aircraft.model}</div>
                      </div>
                    </div>
                    <Eye className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-border/30 space-y-3">
                      {/* Surveillance Capabilities */}
                      {aircraft.surveillance_capabilities && (
                        <div>
                          <div className="text-xs font-semibold text-primary mb-1">
                            Surveillance Capabilities
                          </div>
                          <div className="text-xs text-muted-foreground leading-relaxed">
                            {aircraft.surveillance_capabilities}
                          </div>
                          {aircraft.surveillance_citation && (
                            <a 
                              href={aircraft.surveillance_citation}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Source
                            </a>
                          )}
                        </div>
                      )}

                      {/* Citations */}
                      <div className="flex flex-wrap gap-2">
                        {aircraft.model_citation && (
                          <a 
                            href={aircraft.model_citation}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs bg-muted/50 px-2 py-1 rounded hover:bg-muted"
                          >
                            <ExternalLink className="h-3 w-3" />
                            FAA Registry
                          </a>
                        )}
                        {aircraft.oildale_citation && (
                          <a 
                            href={aircraft.oildale_citation}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs bg-destructive/20 px-2 py-1 rounded hover:bg-destructive/30 text-destructive"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Oildale Evidence
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="text-xs text-muted-foreground text-center pt-2 border-t border-border/30">
          All data sourced from FAA Registry, KCSO official publications, and verified news reports
        </div>
      </div>
    </CyberPanel>
  );
};
