CREATE TABLE public.vlm_scene_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filename text NOT NULL,
  file_size bigint,
  file_fingerprint text NOT NULL,
  shot_type text,
  captured_at_utc timestamptz,
  timestamp_source text,
  timestamp_confidence text,
  agreement_count integer NOT NULL DEFAULT 0,
  needs_review boolean NOT NULL DEFAULT false,
  disagreements jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_reg text,
  selected_callsign text,
  selected_hex text,
  masked_contact boolean NOT NULL DEFAULT false,
  contact_count integer,
  track_geometry text,
  area_hint text,
  map_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  biometrics jsonb,
  scene jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  model text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vlm_scene_extractions_fingerprint_key ON public.vlm_scene_extractions (file_fingerprint);
CREATE INDEX vlm_scene_extractions_captured_idx ON public.vlm_scene_extractions (captured_at_utc DESC);
CREATE INDEX vlm_scene_extractions_reg_idx ON public.vlm_scene_extractions (upper(selected_reg));

GRANT SELECT, INSERT, UPDATE ON public.vlm_scene_extractions TO authenticated;
GRANT ALL ON public.vlm_scene_extractions TO service_role;

ALTER TABLE public.vlm_scene_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read scene extractions"
  ON public.vlm_scene_extractions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can add scene extractions"
  ON public.vlm_scene_extractions FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can update scene extractions"
  ON public.vlm_scene_extractions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_vlm_scene_extractions_updated_at
  BEFORE UPDATE ON public.vlm_scene_extractions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();