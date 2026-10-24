-- Run through Neon gateway as one statement; raises on regression.
DO $$
DECLARE historical_reg text;
BEGIN
  IF faa_registry_20261021.resolve_identity('N913KC','ACA2B4')->>'identity_status' <> 'IDENTITY_CONFIRMED' THEN
    RAISE EXCEPTION 'N913KC assigned hex must confirm';
  END IF;
  IF faa_registry_20261021.resolve_identity('N913KC','000000')->>'identity_status' <> 'ICAO_FAA_MISMATCH' THEN
    RAISE EXCEPTION 'Conflicting reported hex must not confirm';
  END IF;
  IF faa_registry_20261021.resolve_identity(NULL,'ACA2B4')->>'identity_status' <> 'HEX_MATCH_ONLY' THEN
    RAISE EXCEPTION 'No registration is only a hex match';
  END IF;
  IF faa_registry_20261021.resolve_identity('N0','000000')->>'identity_status' <> 'PUBLIC_REGISTRY_UNAVAILABLE' THEN
    RAISE EXCEPTION 'Missing public identity is not proof of unregistered aircraft';
  END IF;
  SELECT m.n_number INTO historical_reg FROM public.faa_master m
  WHERE NOT EXISTS (SELECT 1 FROM faa_registry_20261021.master_staging s WHERE s.n_number=m.n_number) LIMIT 1;
  IF historical_reg IS NULL OR faa_registry_20261021.resolve_identity(historical_reg,NULL)->>'identity_status' <> 'HISTORICAL_IDENTITY_ONLY' THEN
    RAISE EXCEPTION 'Retained old identities must not become current release matches';
  END IF;
  IF (SELECT count(*) FROM public.evidence_flight_dump_20260103_unsealed) <> 4188848
    OR (SELECT count(*) FROM public.v_faa_enriched_retained_archive) <> 4188848 THEN
    RAISE EXCEPTION 'Protected archive must retain all 4188848 rows';
  END IF;
END $$;