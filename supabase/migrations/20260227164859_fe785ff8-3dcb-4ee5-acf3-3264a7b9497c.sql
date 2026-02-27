
-- Create unmasked_hq_locations table for storing discovered base/HQ locations
CREATE TABLE public.unmasked_hq_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cluster_center_lat DOUBLE PRECISION NOT NULL,
  cluster_center_lng DOUBLE PRECISION NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 0,
  unique_aircraft INTEGER NOT NULL DEFAULT 0,
  aircraft_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_visit TIMESTAMP WITH TIME ZONE,
  last_visit TIMESTAMP WITH TIME ZONE,
  hq_confidence_score INTEGER NOT NULL DEFAULT 0,
  location_type TEXT NOT NULL DEFAULT 'unknown_facility',
  cross_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  night_operations INTEGER NOT NULL DEFAULT 0,
  ai_assessment TEXT,
  scan_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.unmasked_hq_locations ENABLE ROW LEVEL SECURITY;

-- RLS policies for investigator/admin access
CREATE POLICY "Investigators can view HQ locations"
  ON public.unmasked_hq_locations FOR SELECT
  USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert HQ locations"
  ON public.unmasked_hq_locations FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can update HQ locations"
  ON public.unmasked_hq_locations FOR UPDATE
  USING (has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_unmasked_hq_locations_updated_at
  BEFORE UPDATE ON public.unmasked_hq_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for geo queries
CREATE INDEX idx_unmasked_hq_geo ON public.unmasked_hq_locations (cluster_center_lat, cluster_center_lng);
CREATE INDEX idx_unmasked_hq_confidence ON public.unmasked_hq_locations (hq_confidence_score DESC);
