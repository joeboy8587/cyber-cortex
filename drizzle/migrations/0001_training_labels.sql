CREATE TABLE public.training_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_db text NOT NULL DEFAULT 'neon',
  source_table text NOT NULL,
  source_id text NOT NULL,
  subject text,
  label text NOT NULL CHECK (label IN ('proven','normal','exclude','unsorted')),
  reason_code text NOT NULL,
  reason_text text NOT NULL,
  rule_version text NOT NULL,
  decided_by uuid,
  superseded boolean NOT NULL DEFAULT false,
  superseded_reason text,
  observed_at timestamptz,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id, rule_version)
);
CREATE INDEX training_labels_label_idx ON public.training_labels (label) WHERE NOT superseded;
CREATE TABLE public.training_label_sweeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  window_days integer,
  rule_version text NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  scanned integer NOT NULL DEFAULT 0,
  result_sha256 text NOT NULL,
  run_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.training_labels TO authenticated;
GRANT ALL ON public.training_labels TO service_role;
GRANT SELECT ON public.training_label_sweeps TO authenticated;
GRANT ALL ON public.training_label_sweeps TO service_role;
ALTER TABLE public.training_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_label_sweeps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Investigators read labels" ON public.training_labels FOR SELECT TO authenticated USING (public.is_investigator_or_admin());
CREATE POLICY "Investigators add own labels" ON public.training_labels FOR INSERT TO authenticated WITH CHECK (public.is_investigator_or_admin() AND decided_by = auth.uid());
CREATE POLICY "Investigators supersede labels" ON public.training_labels FOR UPDATE TO authenticated USING (public.is_investigator_or_admin()) WITH CHECK (public.is_investigator_or_admin());
CREATE POLICY "Investigators read sweeps" ON public.training_label_sweeps FOR SELECT TO authenticated USING (public.is_investigator_or_admin());
CREATE TRIGGER training_labels_updated BEFORE UPDATE ON public.training_labels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();