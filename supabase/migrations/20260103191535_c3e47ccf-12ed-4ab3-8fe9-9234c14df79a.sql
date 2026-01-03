-- Phase 1: Master Forensic Event System

-- 1.1 Create event type enum
CREATE TYPE public.forensic_event_type AS ENUM (
  'flight', 'biometric', 'witness', 'ocr', 'legal', 'alert', 'multi_factor'
);

-- 1.2 Create entity type enum
CREATE TYPE public.entity_type AS ENUM (
  'aircraft', 'operator', 'agency', 'shell_company', 'contractor', 'individual'
);

-- 1.3 Create link type enum
CREATE TYPE public.link_type AS ENUM (
  'temporal', 'causal', 'witness', 'documentary', 'biometric', 'spatial'
);

-- 1.4 Create master_forensic_events table (the forensic spine)
CREATE TABLE public.master_forensic_events (
  forensic_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  event_type forensic_event_type NOT NULL,
  primary_entity_type entity_type,
  primary_entity_id TEXT,
  geo_lat DOUBLE PRECISION,
  geo_lng DOUBLE PRECISION,
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  bradford_hill_score NUMERIC(5,2),
  chain_of_custody_hash TEXT,
  linked_records JSONB DEFAULT '[]'::jsonb,
  temporal_cluster_id UUID,
  is_physical_verified BOOLEAN DEFAULT false,
  factor_count INTEGER DEFAULT 1,
  summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 1.5 Create entity_registry table (unified entity resolution)
CREATE TABLE public.entity_registry (
  entity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type entity_type NOT NULL,
  canonical_identifier TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  source_tables JSONB DEFAULT '[]'::jsonb,
  first_seen TIMESTAMP WITH TIME ZONE,
  last_seen TIMESTAMP WITH TIME ZONE,
  threat_classification TEXT,
  linked_forensic_events UUID[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(entity_type, canonical_identifier)
);

-- 1.6 Create evidence_chain_links table (immutable audit trail)
CREATE TABLE public.evidence_chain_links (
  link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forensic_event_id UUID REFERENCES public.master_forensic_events(forensic_event_id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  link_type link_type NOT NULL,
  link_confidence INTEGER CHECK (link_confidence >= 0 AND link_confidence <= 100),
  link_hash TEXT,
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  linked_by TEXT DEFAULT 'system'
);

-- 1.7 Create correlation_job_status table (track backfill progress)
CREATE TABLE public.correlation_job_status (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  target_table TEXT,
  total_records INTEGER,
  processed_records INTEGER DEFAULT 0,
  linked_records INTEGER DEFAULT 0,
  last_cursor TEXT,
  status TEXT DEFAULT 'pending',
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 1.8 Create indexes for fast lookups
CREATE INDEX idx_forensic_events_timestamp ON public.master_forensic_events(event_timestamp);
CREATE INDEX idx_forensic_events_type ON public.master_forensic_events(event_type);
CREATE INDEX idx_forensic_events_entity ON public.master_forensic_events(primary_entity_type, primary_entity_id);
CREATE INDEX idx_forensic_events_cluster ON public.master_forensic_events(temporal_cluster_id);
CREATE INDEX idx_forensic_events_bradford ON public.master_forensic_events(bradford_hill_score DESC);
CREATE INDEX idx_forensic_events_geo ON public.master_forensic_events(geo_lat, geo_lng);

CREATE INDEX idx_entity_registry_type ON public.entity_registry(entity_type);
CREATE INDEX idx_entity_registry_identifier ON public.entity_registry(canonical_identifier);
CREATE INDEX idx_entity_registry_threat ON public.entity_registry(threat_classification);

CREATE INDEX idx_chain_links_event ON public.evidence_chain_links(forensic_event_id);
CREATE INDEX idx_chain_links_source ON public.evidence_chain_links(source_table, source_id);

CREATE INDEX idx_job_status_type ON public.correlation_job_status(job_type, status);

-- 1.9 Enable RLS
ALTER TABLE public.master_forensic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_chain_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correlation_job_status ENABLE ROW LEVEL SECURITY;

-- 1.10 Create RLS policies (authenticated access)
CREATE POLICY "Authenticated users can view forensic events"
  ON public.master_forensic_events FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert forensic events"
  ON public.master_forensic_events FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update forensic events"
  ON public.master_forensic_events FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can view entity registry"
  ON public.entity_registry FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert entity registry"
  ON public.entity_registry FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update entity registry"
  ON public.entity_registry FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can view chain links"
  ON public.evidence_chain_links FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert chain links"
  ON public.evidence_chain_links FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can view job status"
  ON public.correlation_job_status FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage job status"
  ON public.correlation_job_status FOR ALL
  TO authenticated USING (true);

-- 1.11 Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1.12 Add updated_at triggers
CREATE TRIGGER update_master_forensic_events_updated_at
  BEFORE UPDATE ON public.master_forensic_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_entity_registry_updated_at
  BEFORE UPDATE ON public.entity_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();