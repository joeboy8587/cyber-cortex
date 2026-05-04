
CREATE TABLE IF NOT EXISTS public.manual_flight_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL,
  registration TEXT,
  icao24 TEXT,
  callsign TEXT,
  aircraft_type TEXT,
  altitude_ft NUMERIC,
  ground_speed_kts NUMERIC,
  track_deg NUMERIC,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  route TEXT,
  behavior TEXT,
  hr_bpm NUMERIC,
  hrv_ms NUMERIC,
  stress_pct NUMERIC,
  decibel_avg NUMERIC,
  decibel_peak NUMERIC,
  source_pdf TEXT,
  provenance TEXT NOT NULL DEFAULT 'manual_pdf_log',
  notes TEXT,
  sha256_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_manual_flight_logs_observed_at ON public.manual_flight_logs(observed_at DESC);
CREATE INDEX idx_manual_flight_logs_registration ON public.manual_flight_logs(registration);
CREATE INDEX idx_manual_flight_logs_icao24 ON public.manual_flight_logs(icao24);

ALTER TABLE public.manual_flight_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators view manual logs" ON public.manual_flight_logs
  FOR SELECT USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Investigators insert manual logs" ON public.manual_flight_logs
  FOR INSERT WITH CHECK (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Investigators update manual logs" ON public.manual_flight_logs
  FOR UPDATE USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete manual logs" ON public.manual_flight_logs
  FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));
