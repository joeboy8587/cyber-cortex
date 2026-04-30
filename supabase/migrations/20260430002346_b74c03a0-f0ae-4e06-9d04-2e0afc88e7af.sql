-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents (one row per uploaded file)
CREATE TABLE public.rag_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_size bigint,
  sha256_hash text,
  document_type text DEFAULT 'evidence',
  tags text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending', -- pending|parsing|chunking|embedding|analyzing|ready|failed
  status_message text,
  chunk_count integer DEFAULT 0,
  extraction_summary jsonb DEFAULT '{}',
  raw_text_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rag_documents_status ON public.rag_documents(status);
CREATE INDEX idx_rag_documents_created ON public.rag_documents(created_at DESC);
CREATE INDEX idx_rag_documents_tags ON public.rag_documents USING GIN(tags);

ALTER TABLE public.rag_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators view rag docs" ON public.rag_documents
  FOR SELECT USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Investigators insert rag docs" ON public.rag_documents
  FOR INSERT WITH CHECK (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Investigators update rag docs" ON public.rag_documents
  FOR UPDATE USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete rag docs" ON public.rag_documents
  FOR DELETE USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_rag_documents_updated
  BEFORE UPDATE ON public.rag_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Chunks with embeddings
CREATE TABLE public.rag_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.rag_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  token_estimate integer,
  embedding vector(1536),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rag_chunks_document ON public.rag_chunks(document_id);
CREATE INDEX idx_rag_chunks_embedding ON public.rag_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE public.rag_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators view rag chunks" ON public.rag_chunks
  FOR SELECT USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Investigators insert rag chunks" ON public.rag_chunks
  FOR INSERT WITH CHECK (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete rag chunks" ON public.rag_chunks
  FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- Auto-extractions queue
CREATE TABLE public.rag_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.rag_documents(id) ON DELETE CASCADE,
  extraction_type text NOT NULL, -- entity|belief|date|aircraft|shell|location|claim
  label text NOT NULL,
  value text,
  context text,
  confidence numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending|auto_promoted|approved|rejected
  promoted_to text, -- e.g. evidence_documents:<uuid> or watchtower_autonomous_flags:<uuid>
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rag_extractions_document ON public.rag_extractions(document_id);
CREATE INDEX idx_rag_extractions_status ON public.rag_extractions(status);
CREATE INDEX idx_rag_extractions_confidence ON public.rag_extractions(confidence DESC);

ALTER TABLE public.rag_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators view rag extractions" ON public.rag_extractions
  FOR SELECT USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Investigators insert rag extractions" ON public.rag_extractions
  FOR INSERT WITH CHECK (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Investigators update rag extractions" ON public.rag_extractions
  FOR UPDATE USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));

-- Semantic search RPC
CREATE OR REPLACE FUNCTION public.match_rag_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 8,
  similarity_threshold float DEFAULT 0.5
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  document_type text,
  tags text[],
  chunk_index int,
  content text,
  similarity float
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    c.id AS chunk_id,
    c.document_id,
    d.title AS document_title,
    d.document_type,
    d.tags,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.rag_chunks c
  JOIN public.rag_documents d ON d.id = c.document_id
  WHERE c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('rag-uploads', 'rag-uploads', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Investigators view rag uploads" ON storage.objects
  FOR SELECT USING (bucket_id = 'rag-uploads' AND (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Investigators upload rag files" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'rag-uploads' AND (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Investigators update rag files" ON storage.objects
  FOR UPDATE USING (bucket_id = 'rag-uploads' AND (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins delete rag files" ON storage.objects
  FOR DELETE USING (bucket_id = 'rag-uploads' AND has_role(auth.uid(), 'admin'));