# Sentinel reasons
- [x] Restore aircraft-specific current and retrieved historical behavioral reasons in reports and exports; explicitly mark original watchlist reasons not retrieved.
- [x] Prevent ownership plus watchlist membership alone from creating a shell threat.
- [x] Verify four rule tests and the signed-in live report flow without changing raw evidence.

# Josiah chat AI gateway errors
- [x] Wire Mistral (user's own key, already saved as MISTRAL_API_KEY) as fallback for Josiah chat and the agent orchestrator, bypassing the workspace credit block.
- [x] Deploy and verify Josiah chat answers end-to-end (live test replied via Mistral).

# Taxonomy and behavioral alignment timeouts
- [x] Diagnose and remove the shared 120-second timeout cause for all four reported actions.
- [x] Keep failed section reads explicit instead of returning false empty results or blanking the page.
- [x] Deploy and verify all four reads and the signed-in page (all returned real data with no page errors; two safeguard tests passed).

# FAA registry refresh and archive enrichment
- [x] Validate the uploaded registry: 316,765 rows but only 202,896 distinct registrations; 113,869 identical repeated rows, no conflicts. SHA-256: 428c651d662fb37dfc33c1bb4a642b3f91cc30df14b97417d0a8530c018cec08. Do not promote this as a complete registry.
- [x] Link and verify the main archive connection (My Neon (2)); confirmed 312,743 FAA master records (catalog estimate), live/unified detections and retained unsealed source.
- [x] Validate replacement ReleasableAircraft.zip: MASTER contains 317,901 unique registrations and unique valid six-digit hex codes; ACFTREF contains 94,134 unique references with every MASTER model code covered. No duplicate keys or malformed row widths. File timestamps and latest registry action are October 21, 2026; this is the publicly releasable registry, not a guarantee of unrestricted FAA coverage.
- [x] Stage both complete files with source hashes and preserve the previous registry before promotion. Verified 317,901 MASTER and 94,134 ACFTREF rows, 83 atomic batch receipts, 312,743 previous MASTER and 93,746 previous ACFTREF rows; zero missing model references. Three importer safety tests pass. Initial malformed JSON batch rolled back with zero rows; corrected serialization and completed import. Exact hashes recorded in additive audit entries, including a correction to an initial transcription error.
- [ ] Refresh FAA identity without deleting absent registrations; distinguish current release matches from historical retained records and withheld/unavailable public identity. Exact promotion statements approved, but Neon rejected the atomic transaction with SQLSTATE 55000: published FAA tables have no replica identity. Confirmed zero promotion receipts. Blocked pending confirmation of ALTER TABLE public.faa_master/public.faa_aircraft_ref REPLICA IDENTITY FULL; 7,440 new registrations and 2,282 historical-only registrations remain staged/preserved.
- [ ] Add non-destructive FAA enrichment for detection tables, including the retained archive source; discover actual table schemas and preserve unmatched detections. The old sealed-named primary-key index belongs to public.evidence_flight_dump_20260103_unsealed, not a separately verified sealed copy; registry promotion confirmation remains pending.
- [ ] Verify enrichment, source fingerprints, retained historical registry, and unchanged original detections after promotion.
