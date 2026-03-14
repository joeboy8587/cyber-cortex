

## Plan: Update RapidAPI Key

The value `6318a4770dmsh7ed486bcdb3109ep1f9d5djsnd9c971c0cd94` is a standard RapidAPI application key (alphanumeric with `msh`/`jsn` patterns typical of RapidAPI keys).

### Steps

1. **Update the `RAPIDAPI_KEY` secret** with the new value using the secrets tool
2. **Test the `opensky-fetch` edge function** to verify the 403 error is resolved and RapidAPI ADS-B Exchange returns live flight data with full enrichment (owner/operator, aircraft type, military status)

### Expected Outcome
- RapidAPI returns 200 instead of 403
- Live flights include rich metadata: `owner_operator`, `aircraft_type`, `is_military`
- Edge function logs show "PRIMARY: Fetching from RapidAPI ADS-B Exchange v2" succeeding

