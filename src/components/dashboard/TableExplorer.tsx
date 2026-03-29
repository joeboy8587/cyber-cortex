import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Database, Search, ChevronRight, Loader2, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNeonDatabase, TableInfo } from "@/hooks/useNeonDatabase";

export function TableExplorer() {
  const { getTables, getTableData, isLoading } = useNeonDatabase();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<any[] | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    const fetchTables = async () => {
      try {
        const data = await getTables();
        setTables(data || []);
      } catch (err) {
        console.error("Failed to fetch tables:", err);
      }
    };
    fetchTables();
  }, [getTables]);

  const handleTableClick = async (tableName: string) => {
    if (selectedTable === tableName) {
      setSelectedTable(null);
      setTableData(null);
      return;
    }
    
    setSelectedTable(tableName);
    setLoadingData(true);
    
    try {
      const data = await getTableData(tableName, 10);
      setTableData(data || []);
    } catch (err) {
      console.error("Failed to fetch table data:", err);
      setTableData([]);
    } finally {
      setLoadingData(false);
    }
  };

  const filteredTables = tables.filter((t) =>
    t.tablename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalRecords = tables.reduce((sum, t) => sum + Number(t.row_count || 0), 0);

  return (
    <CyberPanel
      title="Database Explorer"
      icon={<Database className="w-4 h-4" />}
      headerActions={
        isLoading && (
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        )
      }
    >
      <div className="p-4">
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Search ${tables.length} tables...`}
            className="w-full bg-muted/50 border border-border rounded pl-10 pr-4 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>

        {/* Table List */}
        <div className="space-y-1 max-h-[300px] overflow-auto">
          {filteredTables.length === 0 && !isLoading ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              {searchTerm ? "No tables match your search" : "No tables found"}
            </div>
          ) : (
            filteredTables.map((table, idx) => (
              <div key={`${table.tablename}-${idx}`}>
                <button
                  onClick={() => handleTableClick(table.tablename)}
                  className={cn(
                    "w-full flex items-center justify-between p-2 rounded border transition-colors",
                    selectedTable === table.tablename
                      ? "bg-primary/10 border-primary/50"
                      : "bg-muted/30 border-border hover:border-primary/30"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      className={cn(
                        "w-4 h-4 text-primary transition-transform",
                        selectedTable === table.tablename && "rotate-90"
                      )}
                    />
                    <Table2 className="w-3 h-3 text-muted-foreground" />
                    <span className="font-mono text-xs text-foreground truncate max-w-[150px]">
                      {table.tablename}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-primary">
                    {Number(table.row_count).toLocaleString()}
                  </span>
                </button>

                {selectedTable === table.tablename && (
                  <div className="ml-6 mt-2 mb-2 p-2 rounded bg-muted/20 border border-border">
                    {loadingData ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        <span className="ml-2 text-xs text-muted-foreground">Loading data...</span>
                      </div>
                    ) : tableData && tableData.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border">
                              {Object.keys(tableData[0]).slice(0, 4).map((key) => (
                                <th key={key} className="text-left p-1 text-muted-foreground font-mono">
                                  {key}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tableData.slice(0, 5).map((row, i) => (
                              <tr key={i} className="border-b border-border/50">
                                {Object.values(row).slice(0, 4).map((val, j) => (
                                  <td key={j} className="p-1 font-mono truncate max-w-[100px]">
                                    {String(val ?? "null").slice(0, 30)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="text-center text-xs text-muted-foreground mt-2">
                          Showing 5 of {Number(table.row_count).toLocaleString()} rows
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground text-xs py-2">
                        No data available
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Total Tables</span>
            <span className="font-mono text-primary">{tables.length}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Total Records</span>
            <span className="font-mono text-primary">{totalRecords.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}
