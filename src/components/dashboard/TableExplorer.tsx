import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Database, Search, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const tableCategories = [
  {
    name: "Flight Data",
    tables: [
      "flight_events",
      "aircraft_detections",
      "live_flight_detections_rows",
      "flight_surveillance_analysis",
      "unified_aircraft",
    ],
    count: 45,
  },
  {
    name: "Biometric Data",
    tables: [
      "biometric_data",
      "biometric_correlations_rows",
      "biometric_evidence",
      "biometric_flight_correlations",
      "integrated_biometric_data",
    ],
    count: 32,
  },
  {
    name: "Legal Evidence",
    tables: [
      "legal_ada_violations_proper",
      "legal_rico_patterns_rows",
      "nuremberg_violations_evidence",
      "evidence_items",
      "evidence_audit_trail",
    ],
    count: 28,
  },
  {
    name: "Surveillance Analysis",
    tables: [
      "surveillance_logs",
      "surveillance_incidents",
      "comprehensive_surveillance_analysis",
      "surveillance_pattern_detection",
      "surveillance_impact_analysis",
    ],
    count: 24,
  },
  {
    name: "Aircraft Registry",
    tables: [
      "aircraft_registry",
      "aircraft_registry_enriched",
      "threat_aircraft_registry",
      "shell_company_aircraft",
      "operator_profiles",
    ],
    count: 38,
  },
  {
    name: "Timeline & Events",
    tables: [
      "unified_timeline_enhanced",
      "timeline_events",
      "convergence_events",
      "correlation_events",
      "josiah_timeline_events",
    ],
    count: 42,
  },
];

export function TableExplorer() {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const filteredCategories = tableCategories.map((cat) => ({
    ...cat,
    tables: cat.tables.filter((t) =>
      t.toLowerCase().includes(searchTerm.toLowerCase())
    ),
  })).filter((cat) => cat.tables.length > 0 || !searchTerm);

  return (
    <CyberPanel
      title="Database Explorer"
      icon={<Database className="w-4 h-4" />}
    >
      <div className="p-4">
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search 261 tables..."
            className="w-full bg-muted/50 border border-border rounded pl-10 pr-4 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>

        {/* Categories */}
        <div className="space-y-2 max-h-[300px] overflow-auto">
          {filteredCategories.map((category) => (
            <div key={category.name}>
              <button
                onClick={() =>
                  setExpandedCategory(
                    expandedCategory === category.name ? null : category.name
                  )
                }
                className="w-full flex items-center justify-between p-2 rounded bg-muted/30 border border-border hover:border-primary/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ChevronRight
                    className={cn(
                      "w-4 h-4 text-primary transition-transform",
                      expandedCategory === category.name && "rotate-90"
                    )}
                  />
                  <span className="font-ui text-sm">{category.name}</span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {category.count} tables
                </span>
              </button>

              {expandedCategory === category.name && (
                <div className="ml-6 mt-1 space-y-1">
                  {category.tables.map((table) => (
                    <div
                      key={table}
                      className="flex items-center gap-2 p-2 rounded bg-muted/10 border border-transparent hover:border-primary/30 cursor-pointer transition-colors"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      <span className="font-mono text-xs text-foreground">
                        {table}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Total Tables</span>
            <span className="font-mono text-primary">261</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Total Records</span>
            <span className="font-mono text-primary">912,969+</span>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}
