# Sentinel reasons
- [x] Restore aircraft-specific current and retrieved historical behavioral reasons in reports and exports; explicitly mark original watchlist reasons not retrieved.
- [x] Prevent ownership plus watchlist membership alone from creating a shell threat.
- [x] Verify four rule tests and the signed-in live report flow without changing raw evidence.

# Josiah chat AI gateway errors
- [x] Wire Mistral (user's own key, already saved as MISTRAL_API_KEY) as fallback for Josiah chat and the agent orchestrator, bypassing the workspace credit block.
- [x] Deploy and verify Josiah chat answers end-to-end (live test replied via Mistral).

# Taxonomy and behavioral alignment timeouts
- [ ] Diagnose and remove the shared 120-second timeout cause for all four reported actions.
- [ ] Keep failed section reads explicit instead of returning false empty results or blanking the page.
- [ ] Deploy and verify all four reads and the signed-in page.
