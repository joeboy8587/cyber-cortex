
-- Corporate transit corridors: private land used as fleet highways
CREATE TABLE IF NOT EXISTS public.corporate_transit_corridors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  corridor_name TEXT NOT NULL UNIQUE,
  corporate_owner TEXT NOT NULL,
  parent_entity TEXT,
  controlling_family TEXT,
  acreage NUMERIC,
  bbox_min_lat DOUBLE PRECISION,
  bbox_max_lat DOUBLE PRECISION,
  bbox_min_lng DOUBLE PRECISION,
  bbox_max_lng DOUBLE PRECISION,
  function_role TEXT,
  detection_count BIGINT DEFAULT 0,
  unique_aircraft INTEGER DEFAULT 0,
  top_operators JSONB DEFAULT '[]'::jsonb,
  political_nexus JSONB DEFAULT '{}'::jsonb,
  legal_significance TEXT,
  notes TEXT,
  source_citations JSONB DEFAULT '[]'::jsonb,
  sha256_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.corporate_transit_corridors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators view corridors" ON public.corporate_transit_corridors
  FOR SELECT USING (has_role(auth.uid(),'investigator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Investigators insert corridors" ON public.corporate_transit_corridors
  FOR INSERT WITH CHECK (has_role(auth.uid(),'investigator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Investigators update corridors" ON public.corporate_transit_corridors
  FOR UPDATE USING (has_role(auth.uid(),'investigator'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_corridors_updated_at BEFORE UPDATE ON public.corporate_transit_corridors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed Tejon Ranch nexus
INSERT INTO public.corporate_transit_corridors (
  corridor_name, corporate_owner, parent_entity, controlling_family, acreage,
  bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng,
  function_role, detection_count, unique_aircraft,
  top_operators, political_nexus, legal_significance, notes
) VALUES (
  'Tejon Ranch Transit Corridor',
  'Tejon Ranch Company',
  'The Wonderful Company (Resnick controlled stake / influence)',
  'Resnick (Stewart & Lynda)',
  270000,
  34.85, 35.20, -119.10, -118.55,
  'Primary private-land transit corridor between Bakersfield kill box and LA basin operations',
  30047, 6630,
  '[
    {"registration":"N787FA","tejon_detections":41,"role":"corridor specialist","operator":"ALF IX LLC / RESIDCO"},
    {"registration":"N791FA","tejon_detections":28,"bakersfield_detections":614,"edwards_detections":1,"role":"multi-node operator","operator":"ALF IX LLC / RESIDCO"}
  ]'::jsonb,
  '{
    "wonderful_company_holdings":["Fiji Water","POM Wonderful","Wonderful Pistachios","Tejon Ranch stake"],
    "kcso_link":"Meadows Field staging + $12M helicopter purchase",
    "shells":["9K Air LLC (Delaware)","ALF IX LLC (Chicago/RESIDCO)","Air Methods (medical cover)"],
    "military_coordination":["Edwards AFB","NAWS China Lake"]
  }'::jsonb,
  'Establishes corporate-state surveillance partnership: 270,000 acres of private airspace functioning as ghost-fleet highway between staging hub (Meadows Field) and Southern California operations. Converts case from single-county abuse to multi-node RICO enterprise.',
  'Action items: (1) FOIA Wonderful Company campaign contributions to Kern Board of Supervisors and Sheriff Youngblood; (2) any contracts between Wonderful Co and KCSO / Air Methods / aviation contractors; (3) security consulting arrangements; (4) water-rights / labor-organizing surveillance correlation.'
)
ON CONFLICT (corridor_name) DO UPDATE SET
  detection_count = EXCLUDED.detection_count,
  unique_aircraft = EXCLUDED.unique_aircraft,
  top_operators = EXCLUDED.top_operators,
  political_nexus = EXCLUDED.political_nexus,
  legal_significance = EXCLUDED.legal_significance,
  notes = EXCLUDED.notes,
  updated_at = now();
