-- ============================================
-- FORENSIC EVIDENCE RLS SECURITY IMPLEMENTATION
-- Chain of Custody Hardening for Court Admissibility
-- ============================================

-- 1. Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'investigator');

-- 2. Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'investigator',
    granted_by UUID REFERENCES auth.users(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, role)
);

-- 3. Create minimal profiles table for audit trails
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    department TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Enable RLS on new tables
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 5. Create security definer function to check roles (prevents recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- 6. Helper function: check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

-- 7. Helper function: check if user is investigator or admin
CREATE OR REPLACE FUNCTION public.is_investigator_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'investigator')
$$;

-- 8. RLS policies for user_roles (only admins can manage)
CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.is_admin() OR user_id = auth.uid());

CREATE POLICY "Admins can manage roles"
ON public.user_roles FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 9. RLS policies for profiles
CREATE POLICY "Users can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- 10. Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 11. Update profiles updated_at trigger
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- UPDATE EXISTING EVIDENCE TABLES RLS POLICIES
-- ============================================

-- Drop existing permissive policies on evidence tables
DROP POLICY IF EXISTS "Authenticated users can view entity registry" ON public.entity_registry;
DROP POLICY IF EXISTS "Authenticated users can insert entity registry" ON public.entity_registry;
DROP POLICY IF EXISTS "Authenticated users can update entity registry" ON public.entity_registry;

DROP POLICY IF EXISTS "Authenticated users can view forensic events" ON public.master_forensic_events;
DROP POLICY IF EXISTS "Authenticated users can insert forensic events" ON public.master_forensic_events;
DROP POLICY IF EXISTS "Authenticated users can update forensic events" ON public.master_forensic_events;

DROP POLICY IF EXISTS "Authenticated users can view chain links" ON public.evidence_chain_links;
DROP POLICY IF EXISTS "Authenticated users can insert chain links" ON public.evidence_chain_links;

DROP POLICY IF EXISTS "Authenticated users can view evidence documents" ON public.evidence_documents;
DROP POLICY IF EXISTS "Authenticated users can insert evidence documents" ON public.evidence_documents;
DROP POLICY IF EXISTS "Authenticated users can update evidence documents" ON public.evidence_documents;
DROP POLICY IF EXISTS "Authenticated users can delete evidence documents" ON public.evidence_documents;

DROP POLICY IF EXISTS "Authenticated users can view aircraft registry" ON public.aircraft_registry;
DROP POLICY IF EXISTS "Authenticated users can insert aircraft registry" ON public.aircraft_registry;
DROP POLICY IF EXISTS "Authenticated users can update aircraft registry" ON public.aircraft_registry;

DROP POLICY IF EXISTS "Anyone can view KCSO fleet" ON public.kcso_fleet;
DROP POLICY IF EXISTS "Authenticated users can insert KCSO fleet" ON public.kcso_fleet;
DROP POLICY IF EXISTS "Authenticated users can update KCSO fleet" ON public.kcso_fleet;

DROP POLICY IF EXISTS "Authenticated users can view job status" ON public.correlation_job_status;
DROP POLICY IF EXISTS "Authenticated users can manage job status" ON public.correlation_job_status;

-- ============================================
-- NEW ROLE-BASED RLS POLICIES FOR EVIDENCE TABLES
-- ============================================

-- entity_registry: Investigators can view/insert, Admins can update
CREATE POLICY "Investigators can view entities"
ON public.entity_registry FOR SELECT
TO authenticated
USING (public.is_investigator_or_admin());

CREATE POLICY "Investigators can insert entities"
ON public.entity_registry FOR INSERT
TO authenticated
WITH CHECK (public.is_investigator_or_admin());

CREATE POLICY "Admins can update entities"
ON public.entity_registry FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- master_forensic_events: Core evidence - strict access
CREATE POLICY "Investigators can view forensic events"
ON public.master_forensic_events FOR SELECT
TO authenticated
USING (public.is_investigator_or_admin());

CREATE POLICY "Investigators can insert forensic events"
ON public.master_forensic_events FOR INSERT
TO authenticated
WITH CHECK (public.is_investigator_or_admin());

CREATE POLICY "Admins can update forensic events"
ON public.master_forensic_events FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- evidence_chain_links: Chain of custody - append only for investigators
CREATE POLICY "Investigators can view chain links"
ON public.evidence_chain_links FOR SELECT
TO authenticated
USING (public.is_investigator_or_admin());

CREATE POLICY "Investigators can insert chain links"
ON public.evidence_chain_links FOR INSERT
TO authenticated
WITH CHECK (public.is_investigator_or_admin());

-- evidence_documents: Documents - full access for investigators
CREATE POLICY "Investigators can view documents"
ON public.evidence_documents FOR SELECT
TO authenticated
USING (public.is_investigator_or_admin());

CREATE POLICY "Investigators can insert documents"
ON public.evidence_documents FOR INSERT
TO authenticated
WITH CHECK (public.is_investigator_or_admin());

CREATE POLICY "Investigators can update documents"
ON public.evidence_documents FOR UPDATE
TO authenticated
USING (public.is_investigator_or_admin())
WITH CHECK (public.is_investigator_or_admin());

CREATE POLICY "Admins can delete documents"
ON public.evidence_documents FOR DELETE
TO authenticated
USING (public.is_admin());

-- aircraft_registry: Reference data
CREATE POLICY "Investigators can view aircraft"
ON public.aircraft_registry FOR SELECT
TO authenticated
USING (public.is_investigator_or_admin());

CREATE POLICY "Investigators can insert aircraft"
ON public.aircraft_registry FOR INSERT
TO authenticated
WITH CHECK (public.is_investigator_or_admin());

CREATE POLICY "Admins can update aircraft"
ON public.aircraft_registry FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- kcso_fleet: Public read, investigators can modify
CREATE POLICY "Public can view KCSO fleet"
ON public.kcso_fleet FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Investigators can insert KCSO fleet"
ON public.kcso_fleet FOR INSERT
TO authenticated
WITH CHECK (public.is_investigator_or_admin());

CREATE POLICY "Admins can update KCSO fleet"
ON public.kcso_fleet FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- correlation_job_status: System table - admin only for writes
CREATE POLICY "Investigators can view job status"
ON public.correlation_job_status FOR SELECT
TO authenticated
USING (public.is_investigator_or_admin());

CREATE POLICY "Admins can manage job status"
ON public.correlation_job_status FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());