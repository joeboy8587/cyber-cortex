-- Create evidence_documents table for storing uploaded markdown evidence
CREATE TABLE public.evidence_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  file_size INTEGER,
  document_type TEXT DEFAULT 'evidence',
  tags TEXT[],
  sha256_hash TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.evidence_documents ENABLE ROW LEVEL SECURITY;

-- Allow public read/write for now (no auth)
CREATE POLICY "Allow public read" ON public.evidence_documents FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON public.evidence_documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON public.evidence_documents FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON public.evidence_documents FOR DELETE USING (true);

-- Create updated_at trigger
CREATE TRIGGER update_evidence_documents_updated_at
  BEFORE UPDATE ON public.evidence_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_aircraft_registry_updated_at();