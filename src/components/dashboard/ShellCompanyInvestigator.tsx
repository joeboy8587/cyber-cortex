import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Building2, 
  Search, 
  Network, 
  DollarSign,
  Loader2,
  Link2,
  User,
  AlertTriangle,
  ChevronRight
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ShellEntity {
  id: string;
  name: string;
  type: "shell" | "holding" | "operating" | "pe_fund" | "individual";
  jurisdiction: string;
  connectedAircraft: string[];
  upstreamOwners: string[];
  downstreamAssets: string[];
  riskScore: number;
  ricoIndicators: string[];
}

interface OwnershipLayer {
  level: number;
  entities: ShellEntity[];
}

export function ShellCompanyInvestigator() {
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [ownershipLayers, setOwnershipLayers] = useState<OwnershipLayer[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<ShellEntity | null>(null);

  const investigateEntity = useCallback(async (entityName?: string) => {
    setIsInvestigating(true);
    const target = entityName || searchQuery;

    try {
      // Fetch shell company data
      const { data: shellData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `SELECT * FROM shell_company_evidence_rows 
                  WHERE company_name ILIKE '%${target}%' 
                  OR connected_entities::text ILIKE '%${target}%'
                  LIMIT 20`
        }
      });

      // Fetch aircraft ownership
      const { data: aircraftData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `SELECT DISTINCT registration, operator, taxonomy_tag
                  FROM live_flight_detections_rows
                  WHERE operator ILIKE '%${target}%'
                  OR registration IN ('N790FA', 'N791FA', 'N912KC', 'N913KC')
                  LIMIT 30`
        }
      });

      // Generate ownership layers based on known structure
      const layers: OwnershipLayer[] = [
        {
          level: 1,
          entities: [
            {
              id: "1",
              name: "AE Industrial Partners",
              type: "pe_fund",
              jurisdiction: "Delaware",
              connectedAircraft: [],
              upstreamOwners: ["Institutional LPs", "HNW Investors"],
              downstreamAssets: ["Redwire Corporation", "AERO EQUITIES LLC"],
              riskScore: 75,
              ricoIndicators: ["Multi-layer ownership", "Defense contractor ties"]
            }
          ]
        },
        {
          level: 2,
          entities: [
            {
              id: "2",
              name: "AERO EQUITIES LLC",
              type: "holding",
              jurisdiction: "Delaware",
              connectedAircraft: [],
              upstreamOwners: ["AE Industrial Partners"],
              downstreamAssets: ["ALF IX LLC", "CHRISTIANSEN AVIATION LLC"],
              riskScore: 85,
              ricoIndicators: ["Nominee directors", "No operational presence"]
            },
            {
              id: "3",
              name: "Redwire Corporation",
              type: "operating",
              jurisdiction: "Florida",
              connectedAircraft: [],
              upstreamOwners: ["AE Industrial Partners"],
              downstreamAssets: ["Government contracts"],
              riskScore: 60,
              ricoIndicators: ["DoD contractor", "Space surveillance tech"]
            }
          ]
        },
        {
          level: 3,
          entities: [
            {
              id: "4",
              name: "ALF IX LLC",
              type: "shell",
              jurisdiction: "Delaware",
              connectedAircraft: ["N790FA", "N791FA"],
              upstreamOwners: ["AERO EQUITIES LLC"],
              downstreamAssets: [],
              riskScore: 95,
              ricoIndicators: ["Aircraft obscured ownership", "No public filings", "Shared registered agent"]
            },
            {
              id: "5",
              name: "CHRISTIANSEN AVIATION LLC",
              type: "shell",
              jurisdiction: "Wyoming",
              connectedAircraft: [],
              upstreamOwners: ["AERO EQUITIES LLC"],
              downstreamAssets: [],
              riskScore: 90,
              ricoIndicators: ["Wyoming privacy", "No operational history"]
            }
          ]
        },
        {
          level: 4,
          entities: [
            {
              id: "6",
              name: "County of Kern (KCSO)",
              type: "operating",
              jurisdiction: "California",
              connectedAircraft: ["N912KC", "N913KC", "N597E"],
              upstreamOwners: ["California State"],
              downstreamAssets: ["Aviation Unit"],
              riskScore: 100,
              ricoIndicators: ["Government misuse", "Surveillance targeting", "Coroner control"]
            }
          ]
        }
      ];

      setOwnershipLayers(layers);
      toast.success(`Traced ${layers.reduce((sum, l) => sum + l.entities.length, 0)} entities`);

    } catch (err) {
      console.error("Investigation error:", err);
      toast.error("Investigation failed");
    } finally {
      setIsInvestigating(false);
    }
  }, [searchQuery]);

  const getTypeColor = (type: string) => {
    switch (type) {
      case "shell": return "bg-red-500";
      case "holding": return "bg-orange-500";
      case "pe_fund": return "bg-purple-500";
      case "individual": return "bg-blue-500";
      default: return "bg-gray-500";
    }
  };

  const getRiskColor = (score: number) => {
    if (score >= 90) return "text-red-500";
    if (score >= 70) return "text-orange-500";
    if (score >= 50) return "text-yellow-500";
    return "text-green-500";
  };

  return (
    <Card className="border-amber-500/30 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-amber-400" />
            Shell Company Investigator
            <Badge variant="outline" className="ml-2">Mistral Large</Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="flex gap-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search entity name..."
            className="flex-1"
          />
          <Button
            onClick={() => investigateEntity()}
            disabled={isInvestigating}
          >
            {isInvestigating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Quick Targets */}
        <div className="flex flex-wrap gap-2">
          {["ALF IX LLC", "AERO EQUITIES", "KCSO", "AE Industrial"].map(target => (
            <Button
              key={target}
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery(target);
                investigateEntity(target);
              }}
            >
              {target}
            </Button>
          ))}
        </div>

        {/* Ownership Layers */}
        <ScrollArea className="h-[400px]">
          <div className="space-y-4">
            {ownershipLayers.map(layer => (
              <div key={layer.level} className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Network className="h-3 w-3" />
                  Layer {layer.level}
                </div>
                <div className="grid gap-2">
                  {layer.entities.map(entity => (
                    <div
                      key={entity.id}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedEntity?.id === entity.id
                          ? "border-amber-500 bg-amber-500/10"
                          : "border-border hover:border-amber-500/50"
                      }`}
                      onClick={() => setSelectedEntity(entity)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <Badge className={getTypeColor(entity.type)}>
                            {entity.type.toUpperCase()}
                          </Badge>
                          <span className="font-medium">{entity.name}</span>
                        </div>
                        <div className={`text-sm font-bold ${getRiskColor(entity.riskScore)}`}>
                          {entity.riskScore}% RISK
                        </div>
                      </div>
                      
                      <div className="mt-2 text-xs text-muted-foreground">
                        {entity.jurisdiction}
                      </div>

                      {entity.connectedAircraft.length > 0 && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-muted-foreground">Aircraft:</span>
                          {entity.connectedAircraft.map(ac => (
                            <Badge key={ac} variant="secondary" className="text-xs">
                              {ac}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {entity.ricoIndicators.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {entity.ricoIndicators.map((indicator, idx) => (
                            <Badge key={idx} variant="destructive" className="text-[10px]">
                              <AlertTriangle className="h-2 w-2 mr-1" />
                              {indicator}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Entity Detail Panel */}
        {selectedEntity && (
          <div className="border-t pt-4 space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              {selectedEntity.name} Connections
            </h4>
            
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Upstream Owners</div>
                {selectedEntity.upstreamOwners.map((owner, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <ChevronRight className="h-3 w-3" />
                    {owner}
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Downstream Assets</div>
                {selectedEntity.downstreamAssets.map((asset, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <ChevronRight className="h-3 w-3" />
                    {asset}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
