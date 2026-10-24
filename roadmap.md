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
- [x] Refresh FAA identity after approved replica-identity repair and atomic promotion: 18,680 MASTER updates, 7,440 inserts; 23 reference updates, 388 inserts. Verified 320,183 retained MASTER records, 94,134 references, zero differences from staging, one promotion receipt. The 2,282 historical-only registrations remain retained and distinguished from the current release.
- [x] Add row-preserving read-only FAA enrichment for live, unified, and retained archive detections, including missing registrations, hex-only matches, disagreements, and unavailable public identities. Existing views remain compatible with conservative missing/historical status labels. Current identity includes release provenance; legacy cascading rebuild disabled.
- [x] Verify enrichment and source preservation: archive 4,188,848 rows, live 6,531,770 rows, unified 589,767 rows exactly match their new enriched views. Source hashes/audit receipts preserved; concrete confirmed/mismatch/hex-only/unavailable/historical safeguards passed against real registry. Signed-in N913KC dossier shows October 21 FAA release and confirmed identity; visual check passed after fixing a string-method compatibility error.
- [ ] Verify a separately retained sealed forensic anchor. Blocker: old sealed-named primary-key index belongs to public.evidence_flight_dump_20260103_unsealed; no separate sealed table found in connected catalog. No assertion of identical-copy provenance made.
