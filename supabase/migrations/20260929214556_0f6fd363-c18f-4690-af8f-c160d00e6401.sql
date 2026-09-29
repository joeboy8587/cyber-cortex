CREATE TABLE IF NOT EXISTS public.settled_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  subject_type text NOT NULL DEFAULT 'aircraft',
  lifecycle_stage text NOT NULL DEFAULT 'SETTLED',
  fact_class text NOT NULL,
  headline text NOT NULL,
  proof_summary text NOT NULL,
  supporting_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  case_id uuid REFERENCES public.cases(case_id),
  exhibit_id uuid REFERENCES public.exhibits(exhibit_id),
  evidence_hash text NOT NULL,
  locked_by uuid,
  locked_at timestamptz NOT NULL DEFAULT now(),
  superseded boolean NOT NULL DEFAULT false,
  superseded_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS settled_facts_subject_class_uniq
  ON public.settled_facts (upper(subject), fact_class)
  WHERE superseded = false;
CREATE INDEX IF NOT EXISTS settled_facts_subject_idx ON public.settled_facts (upper(subject));

GRANT SELECT, INSERT, UPDATE ON public.settled_facts TO authenticated;
GRANT SELECT ON public.settled_facts TO anon;
GRANT ALL ON public.settled_facts TO service_role;

ALTER TABLE public.settled_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read settled facts"
  ON public.settled_facts FOR SELECT USING (true);
CREATE POLICY "Investigators can lock settled facts"
  ON public.settled_facts FOR INSERT TO authenticated
  WITH CHECK (public.is_investigator_or_admin());
CREATE POLICY "Investigators can supersede settled facts"
  ON public.settled_facts FOR UPDATE TO authenticated
  USING (public.is_investigator_or_admin());

CREATE TRIGGER trg_settled_facts_updated
  BEFORE UPDATE ON public.settled_facts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();