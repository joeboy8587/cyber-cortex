DROP POLICY IF EXISTS "auth insert reasoning" ON public.reasoning_outputs;
DROP POLICY IF EXISTS "auth read reasoning" ON public.reasoning_outputs;
CREATE POLICY "Investigators read reasoning" ON public.reasoning_outputs FOR SELECT TO authenticated USING (public.is_investigator_or_admin());
CREATE POLICY "Investigators add reasoning" ON public.reasoning_outputs FOR INSERT TO authenticated WITH CHECK (public.is_investigator_or_admin());

DROP POLICY IF EXISTS "Authenticated can read scene extractions" ON public.vlm_scene_extractions;
DROP POLICY IF EXISTS "Authenticated can add scene extractions" ON public.vlm_scene_extractions;
DROP POLICY IF EXISTS "Authenticated can update scene extractions" ON public.vlm_scene_extractions;
CREATE POLICY "Investigators read scene extractions" ON public.vlm_scene_extractions FOR SELECT TO authenticated USING (public.is_investigator_or_admin());
CREATE POLICY "Investigators add own scene extractions" ON public.vlm_scene_extractions FOR INSERT TO authenticated WITH CHECK (public.is_investigator_or_admin() AND (uploaded_by IS NULL OR uploaded_by = auth.uid()));
CREATE POLICY "Investigators update scene extractions" ON public.vlm_scene_extractions FOR UPDATE TO authenticated USING (public.is_investigator_or_admin()) WITH CHECK (public.is_investigator_or_admin());