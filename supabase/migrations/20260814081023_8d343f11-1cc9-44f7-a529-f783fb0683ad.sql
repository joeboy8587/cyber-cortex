DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'watchtower_autonomous_flags'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.watchtower_autonomous_flags';
  END IF;
END $$;
ALTER TABLE public.watchtower_autonomous_flags REPLICA IDENTITY FULL;