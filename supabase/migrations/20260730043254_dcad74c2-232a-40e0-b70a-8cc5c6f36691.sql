
ALTER TABLE public.watchtower_autonomous_flags
  ADD COLUMN IF NOT EXISTS signature text,
  ADD COLUMN IF NOT EXISTS occurrence_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS first_seen timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen timestamptz;

CREATE OR REPLACE FUNCTION public.wt_flag_signature(_flag_type text, _registration text, _description text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT md5(
    lower(coalesce(_flag_type,'')) || '|' ||
    upper(coalesce(_registration,'')) || '|' ||
    lower(regexp_replace(coalesce(_description,''), '[0-9]+', '#', 'g'))
  )
$$;

CREATE OR REPLACE FUNCTION public.wt_effective_severity(_flag_type text, _severity text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN upper(coalesce(_flag_type,'')) IN (
      'PHYSICS_VIOLATION','ALTITUDE_ANOMALY','LAYERED_DECEPTION',
      'BIOMETRIC_CORRELATION','XXB_MLAT_ANOMALY',
      'FICTITIOUS_TAIL_NUMBER_NO_FAA_REGISTRY','ICAO_FAA_HEX_MISMATCH'
    ) THEN 'critical'
    WHEN upper(coalesce(_flag_type,'')) IN (
      'TEMPORAL_CONVERGENCE','EVOLVED_THREAT_PATTERN','RESCAN_DISCOVERY',
      'DOD_VENDOR_CONFIRMATION','NETWORK_HUB'
    ) THEN 'high'
    WHEN upper(coalesce(_flag_type,'')) IN ('PRE_CONFIRMED_PRESENCE','FREQUENCY_SPIKE')
      THEN 'info'
    ELSE lower(coalesce(_severity,'medium'))
  END
$$;

CREATE INDEX IF NOT EXISTS idx_wt_flags_signature ON public.watchtower_autonomous_flags (signature);
CREATE INDEX IF NOT EXISTS idx_wt_flags_triage ON public.watchtower_autonomous_flags (auto_resolved, severity, last_seen DESC);

CREATE OR REPLACE FUNCTION public.wt_flags_dedupe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _sig text;
  _existing uuid;
BEGIN
  _sig := public.wt_flag_signature(NEW.flag_type, NEW.registration, NEW.description);
  NEW.signature := _sig;
  NEW.first_seen := COALESCE(NEW.first_seen, NEW.created_at, now());
  NEW.last_seen := COALESCE(NEW.last_seen, NEW.created_at, now());

  SELECT id INTO _existing
  FROM public.watchtower_autonomous_flags
  WHERE signature = _sig AND COALESCE(auto_resolved,false) = false
  ORDER BY created_at ASC
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    UPDATE public.watchtower_autonomous_flags
    SET occurrence_count = occurrence_count + 1,
        last_seen = GREATEST(COALESCE(last_seen, now()), COALESCE(NEW.created_at, now())),
        evidence_summary = COALESCE(NEW.evidence_summary, evidence_summary),
        confidence_score = GREATEST(COALESCE(confidence_score,0), COALESCE(NEW.confidence_score,0)),
        updated_at = now()
    WHERE id = _existing;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wt_flags_dedupe ON public.watchtower_autonomous_flags;
CREATE TRIGGER trg_wt_flags_dedupe
BEFORE INSERT ON public.watchtower_autonomous_flags
FOR EACH ROW EXECUTE FUNCTION public.wt_flags_dedupe();

CREATE OR REPLACE VIEW public.v_watchtower_flag_groups
WITH (security_invoker = true) AS
SELECT
  f.id,
  f.signature,
  f.flag_type,
  f.registration,
  f.description,
  f.severity AS raw_severity,
  public.wt_effective_severity(f.flag_type, f.severity) AS effective_severity,
  f.occurrence_count,
  COALESCE(f.first_seen, f.created_at) AS first_seen,
  COALESCE(f.last_seen, f.created_at) AS last_seen,
  f.confidence_score,
  f.evidence_summary,
  f.cross_references,
  f.source_scan_id,
  f.created_at
FROM public.watchtower_autonomous_flags f
WHERE COALESCE(f.auto_resolved, false) = false;

CREATE OR REPLACE VIEW public.v_pipeline_freshness
WITH (security_invoker = true) AS
SELECT 'Autonomous flags'::text AS stage, max(created_at) AS latest, count(*)::bigint AS row_count FROM public.watchtower_autonomous_flags
UNION ALL SELECT 'Forensic events', max(created_at), count(*) FROM public.master_forensic_events
UNION ALL SELECT 'Merkle ledger', max(anchored_at), count(*) FROM public.evidence_merkle_ledger
UNION ALL SELECT 'Exhibits', max(updated_at), count(*) FROM public.exhibits
UNION ALL SELECT 'Policy violations', max(created_at), count(*) FROM public.policy_violations
UNION ALL SELECT 'Daily reports', max(created_at), count(*) FROM public.watchtower_daily_reports
UNION ALL SELECT 'Sentinel threats', max(updated_at), count(*) FROM public.sentinel_learned_threats
UNION ALL SELECT 'Evidence documents', max(updated_at), count(*) FROM public.evidence_documents;

GRANT SELECT ON public.v_watchtower_flag_groups TO authenticated;
GRANT SELECT ON public.v_pipeline_freshness TO authenticated;
