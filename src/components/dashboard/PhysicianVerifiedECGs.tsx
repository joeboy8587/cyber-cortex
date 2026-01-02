import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { supabase } from "@/integrations/supabase/client";
import { Heart, Activity, AlertTriangle, User, Stethoscope, FileText, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ECGRecord {
  id: number;
  ecg_id: string;
  date_of_ecg: string;
  physician_name: string;
  physician_npi: string;
  ecg_findings: string;
  physician_interpretation: string;
  average_heart_rate: number;
  reported_symptoms: string;
  priority_level: string;
  status_message: string;
  qtc_interval: string;
}

export function PhysicianVerifiedECGs() {
  const [ecgs, setEcgs] = useState<ECGRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    abnormal: 0,
    avgHeartRate: 0,
    physicians: 0
  });

  useEffect(() => {
    fetchECGData();
  }, []);

  const fetchECGData = async () => {
    const unwrapRows = (payload: unknown): any[] => {
      if (Array.isArray(payload)) return payload;
      if (payload && typeof payload === 'object' && Array.isArray((payload as any).data)) return (payload as any).data;
      return [];
    };

    try {
      const { data: ecgData, error: ecgError } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id, ecg_id, date_of_ecg, physician_name, physician_npi,
              ecg_findings, physician_interpretation, average_heart_rate,
              reported_symptoms, priority_level, status_message, qtc_interval
            FROM physician_verified_ecgs
            ORDER BY date_of_ecg DESC
          `
        }
      });
      if (ecgError) throw ecgError;

      const { data: statsData, error: statsError } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE ecg_findings != 'Normal Sinus Rhythm') as abnormal,
              AVG(average_heart_rate)::int as avg_hr,
              COUNT(DISTINCT physician_npi) as physicians
            FROM physician_verified_ecgs
          `
        }
      });
      if (statsError) throw statsError;

      const ecgRows = unwrapRows(ecgData) as ECGRecord[];
      const statsRows = unwrapRows(statsData);

      setEcgs(ecgRows);

      if (statsRows?.[0]) {
        setStats({
          total: Number(statsRows[0].total) || 0,
          abnormal: Number(statsRows[0].abnormal) || 0,
          avgHeartRate: Number(statsRows[0].avg_hr) || 0,
          physicians: Number(statsRows[0].physicians) || 0
        });
      }
    } catch (error) {
      console.error("Error fetching ECG data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, string> = {
      "PRIORITY": "bg-red-500/20 text-red-400 border-red-500/30",
      "IMPORTANT": "bg-orange-500/20 text-orange-400 border-orange-500/30",
      "FEEDBACK": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      "NORMAL": "bg-green-500/20 text-green-400 border-green-500/30"
    };
    return <Badge className={`${variants[priority] || variants["NORMAL"]} text-[10px] border`}>{priority}</Badge>;
  };

  return (
    <CyberPanel 
      title="Physician-Verified ECGs" 
      icon={<Heart className="w-5 h-5" />}
      variant="threat"
    >
      <div className="space-y-4">
        {/* Medical Evidence Header */}
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <p className="text-xs text-red-300">
            <strong>Expert Medical Evidence:</strong> These ECGs have been reviewed and interpreted 
            by licensed physicians with NPI credentials, establishing medically-verified documentation 
            of physiological harm for federal prosecution.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <Heart className="w-4 h-4 mx-auto mb-1 text-red-400" />
            <div className="text-lg font-mono font-bold text-red-400">{stats.total}</div>
            <div className="text-[10px] text-muted-foreground">Verified ECGs</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-orange-400" />
            <div className="text-lg font-mono font-bold text-orange-400">{stats.abnormal}</div>
            <div className="text-[10px] text-muted-foreground">Abnormal</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <Activity className="w-4 h-4 mx-auto mb-1 text-primary" />
            <div className="text-lg font-mono font-bold text-primary">{stats.avgHeartRate}</div>
            <div className="text-[10px] text-muted-foreground">Avg BPM</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <Stethoscope className="w-4 h-4 mx-auto mb-1 text-secondary" />
            <div className="text-lg font-mono font-bold text-secondary">{stats.physicians}</div>
            <div className="text-[10px] text-muted-foreground">Physicians</div>
          </div>
        </div>

        {/* ECG Records */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <Heart className="w-6 h-6 animate-pulse mx-auto mb-2" />
            Loading medical records...
          </div>
        ) : (
          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2">
            {ecgs.map((ecg) => (
              <div 
                key={ecg.id}
                className="p-3 rounded-lg bg-background/30 border border-border/50 hover:border-red-500/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3 h-3 text-muted-foreground" />
                    <span className="font-mono text-xs text-primary">{ecg.ecg_id}</span>
                  </div>
                  {getPriorityBadge(ecg.priority_level)}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <div>
                    <span className="text-muted-foreground">Date:</span>
                    <span className="ml-1 text-foreground">
                      {new Date(ecg.date_of_ecg).toLocaleDateString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">HR:</span>
                    <span className={`ml-1 font-mono font-bold ${ecg.average_heart_rate > 100 ? 'text-red-400' : 'text-green-400'}`}>
                      {ecg.average_heart_rate} BPM
                    </span>
                  </div>
                </div>

                <div className="text-xs mb-2">
                  <span className="text-muted-foreground">Finding:</span>
                  <span className="ml-1 text-orange-300">{ecg.ecg_findings}</span>
                </div>

                <div className="text-xs mb-2">
                  <span className="text-muted-foreground">Symptoms:</span>
                  <span className="ml-1 text-red-300">{ecg.reported_symptoms}</span>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-t border-border/50 pt-2 mt-2">
                  <User className="w-3 h-3" />
                  <span>{ecg.physician_name}</span>
                  <span className="text-primary">NPI: {ecg.physician_npi}</span>
                </div>

                <div className="text-[10px] text-muted-foreground mt-1 italic">
                  "{ecg.physician_interpretation}"
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t border-border pt-3">
          <strong>Evidentiary Value:</strong> Licensed physician interpretations with NPI credentials 
          constitute admissible expert medical testimony documenting physiological harm.
        </div>
      </div>
    </CyberPanel>
  );
}
