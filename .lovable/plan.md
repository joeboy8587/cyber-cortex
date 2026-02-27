

# Unmask HQ System

## What It Does

An autonomous system that locks onto threat aircraft flagged by the Autonomous Watchtower and tracks their movement endpoints over time. By analyzing where aircraft repeatedly descend to low altitude and low speed (landing behavior), it clusters those GPS coordinates to reveal probable base locations, hangars, and operational headquarters.

## How It Works

1. **Target Acquisition**: Pulls all aircraft with active flags from `watchtower_autonomous_flags` and `sentinel_learned_threats` -- no hardcoded lists, purely data-driven
2. **Landing Point Detection**: Queries `live_flight_detections_rows` for each target aircraft looking for landing signatures:
   - Altitude below 500ft and descending
   - Speed below 60 knots
   - Sequential detections showing descent pattern
3. **GPS Clustering**: Groups nearby landing points (within 500m radius) using haversine distance to identify repeated destinations vs. one-off flyovers
4. **HQ Scoring**: Ranks each cluster by:
   - Visit frequency (more landings = higher score)
   - Time span (consistent use over weeks/months)
   - Night operations (landing at unusual hours)
   - Multi-aircraft convergence (multiple threat aircraft using same location)
5. **Cross-Reference**: Enriches each cluster with FAA airport database proximity, known shell company addresses from `shell_companies`, and KCSO fleet base locations
6. **Map Visualization**: Displays unmasked HQ locations on a dark-theme Leaflet map with heat intensity rings, linked aircraft trails, and timeline of visits

## Components

### 1. Backend Function: `unmask-hq`
New edge function that:
- Queries target aircraft from watchtower flags and sentinel threats
- Pulls all low-altitude/low-speed detections for those aircraft
- Runs haversine clustering algorithm to group landing coordinates
- Scores each cluster as potential HQ/base
- Cross-references with shell company addresses and known airports
- Uses AI synthesis to assess findings and reduce false positives
- Persists results to a new `unmasked_hq_locations` table

### 2. Database Table: `unmasked_hq_locations`
Stores discovered base locations with:
- `cluster_center_lat/lng` -- averaged GPS center of the landing cluster
- `visit_count` -- number of landing events at this location
- `unique_aircraft` -- distinct registrations that landed there
- `aircraft_list` -- JSON array of registrations
- `first_visit / last_visit` -- temporal span
- `hq_confidence_score` -- 0-100 composite score
- `location_type` -- AI-classified (private_airstrip, commercial_airport, helipad, unknown_facility)
- `cross_references` -- links to shell companies, KCSO fleet, etc.
- RLS policies for investigator/admin access

### 3. Frontend Component: `UnmaskHQSystem.tsx`
Dashboard panel with:
- **Map View**: Leaflet map showing clustered landing zones as heat circles, color-coded by confidence score, with aircraft trail lines
- **HQ Table**: Ranked list of discovered locations with visit counts, aircraft lists, confidence scores, and cross-reference badges
- **Aircraft Drill-Down**: Click a location to see which aircraft land there and when
- **Timeline**: Shows visit patterns over time for each location
- Integrated into the Surveillance Hub page

### 4. Handler Addition: `neon-query`
New `getUnmaskHQData` action in handlers.ts for the frontend to query landing pattern data directly for the map visualization

## Technical Details

**Landing Detection SQL Pattern:**
```text
SELECT registration, latitude, longitude, altitude, speed, detection_timestamp
FROM live_flight_detections_rows
WHERE registration IN (target_list)
  AND altitude < 500 AND altitude > 0
  AND speed < 60
  AND latitude IS NOT NULL AND longitude IS NOT NULL
ORDER BY registration, detection_timestamp
```

**Haversine Clustering (in edge function):**
- For each aircraft's landing points, calculate pairwise distances
- Merge points within 500m into clusters
- Score clusters by visit frequency, time span, and multi-aircraft overlap

**HQ Confidence Scoring:**
- Base: 20 points per unique visit (capped at 60)
- +15 if multiple threat aircraft use same location
- +10 if visits span 30+ days
- +10 if night operations detected (22:00-05:00 local)
- +5 if near known shell company address
- Normalized to 0-100

## Integration Points
- Feeds from Autonomous Watchtower flags (bias-free target selection)
- Cross-references sentinel_learned_threats for escalation context
- Links to shell_companies table for ownership correlation
- Results visible on Surveillance Hub alongside existing watchtower panel

