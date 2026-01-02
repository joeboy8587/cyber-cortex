-- SECURITY FIX: Remove dangerous public policies from evidence_documents
DROP POLICY IF EXISTS "Allow public delete" ON public.evidence_documents;
DROP POLICY IF EXISTS "Allow public insert" ON public.evidence_documents;
DROP POLICY IF EXISTS "Allow public read" ON public.evidence_documents;
DROP POLICY IF EXISTS "Allow public update" ON public.evidence_documents;

-- Create secure policies for evidence_documents (authenticated users only)
CREATE POLICY "Authenticated users can view evidence documents"
ON public.evidence_documents
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert evidence documents"
ON public.evidence_documents
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update evidence documents"
ON public.evidence_documents
FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete evidence documents"
ON public.evidence_documents
FOR DELETE
TO authenticated
USING (true);

-- SECURITY FIX: Remove public read on aircraft_registry with PII
DROP POLICY IF EXISTS "Anyone can view aircraft registry" ON public.aircraft_registry;

-- Create secure policy for aircraft_registry (authenticated users only)
CREATE POLICY "Authenticated users can view aircraft registry"
ON public.aircraft_registry
FOR SELECT
TO authenticated
USING (true);