-- Neon-only migration: apply once through the linked Neon connector.
-- Do not backfill from mixed legacy detections or attach enrichment triggers.
CREATE TABLE public.live_flight_detections_raw (
  id uuid PRIMARY KEY,
  poll_id uuid NOT NULL,
  record_index integer NOT NULL,
  received_at timestamptz NOT NULL,
  data_source text NOT NULL,
  response_metadata jsonb NOT NULL,
  icao_code text,
  registration text,
  callsign text,
  latitude double precision,
  longitude double precision,
  payload_json text NOT NULL,
  payload jsonb GENERATED ALWAYS AS (payload_json::jsonb) STORED,
  sha256_hash text NOT NULL,
  UNIQUE (poll_id, record_index)
);
GRANT SELECT, INSERT ON public.live_flight_detections_raw TO neondb_owner;
ALTER TABLE public.live_flight_detections_raw ENABLE ROW LEVEL SECURITY;
-- No public policies: only the existing owner connection may read/append.
CREATE INDEX live_flight_raw_received_idx ON public.live_flight_detections_raw (received_at DESC, id);
CREATE INDEX live_flight_raw_hex_time_idx ON public.live_flight_detections_raw (icao_code, received_at DESC);
CREATE INDEX live_flight_raw_reg_time_idx ON public.live_flight_detections_raw (registration, received_at DESC);
CREATE FUNCTION public.protect_live_flight_raw() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Raw provider observations are append-only';
  END IF;
  IF NEW.sha256_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.payload_json, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'Raw observation fingerprint does not match payload';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER live_flight_raw_hash_guard BEFORE INSERT ON public.live_flight_detections_raw
FOR EACH ROW EXECUTE FUNCTION public.protect_live_flight_raw();
CREATE TRIGGER live_flight_raw_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.live_flight_detections_raw
FOR EACH STATEMENT EXECUTE FUNCTION public.protect_live_flight_raw();
COMMENT ON TABLE public.live_flight_detections_raw IS 'Append-only original provider JSON observations, captured before filtering or analysis. Receipt time is not observation time. No legacy backfill. SHA-256 fingerprints cover payload_json UTF-8 serialization, not the original HTTP response bytes. All access is via the authenticated server and the Neon owner connector.';