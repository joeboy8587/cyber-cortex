import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FlagRow {
  id: string;
  registration: string | null;
  description: string | null;
  confidence_score: number | null;
  created_at: string;
  last_seen: string | null;
}

const POLL_MS = 60_000;
const WINDOW_MIN = 15;

/**
 * Watches for freshly filed Military <-> Law Enforcement joint-operation flags
 * (last 15 minutes) and raises a toast with a deep link to the event panel.
 */
export function JointOpNotifier() {
  const navigate = useNavigate();
  const notified = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const openPanel = useCallback(() => {
    navigate("/kcso#joint-operations");
  }, [navigate]);

  const check = useCallback(async () => {
    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const { data, error } = await supabase
      .from("watchtower_autonomous_flags")
      .select("id, registration, description, confidence_score, created_at, last_seen")
      .eq("flag_type", "MILITARY_CIVIL_JOINT_OPERATION")
      .gte("last_seen", since)
      .order("last_seen", { ascending: false })
      .limit(10);

    if (error || !data) return;

    const rows = data as FlagRow[];

    // First pass only records baseline so we don't spam on page load.
    if (!primed.current) {
      rows.forEach((r) => notified.current.add(r.id));
      primed.current = true;
      return;
    }

    for (const r of rows) {
      if (notified.current.has(r.id)) continue;
      notified.current.add(r.id);
      toast.error(`Joint operation detected — ${r.registration ?? "LE asset"}`, {
        duration: 20_000,
        description:
          (r.description ?? "Military asset co-operating with civil law enforcement").slice(0, 180) +
          `\n18 U.S.C. § 1385 • confidence ${Math.round(Number(r.confidence_score ?? 0) * 100)}%`,
        action: { label: "View event", onClick: openPanel },
      });
    }
  }, [openPanel]);

  useEffect(() => {
    check();
    const t = setInterval(check, POLL_MS);

    const channel = supabase
      .channel("joint-op-flags")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "watchtower_autonomous_flags",
          filter: "flag_type=eq.MILITARY_CIVIL_JOINT_OPERATION",
        },
        () => check(),
      )
      .subscribe();

    return () => {
      clearInterval(t);
      supabase.removeChannel(channel);
    };
  }, [check]);

  return null;
}
