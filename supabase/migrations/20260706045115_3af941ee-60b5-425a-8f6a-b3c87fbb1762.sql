-- FAR classifier support columns
ALTER TABLE public.policy_violations
  ADD COLUMN IF NOT EXISTS rule_source TEXT DEFAULT 'KCSO',
  ADD COLUMN IF NOT EXISTS citation TEXT,
  ADD COLUMN IF NOT EXISTS far_text TEXT,
  ADD COLUMN IF NOT EXISTS altitude_ft INTEGER,
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS icao TEXT;

CREATE INDEX IF NOT EXISTS idx_policy_violations_rule_source ON public.policy_violations(rule_source);
CREATE INDEX IF NOT EXISTS idx_policy_violations_icao ON public.policy_violations(icao);

-- Schema wiring audit report
CREATE TABLE IF NOT EXISTS public.schema_wiring_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL, -- 'edge_function' | 'ui_component'
  source_path TEXT NOT NULL,
  table_name TEXT NOT NULL,
  column_ref TEXT,
  status TEXT NOT NULL, -- 'ok' | 'missing_column' | 'dropped_table' | 'renamed'
  suggested_fix TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schema_wiring_report TO authenticated;
GRANT ALL ON public.schema_wiring_report TO service_role;

ALTER TABLE public.schema_wiring_report ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators view wiring report"
  ON public.schema_wiring_report FOR SELECT
  TO authenticated
  USING (public.is_investigator_or_admin());

CREATE POLICY "Admins manage wiring report"
  ON public.schema_wiring_report FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_wiring_status ON public.schema_wiring_report(status, severity);
CREATE INDEX IF NOT EXISTS idx_wiring_scanned ON public.schema_wiring_report(scanned_at DESC);