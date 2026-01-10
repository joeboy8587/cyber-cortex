
-- Temporarily make all tables public by updating RLS policies to use true

-- Drop existing restrictive policies and recreate with public access

-- entity_registry
DROP POLICY IF EXISTS "Investigators can view entities" ON public.entity_registry;
DROP POLICY IF EXISTS "Investigators can insert entities" ON public.entity_registry;
DROP POLICY IF EXISTS "Admins can update entities" ON public.entity_registry;
CREATE POLICY "Public view entities" ON public.entity_registry FOR SELECT USING (true);
CREATE POLICY "Public insert entities" ON public.entity_registry FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update entities" ON public.entity_registry FOR UPDATE USING (true) WITH CHECK (true);

-- master_forensic_events
DROP POLICY IF EXISTS "Investigators can view forensic events" ON public.master_forensic_events;
DROP POLICY IF EXISTS "Investigators can insert forensic events" ON public.master_forensic_events;
DROP POLICY IF EXISTS "Admins can update forensic events" ON public.master_forensic_events;
CREATE POLICY "Public view forensic events" ON public.master_forensic_events FOR SELECT USING (true);
CREATE POLICY "Public insert forensic events" ON public.master_forensic_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update forensic events" ON public.master_forensic_events FOR UPDATE USING (true) WITH CHECK (true);

-- evidence_chain_links
DROP POLICY IF EXISTS "Investigators can view chain links" ON public.evidence_chain_links;
DROP POLICY IF EXISTS "Investigators can insert chain links" ON public.evidence_chain_links;
CREATE POLICY "Public view chain links" ON public.evidence_chain_links FOR SELECT USING (true);
CREATE POLICY "Public insert chain links" ON public.evidence_chain_links FOR INSERT WITH CHECK (true);

-- evidence_documents
DROP POLICY IF EXISTS "Investigators can view documents" ON public.evidence_documents;
DROP POLICY IF EXISTS "Investigators can insert documents" ON public.evidence_documents;
DROP POLICY IF EXISTS "Investigators can update documents" ON public.evidence_documents;
DROP POLICY IF EXISTS "Admins can delete documents" ON public.evidence_documents;
CREATE POLICY "Public view documents" ON public.evidence_documents FOR SELECT USING (true);
CREATE POLICY "Public insert documents" ON public.evidence_documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update documents" ON public.evidence_documents FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete documents" ON public.evidence_documents FOR DELETE USING (true);

-- aircraft_registry
DROP POLICY IF EXISTS "Investigators can view aircraft" ON public.aircraft_registry;
DROP POLICY IF EXISTS "Investigators can insert aircraft" ON public.aircraft_registry;
DROP POLICY IF EXISTS "Admins can update aircraft" ON public.aircraft_registry;
CREATE POLICY "Public view aircraft" ON public.aircraft_registry FOR SELECT USING (true);
CREATE POLICY "Public insert aircraft" ON public.aircraft_registry FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update aircraft" ON public.aircraft_registry FOR UPDATE USING (true) WITH CHECK (true);

-- kcso_fleet
DROP POLICY IF EXISTS "Public can view KCSO fleet" ON public.kcso_fleet;
DROP POLICY IF EXISTS "Investigators can insert KCSO fleet" ON public.kcso_fleet;
DROP POLICY IF EXISTS "Admins can update KCSO fleet" ON public.kcso_fleet;
CREATE POLICY "Public view KCSO fleet" ON public.kcso_fleet FOR SELECT USING (true);
CREATE POLICY "Public insert KCSO fleet" ON public.kcso_fleet FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update KCSO fleet" ON public.kcso_fleet FOR UPDATE USING (true) WITH CHECK (true);

-- correlation_job_status
DROP POLICY IF EXISTS "Investigators can view job status" ON public.correlation_job_status;
DROP POLICY IF EXISTS "Admins can manage job status" ON public.correlation_job_status;
CREATE POLICY "Public view job status" ON public.correlation_job_status FOR SELECT USING (true);
CREATE POLICY "Public manage job status" ON public.correlation_job_status FOR ALL USING (true) WITH CHECK (true);

-- user_roles
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Public view roles" ON public.user_roles FOR SELECT USING (true);
CREATE POLICY "Public manage roles" ON public.user_roles FOR ALL USING (true) WITH CHECK (true);

-- profiles
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Public view profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Public insert profiles" ON public.profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update profiles" ON public.profiles FOR UPDATE USING (true) WITH CHECK (true);
