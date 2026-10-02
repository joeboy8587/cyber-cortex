CREATE TABLE public.data_map_census (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at timestamptz NOT NULL DEFAULT now(),
  table_count integer NOT NULL,
  total_rows bigint NOT NULL,
  total_bytes bigint NOT NULL,
  empty_tables integer NOT NULL,
  by_category jsonb NOT NULL DEFAULT '{}'::jsonb,
  tables jsonb NOT NULL DEFAULT '[]'::jsonb,
  sha256_hash text NOT NULL
);
GRANT SELECT ON public.data_map_census TO anon, authenticated;
GRANT ALL ON public.data_map_census TO service_role;
ALTER TABLE public.data_map_census ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read census" ON public.data_map_census FOR SELECT USING (true);