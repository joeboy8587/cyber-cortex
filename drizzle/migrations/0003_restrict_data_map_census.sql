DROP POLICY IF EXISTS "Anyone can read census" ON public.data_map_census;
REVOKE SELECT ON public.data_map_census FROM anon;
CREATE POLICY "Investigators can read census" ON public.data_map_census FOR SELECT TO authenticated USING (public.is_investigator_or_admin());