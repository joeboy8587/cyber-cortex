CREATE OR REPLACE FUNCTION public.learning_monthly_counts(months_back integer DEFAULT 18)
RETURNS TABLE (
  month date,
  threats bigint,
  flags bigint,
  documents bigint,
  extractions bigint,
  case_files bigint,
  violations bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH months AS (
    SELECT generate_series(
      date_trunc('month', now()) - ((GREATEST(months_back,1) - 1) || ' months')::interval,
      date_trunc('month', now()),
      interval '1 month'
    )::date AS m
  )
  SELECT
    months.m,
    (SELECT count(*) FROM public.sentinel_learned_threats t
       WHERE date_trunc('month', COALESCE(t.first_seen, t.updated_at))::date = months.m),
    (SELECT count(*) FROM public.watchtower_autonomous_flags f
       WHERE date_trunc('month', f.created_at)::date = months.m),
    (SELECT count(*) FROM public.rag_documents d
       WHERE date_trunc('month', d.created_at)::date = months.m),
    (SELECT count(*) FROM public.rag_extractions e
       WHERE date_trunc('month', e.created_at)::date = months.m),
    (SELECT count(*) FROM public.agent_case_files c
       WHERE date_trunc('month', c.created_at)::date = months.m),
    (SELECT count(*) FROM public.policy_violations v
       WHERE date_trunc('month', v.created_at)::date = months.m)
  FROM months
  ORDER BY months.m;
$$;

GRANT EXECUTE ON FUNCTION public.learning_monthly_counts(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.learning_monthly_counts(integer) TO service_role;