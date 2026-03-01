
-- Create sequence for monotonic ordering
CREATE SEQUENCE IF NOT EXISTS public.evidence_merkle_ledger_seq;

-- Create the Merkle audit ledger table
CREATE TABLE public.evidence_merkle_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number bigint NOT NULL DEFAULT nextval('public.evidence_merkle_ledger_seq'),
  source_table text NOT NULL,
  source_id text NOT NULL,
  record_hash text NOT NULL,
  previous_chain_hash text NOT NULL,
  chain_hash text NOT NULL,
  anchored_at timestamptz NOT NULL DEFAULT now(),
  batch_id text
);

-- Unique constraint on sequence for chain ordering
ALTER TABLE public.evidence_merkle_ledger ADD CONSTRAINT evidence_merkle_ledger_seq_unique UNIQUE (sequence_number);

-- Index for lookups by source
CREATE INDEX idx_merkle_ledger_source ON public.evidence_merkle_ledger (source_table, source_id);

-- Index for chain walking
CREATE INDEX idx_merkle_ledger_sequence ON public.evidence_merkle_ledger (sequence_number);

-- Index for batch lookups
CREATE INDEX idx_merkle_ledger_batch ON public.evidence_merkle_ledger (batch_id);

-- Enable RLS
ALTER TABLE public.evidence_merkle_ledger ENABLE ROW LEVEL SECURITY;

-- APPEND-ONLY: Investigators can INSERT (anchor new entries)
CREATE POLICY "Investigators can insert ledger entries"
ON public.evidence_merkle_ledger
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
);

-- Investigators can SELECT (read/verify the chain)
CREATE POLICY "Investigators can view ledger entries"
ON public.evidence_merkle_ledger
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'investigator'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
);

-- NO UPDATE policy = nobody can modify entries
-- NO DELETE policy = nobody can remove entries
