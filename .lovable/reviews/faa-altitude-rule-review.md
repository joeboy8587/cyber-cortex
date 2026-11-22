# FAA altitude rules and scan scope

Checked against eCFR on 2026-11-22.

- [14 CFR 91.119](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/subject-group-ECFRe4c59b5f5506932/section-91.119): necessary takeoff/landing is an applicability condition, not an automatic airport exemption. Paragraph (b) is 1,000 feet **above the highest obstacle within 2,000 feet horizontally**, not simply terrain AGL; (c) is 500 feet above surface except open water/sparsely populated areas, where 500-foot separation from people, vessels, vehicles or structures applies. Paragraph (d) includes aircraft-specific provisions, including helicopters subject to no surface hazard and any FAA-prescribed routes/altitudes. Low-flight findings remain visible; missing applicability checks are named, not guessed.
- [14 CFR 91.13](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-A/section-91.13): requires careless/reckless operation that endangers life or property. Cannot be added merely because two citations exist.
- [14 CFR 91.117](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/subject-group-ECFRe4c59b5f5506932/section-91.117): uses indicated airspeed, with altitude/airspace and authorization conditions. Ground speed alone cannot establish a speed violation.
- [14 CFR 91.155](https://www.ecfr.gov/current/title-14/section-91.155): requires visibility/cloud-clearance and applicable flight/airspace context. Not inferred from low altitude.
- [14 CFR 91.209](https://www.ecfr.gov/current/title-14/section-91.209): requires lighting evidence and applicable sunset/sunrise context. Nighttime presence alone cannot establish lights were off.

## Altitude calculation

Original pressure-altitude/MSL feed values remain unchanged in the raw stream. Derived scan evidence stores original altitude, terrain elevation, QNH and correction (when a local KBFL observation is available within 90 minutes), AGL, screening uncertainty allowance, source record ID and SHA-256. GNSS altitude is preserved separately but not substituted as MSL without a verified datum/geoid conversion. Screening margins are not certified error bounds. A single Bakersfield ground elevation is not applied across the county.

Exact-coordinate terrain lookups use eight workers, four-second per-request timeouts and a shared twenty-second lookup budget. Missing or deferred terrain remains unknown, never a false zero or an all-clear. METAR retrieval is shared across the batch. Saving is in 200-record batches with a shared request deadline; confirmed earlier batches remain saved after a later failure.

## Source and scope

Both updated scans read only the independent `public.live_flight_detections_raw` stream, using a bounded read-only connector transaction, and never backfill, modify or delete original observations or existing findings. Policy selection uses documented `kcso_fleet` registrations, not callsign ownership guesses. Each scan reports its receipt-time lookback, latest-observation cap (600), incomplete terrain and save errors. This is a bounded recent scan, not an archive-wide rescan. New records are source-labeled operational altitude/policy reviews, not automatically confirmed violations; CAD/manifest, obstacle, weather, lighting, mission and identity gaps remain explicit. Routine and cover checks remain side by side.
