-- Create KCSO fleet table with citation support
CREATE TABLE public.kcso_fleet (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tail_number TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  model_citation TEXT,
  tail_number_citation TEXT,
  frequent_oildale_operation BOOLEAN,
  oildale_citation TEXT,
  surveillance_capabilities TEXT,
  surveillance_citation TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.kcso_fleet ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Anyone can view KCSO fleet" ON public.kcso_fleet
  FOR SELECT USING (true);

-- Authenticated insert/update
CREATE POLICY "Authenticated users can insert KCSO fleet" ON public.kcso_fleet
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Authenticated users can update KCSO fleet" ON public.kcso_fleet
  FOR UPDATE USING (true);