# KCSO ownership tag correction
- [ ] Require current FAA registrant confirmation for new KCSO ownership tags; preserve fleet-list associations separately.
- [ ] Remove registration-based ownership shortcuts from network display and schema repair.
- [ ] Show current identity corrections alongside preserved historical flags; verify real four-aircraft results and rule tests.

# FAR and policy scan reliability
- [x] Preserve original sea-level altitude and show separately calculated above-ground height, terrain elevation, and measurement uncertainty in scan findings. Original raw 200 ft and source SHA-256 read back unchanged; saved finding retains terrain 373 ft, pressure correction 171 ft and nominal AGL -2 ±150 ft (a measurement/context review, not literal underground flight).
- [x] Verify FAA altitude-rule applicability and remove unsupported automatic citations. Source-checked 91.119 provisions; endangerment, weather, lights and indicated-airspeed rules require their own evidence. Low-flight reviews stay visible; current FAA category uses registration AND hex in the preserved release.
- [x] Bound and share concurrent ground-height lookups across FAR and policy scans; batch saves and report incomplete sections honestly. Eight terrain workers share a 20-second budget, lowest reported flights first; exact coordinates and one shared METAR read; 200-record saves preserve earlier confirmed batches, with a 100-second request save budget. Slow full-registry view join replaced by bounded indexed release lookup.
- [x] Verify 20 altitude/timeout/save tests plus six raw-preservation regression tests; signed-in FAR returned eight findings and saved six new ones in 24 seconds, after two earlier verified saves. UI read-back shows MSL/terrain/AGL; no horizontal page overflow at 889×634. This remains a partial latest-600 scan: 520 ground heights were unavailable/deferred, never cleared. Policy returned in three seconds with zero documented-fleet observations in the independent raw stream; nonempty policy flow cannot be verified without matching real observations. Historical rescanning and other altitude displays are unchanged.

# Legal analysis and correlation timeout
- [x] Update Legal Analyst and Amy's sharp war-room prompt with routine/cover analysis and explicit retrieval gaps; exclude fixed narrative counts and contaminated flight summaries from their model context.
- [x] Replace the two failing unbounded correlation reads with canonical read-only, provenance-preserving reads; bound all legacy action execution and connection cleanup. Do not treat timeouts or missing scores as zeros.
- [x] Verify seven deadline/result tests and signed-in UI: 41,552 historical links returned in 3.9s, 100 aircraft displayed with saved-score labels, Legal Analyst replied and saved without page errors. Legal-history source reads still report missing relations; they are explicit gaps, not proof of absent history. Prompt adherence improved, but model prose remains variable.

# Home-adaptive live checks
- [x] Use 15-second checks within a 3 km home boundary and 60 seconds otherwise, in both live views; preserve both writers.
- [x] Verify six cadence tests plus six raw-preservation tests; signed-in tracker switched to 15 seconds and completed two paid-feed collections, each saving 18/18 raw observations. Historical display read still reports an existing DB error, but no longer blocks live collections.

# Independent raw live detections
- [x] Create an append-only Neon raw observation table, without copying legacy records.
- [x] Save original provider observations before filtering, identity enrichment, or flagging; retain the existing writer independently.
- [x] Verify both writes on fresh signed-in live collections: raw inserted 1, existing updated 1; read back verified SHA-256 and no added analysis fields. Six preservation/failure-isolation tests pass; tracker displays raw-copy status.

# Legacy flight source isolation
- [ ] Trace whether the Lovable live tracker generates synthetic records or imports provider observations; verify legacy versus canonical source relationships.
- [ ] Remove confirmed contaminated legacy reads from evidence workflows without deleting raw records; verify source safeguards.

# Josiah co-investigator prompt
- [x] Adapt the uploaded voice to both active chats without promising unsupported tools or suppressing evidence gaps.
- [x] Deploy both prompt updates; signed-in main-chat replies read back through the UI. Access limitation was stated, but the model added unsupported explanations/examples; tightened capability instructions. Finding-chat reply not separately exercised.

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
