-- Fix security vulnerabilities: Restrict all sensitive tables to investigators/admins only

-- 1. KCSO Fleet - Drop public access, require role
DROP POLICY IF EXISTS "Anyone can view KCSO fleet" ON public.kcso_fleet;
CREATE POLICY "Investigators can view KCSO fleet" 
  ON public.kcso_fleet FOR SELECT 
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));

-- 2. Aircraft Registry - Drop public access, require role
DROP POLICY IF EXISTS "Anyone can view aircraft" ON public.aircraft_registry;
CREATE POLICY "Investigators can view aircraft" 
  ON public.aircraft_registry FOR SELECT 
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));

-- 3. Evidence Documents - Drop authenticated-only, require role
DROP POLICY IF EXISTS "Authenticated can view documents" ON public.evidence_documents;
CREATE POLICY "Investigators can view documents" 
  ON public.evidence_documents FOR SELECT 
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));

-- 4. Entity Registry - Drop authenticated-only, require role
DROP POLICY IF EXISTS "Authenticated can view entities" ON public.entity_registry;
CREATE POLICY "Investigators can view entities" 
  ON public.entity_registry FOR SELECT 
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));

-- 5. Master Forensic Events - Drop authenticated-only, require role
DROP POLICY IF EXISTS "Authenticated can view forensic events" ON public.master_forensic_events;
CREATE POLICY "Investigators can view forensic events" 
  ON public.master_forensic_events FOR SELECT 
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));

-- 6. Evidence Chain Links - Drop authenticated-only, require role
DROP POLICY IF EXISTS "Authenticated can view chain links" ON public.evidence_chain_links;
CREATE POLICY "Investigators can view chain links" 
  ON public.evidence_chain_links FOR SELECT 
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));

-- 7. Correlation Job Status - Also restrict to investigators/admins
DROP POLICY IF EXISTS "Authenticated can view job status" ON public.correlation_job_status;
CREATE POLICY "Investigators can view job status" 
  ON public.correlation_job_status FOR SELECT 
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));