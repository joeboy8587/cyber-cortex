
-- Pillar 1: Policy Violations
CREATE TABLE IF NOT EXISTS public.policy_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  icao text NOT NULL,
  callsign text,
  detected_at timestamptz NOT NULL,
  rule_code text NOT NULL,
  rule_title text NOT NULL,
  manual_section text,
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_table text,
  sha256 text,
  promoted_exhibit_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pv_icao_time ON public.policy_violations(icao, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_pv_rule ON public.policy_violations(rule_code);
CREATE INDEX IF NOT EXISTS idx_pv_severity ON public.policy_violations(severity);

GRANT SELECT ON public.policy_violations TO authenticated;
GRANT ALL ON public.policy_violations TO service_role;
ALTER TABLE public.policy_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "investigators_read_violations" ON public.policy_violations
  FOR SELECT TO authenticated
  USING (public.is_investigator_or_admin());

-- Pillar 3: Discovered Evidence Sources (Neon table registry)
CREATE TABLE IF NOT EXISTS public.discovered_evidence_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_name text NOT NULL,
  table_name text NOT NULL,
  row_estimate bigint NOT NULL DEFAULT 0,
  forensic_score int NOT NULL DEFAULT 0,
  join_keys text[] NOT NULL DEFAULT '{}'::text[],
  column_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  added_to_investigation boolean NOT NULL DEFAULT false,
  last_crawled timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(schema_name, table_name)
);
CREATE INDEX IF NOT EXISTS idx_des_score ON public.discovered_evidence_sources(forensic_score DESC);

GRANT SELECT, UPDATE ON public.discovered_evidence_sources TO authenticated;
GRANT ALL ON public.discovered_evidence_sources TO service_role;
ALTER TABLE public.discovered_evidence_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "investigators_read_sources" ON public.discovered_evidence_sources
  FOR SELECT TO authenticated
  USING (public.is_investigator_or_admin());

CREATE POLICY "investigators_toggle_sources" ON public.discovered_evidence_sources
  FOR UPDATE TO authenticated
  USING (public.is_investigator_or_admin())
  WITH CHECK (public.is_investigator_or_admin());
