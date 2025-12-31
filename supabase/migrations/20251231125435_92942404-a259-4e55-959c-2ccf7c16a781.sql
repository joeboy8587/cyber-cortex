-- Create aircraft registry table for scraped data
CREATE TABLE public.aircraft_registry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  n_number TEXT NOT NULL,
  serial_number TEXT,
  aircraft_manufacturer TEXT,
  aircraft_model TEXT,
  engine_manufacturer TEXT,
  engine_model TEXT,
  year_manufactured INTEGER,
  registrant_type TEXT,
  registrant_name TEXT,
  registrant_street TEXT,
  registrant_city TEXT,
  registrant_state TEXT,
  registrant_zip TEXT,
  registrant_country TEXT,
  certificate_issue_date DATE,
  airworthiness_date DATE,
  expiration_date DATE,
  last_action_date DATE,
  status TEXT,
  mode_s_code TEXT,
  mode_s_hex TEXT,
  fractional_owner BOOLEAN DEFAULT false,
  raw_data JSONB,
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(n_number, serial_number)
);

-- Enable RLS
ALTER TABLE public.aircraft_registry ENABLE ROW LEVEL SECURITY;

-- Allow public read access for registry data (public FAA data)
CREATE POLICY "Anyone can view aircraft registry" 
ON public.aircraft_registry 
FOR SELECT 
USING (true);

-- Allow authenticated users to insert/update
CREATE POLICY "Authenticated users can insert aircraft registry" 
ON public.aircraft_registry 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Authenticated users can update aircraft registry" 
ON public.aircraft_registry 
FOR UPDATE 
USING (true);

-- Create index for fast lookups
CREATE INDEX idx_aircraft_registry_n_number ON public.aircraft_registry(n_number);
CREATE INDEX idx_aircraft_registry_mode_s_hex ON public.aircraft_registry(mode_s_hex);
CREATE INDEX idx_aircraft_registry_registrant ON public.aircraft_registry(registrant_name);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_aircraft_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_aircraft_registry_updated_at
BEFORE UPDATE ON public.aircraft_registry
FOR EACH ROW
EXECUTE FUNCTION public.update_aircraft_registry_updated_at();