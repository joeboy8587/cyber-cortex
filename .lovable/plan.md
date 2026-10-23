# Enable FAA registry change tracking

The exact registry update was approved, but Neon rejected it before any changes committed. Both existing FAA tables participate in a replication publication yet lack a primary key or usable replica identity. The promotion receipt is absent, confirming rollback.

## Required non-destructive repair
Approve these exact settings changes in the connected main Neon database:

```sql
ALTER TABLE public.faa_master REPLICA IDENTITY FULL;
ALTER TABLE public.faa_aircraft_ref REPLICA IDENTITY FULL;
```

This tells Neon to include the previous full row when publishing changes. It does not modify or delete any registry or detection rows and leaves replication enabled. It may increase the amount of change-tracking data sent during updates.

After this repair, run the already approved registry promotion once, verify its transaction receipt and the preserved previous registry, then complete the read-only enrichment and historical/current identity safeguards. Original detections remain unchanged; the separate sealed copy remains unverified.