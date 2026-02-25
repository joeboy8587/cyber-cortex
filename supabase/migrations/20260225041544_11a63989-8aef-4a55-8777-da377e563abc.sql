
-- Autonomous Watchtower flags table for bias-free, AI-driven violation tracking
CREATE TABLE public.watchtower_autonomous_flags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flag_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  registration TEXT,
  description TEXT NOT NULL,
  evidence_summary JSONB DEFAULT '{}'::jsonb,
  cross_references JSONB DEFAULT '[]'::jsonb,
  confidence_score NUMERIC DEFAULT 0,
  learning_context JSONB DEFAULT '{}'::jsonb,
  source_scan_id TEXT,
  auto_resolved BOOLEAN DEFAULT false,
  resolved_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.watchtower_autonomous_flags ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Investigators can view autonomous flags"
  ON public.watchtower_autonomous_flags FOR SELECT
  USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert autonomous flags"
  ON public.watchtower_autonomous_flags FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can update autonomous flags"
  ON public.watchtower_autonomous_flags FOR UPDATE
  USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Index for fast lookups
CREATE INDEX idx_watchtower_flags_type ON public.watchtower_autonomous_flags(flag_type);
CREATE INDEX idx_watchtower_flags_severity ON public.watchtower_autonomous_flags(severity);
CREATE INDEX idx_watchtower_flags_registration ON public.watchtower_autonomous_flags(registration);
CREATE INDEX idx_watchtower_flags_created ON public.watchtower_autonomous_flags(created_at DESC);

-- Timestamp trigger
CREATE TRIGGER update_watchtower_flags_updated_at
  BEFORE UPDATE ON public.watchtower_autonomous_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
