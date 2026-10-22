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
- [ ] Refresh FAA identity using a complete validated FAA MASTER + ACFTREF snapshot. Blocked: uploaded CSV repeats rows and lacks complete registry coverage; aircraft-reference snapshot not uploaded.
- [ ] Add non-destructive FAA enrichment for detection tables, including the retained sealed-archive source. Blocked: complete registry validation above; no source rows or existing views changed.
- [ ] Verify enrichment and provenance after the complete registry is available.
