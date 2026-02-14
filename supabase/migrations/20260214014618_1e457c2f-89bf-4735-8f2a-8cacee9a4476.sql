
-- Create sentinel_learned_threats table for persistent threat memory
CREATE TABLE public.sentinel_learned_threats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration text NOT NULL,
  threat_type text NOT NULL,
  total_violations int DEFAULT 1,
  escalation_level int DEFAULT 1,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now(),
  avg_altitude numeric,
  countermeasure_status text DEFAULT 'NONE',
  countermeasure_actions jsonb DEFAULT '[]'::jsonb,
  ai_threat_profile text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(registration, threat_type)
);

-- Enable RLS
ALTER TABLE public.sentinel_learned_threats ENABLE ROW LEVEL SECURITY;

-- RLS policies matching existing investigator/admin pattern
CREATE POLICY "Investigators can view learned threats"
ON public.sentinel_learned_threats
FOR SELECT
USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Investigators can insert learned threats"
ON public.sentinel_learned_threats
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Investigators can update learned threats"
ON public.sentinel_learned_threats
FOR UPDATE
USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
