
CREATE TABLE public.reasoning_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_ref text NOT NULL,
  module text NOT NULL,
  payload jsonb NOT NULL,
  bayes_factor numeric,
  bradford_score numeric,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reasoning_outputs_ref ON public.reasoning_outputs(detection_ref);
CREATE INDEX idx_reasoning_outputs_module ON public.reasoning_outputs(module);
CREATE INDEX idx_reasoning_outputs_created ON public.reasoning_outputs(created_at DESC);
GRANT SELECT, INSERT ON public.reasoning_outputs TO authenticated;
GRANT ALL ON public.reasoning_outputs TO service_role;
ALTER TABLE public.reasoning_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read reasoning" ON public.reasoning_outputs FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert reasoning" ON public.reasoning_outputs FOR INSERT TO authenticated WITH CHECK (true);
