CREATE TABLE public.watchtower_daily_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date DATE NOT NULL,
  report_id_code VARCHAR(50) NOT NULL UNIQUE,
  threat_level VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  active_aircraft_count INTEGER NOT NULL DEFAULT 0,
  confirmed_threats INTEGER NOT NULL DEFAULT 0,
  suspicious_count INTEGER NOT NULL DEFAULT 0,
  monitored_count INTEGER NOT NULL DEFAULT 0,
  violations JSONB NOT NULL DEFAULT '[]'::jsonb,
  threat_database JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_aircraft JSONB NOT NULL DEFAULT '[]'::jsonb,
  pattern_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_synthesis TEXT,
  report_html TEXT,
  sha256_hash VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.watchtower_daily_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators can view daily reports"
ON public.watchtower_daily_reports
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Investigators can insert daily reports"
ON public.watchtower_daily_reports
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Investigators can update daily reports"
ON public.watchtower_daily_reports
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_daily_reports_date ON public.watchtower_daily_reports(report_date DESC);
CREATE INDEX idx_daily_reports_threat ON public.watchtower_daily_reports(threat_level);