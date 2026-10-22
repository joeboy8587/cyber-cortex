# FAA registry refresh and protected archive enrichment

## Validated package
- The uploaded FAA package contains **317,901 unique aircraft registrations** and **94,134 unique aircraft references**.
- No duplicate registration/model keys, malformed rows, missing Mode-S hex codes, or unmatched aircraft model codes were found.
- Package file timestamps and the latest registry action date are **October 21, 2026**. The documentation describes this as the publicly releasable FAA registry; some identities can be withheld. A missing match must not automatically mean an unregistered aircraft or spoofing.

## What will change
1. Import MASTER and ACFTREF into separate dated staging tables in the connected main Neon database, with file fingerprints and validation results.
2. Preserve complete copies of the existing FAA master and aircraft-reference tables before changing their current records.
3. Update matching current registry entries and insert new ones only after staging counts and fingerprints pass validation. Keep registrations absent from the new release as historical records, explicitly distinguished from current-release matches.
4. Add read-only enrichment for the live, unified, and retained archive detections. Keep every original detection, including rows without a registration; use registration and hex matching with explicit disagreement and missing-source states.
5. Keep current registry identity separate from ownership at the time of an older detection. Current ownership alone does not establish historical ownership, watchlist justification, or a violation.

## Archive location check
The connected database contains `public.evidence_flight_dump_20260103_unsealed` (approximately 4.19 million rows by catalog estimate). The previously named `quarantine.evidence_flight_dump_20260103_sealed` was **not found** in the catalog read. Verify the original forensic anchor's location before claiming sealed-source enrichment; do not recreate it or represent the unsealed table as a verified identical copy.

## Technical safeguards
- All Neon access goes through the linked connector gateway; bounded parameterized import batches, no direct database credentials.
- Record source SHA-256 hashes and import progress; stop on failures, never automatically repeat uncertain writes.
- Backups and promotion occur in a transaction; no DROP, TRUNCATE, DELETE, or cascading view removal.
- Discover source fields and dependencies before creating or replacing views; preserve existing view columns and dependent consumers.
- Confirm the exact qualified UPDATE statements before executing promotion, as required by the Neon connector.
- Add tests for withheld/missing identity, conflicting registration/hex, historical-only registry entries, and unchanged source-row coverage.

## Completion checks
Verify staging counts of **317,901 MASTER** and **94,134 ACFTREF** rows; verify saved previous registry snapshots; compare source detection counts before/after; check representative current, historical, missing-registration, and conflicting-identity results through the app.

No original detection records will be edited or deleted. Registry promotion and sealed-source enrichment are not yet performed.