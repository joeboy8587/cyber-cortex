DROP POLICY IF EXISTS "Anyone can read settled facts" ON public.settled_facts;
REVOKE SELECT ON public.settled_facts FROM anon;
CREATE POLICY "Investigators can read settled facts" ON public.settled_facts FOR SELECT TO authenticated USING (public.is_investigator_or_admin());