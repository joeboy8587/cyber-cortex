
-- Agent investigation sessions
CREATE TABLE public.agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New Investigation',
  summary text,
  active_agent text NOT NULL DEFAULT 'legal_analyst',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Agent messages within sessions
CREATE TABLE public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  agent text NOT NULL,
  content text NOT NULL DEFAULT '',
  message_type text NOT NULL DEFAULT 'user',
  target_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Generated case file documents
CREATE TABLE public.agent_case_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'legal_draft',
  content text NOT NULL,
  agent text NOT NULL,
  sha256_hash text,
  tags text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_agent_messages_session ON public.agent_messages(session_id, created_at);
CREATE INDEX idx_agent_sessions_user ON public.agent_sessions(user_id, updated_at DESC);
CREATE INDEX idx_agent_case_files_session ON public.agent_case_files(session_id);

-- RLS
ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_case_files ENABLE ROW LEVEL SECURITY;

-- Policies: investigators and admins can CRUD
CREATE POLICY "Investigators can view sessions" ON public.agent_sessions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Investigators can insert sessions" ON public.agent_sessions FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Investigators can update sessions" ON public.agent_sessions FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can view messages" ON public.agent_messages FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Investigators can insert messages" ON public.agent_messages FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can view case files" ON public.agent_case_files FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Investigators can insert case files" ON public.agent_case_files FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Investigators can update case files" ON public.agent_case_files FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'investigator') OR has_role(auth.uid(), 'admin'));
