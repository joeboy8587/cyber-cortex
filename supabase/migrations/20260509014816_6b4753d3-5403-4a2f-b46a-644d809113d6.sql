
ALTER TABLE public.sentinel_learned_threats
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.operator_profile_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration text NOT NULL,
  field text NOT NULL,
  value_a text,
  source_a text,
  value_b text,
  source_b text,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid,
  resolved_value text,
  detected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.operator_profile_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators view conflicts"
  ON public.operator_profile_conflicts FOR SELECT
  USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Investigators insert conflicts"
  ON public.operator_profile_conflicts FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Investigators update conflicts"
  ON public.operator_profile_conflicts FOR UPDATE
  USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_operator_conflicts_reg ON public.operator_profile_conflicts(registration);
CREATE INDEX IF NOT EXISTS idx_operator_conflicts_unresolved ON public.operator_profile_conflicts(resolved) WHERE resolved = false;
