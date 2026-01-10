-- Drop all existing overly-permissive policies and create proper role-based ones

-- ============================================
-- AIRCRAFT_REGISTRY - Public read, authenticated write
-- ============================================
DROP POLICY IF EXISTS "Public view aircraft" ON public.aircraft_registry;
DROP POLICY IF EXISTS "Public insert aircraft" ON public.aircraft_registry;
DROP POLICY IF EXISTS "Public update aircraft" ON public.aircraft_registry;

CREATE POLICY "Anyone can view aircraft"
ON public.aircraft_registry FOR SELECT
USING (true);

CREATE POLICY "Investigators can insert aircraft"
ON public.aircraft_registry FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can update aircraft"
ON public.aircraft_registry FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

-- ============================================
-- ENTITY_REGISTRY - Role-based access
-- ============================================
DROP POLICY IF EXISTS "Public view entities" ON public.entity_registry;
DROP POLICY IF EXISTS "Public insert entities" ON public.entity_registry;
DROP POLICY IF EXISTS "Public update entities" ON public.entity_registry;

CREATE POLICY "Authenticated can view entities"
ON public.entity_registry FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Investigators can insert entities"
ON public.entity_registry FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can update entities"
ON public.entity_registry FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

-- ============================================
-- MASTER_FORENSIC_EVENTS - Role-based access
-- ============================================
DROP POLICY IF EXISTS "Public view forensic events" ON public.master_forensic_events;
DROP POLICY IF EXISTS "Public insert forensic events" ON public.master_forensic_events;
DROP POLICY IF EXISTS "Public update forensic events" ON public.master_forensic_events;

CREATE POLICY "Authenticated can view forensic events"
ON public.master_forensic_events FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Investigators can insert forensic events"
ON public.master_forensic_events FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can update forensic events"
ON public.master_forensic_events FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

-- ============================================
-- EVIDENCE_CHAIN_LINKS - Role-based access
-- ============================================
DROP POLICY IF EXISTS "Public view chain links" ON public.evidence_chain_links;
DROP POLICY IF EXISTS "Public insert chain links" ON public.evidence_chain_links;

CREATE POLICY "Authenticated can view chain links"
ON public.evidence_chain_links FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Investigators can insert chain links"
ON public.evidence_chain_links FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

-- ============================================
-- EVIDENCE_DOCUMENTS - Role-based access
-- ============================================
DROP POLICY IF EXISTS "Public view documents" ON public.evidence_documents;
DROP POLICY IF EXISTS "Public insert documents" ON public.evidence_documents;
DROP POLICY IF EXISTS "Public update documents" ON public.evidence_documents;
DROP POLICY IF EXISTS "Public delete documents" ON public.evidence_documents;

CREATE POLICY "Authenticated can view documents"
ON public.evidence_documents FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Investigators can insert documents"
ON public.evidence_documents FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can update documents"
ON public.evidence_documents FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete documents"
ON public.evidence_documents FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- KCSO_FLEET - Public read, role-based write
-- ============================================
DROP POLICY IF EXISTS "Public view KCSO fleet" ON public.kcso_fleet;
DROP POLICY IF EXISTS "Public insert KCSO fleet" ON public.kcso_fleet;
DROP POLICY IF EXISTS "Public update KCSO fleet" ON public.kcso_fleet;

CREATE POLICY "Anyone can view KCSO fleet"
ON public.kcso_fleet FOR SELECT
USING (true);

CREATE POLICY "Investigators can insert KCSO fleet"
ON public.kcso_fleet FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can update KCSO fleet"
ON public.kcso_fleet FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

-- ============================================
-- CORRELATION_JOB_STATUS - Role-based access
-- ============================================
DROP POLICY IF EXISTS "Public view job status" ON public.correlation_job_status;
DROP POLICY IF EXISTS "Public manage job status" ON public.correlation_job_status;

CREATE POLICY "Authenticated can view job status"
ON public.correlation_job_status FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Investigators can manage job status"
ON public.correlation_job_status FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

-- ============================================
-- PROFILES - User can only see/edit own profile
-- ============================================
DROP POLICY IF EXISTS "Public view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public update profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- ============================================
-- USER_ROLES - Only admins can manage, users can view own
-- ============================================
DROP POLICY IF EXISTS "Public view roles" ON public.user_roles;
DROP POLICY IF EXISTS "Public manage roles" ON public.user_roles;

CREATE POLICY "Users can view own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
ON public.user_roles FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));