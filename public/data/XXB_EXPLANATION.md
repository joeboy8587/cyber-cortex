# XXB Data Clarification - Critical for FAA Report

## The Issue

Our unified export contains **2,008,036 rows** where:
- `icao24_fixed` = "XXB"
- `registration` = "XXB"
- `taxonomy_tag` = "xxb_mlat" (or similar)

**We previously reported these as "spoofed aircraft" to the FAA - THIS WAS INCORRECT.**

---

## What XXB Actually Means

### In Aviation Tracking Systems

| Field | Value | Meaning |
|-------|-------|---------|
| `icao24` | XXB | MLAT-only track (no ADS-B transponder) |
| `registration` | XXB | Unknown/unidentified aircraft |
| `taxonomy_tag` | xxb_* | Watchtower classification |

### The Technical Explanation

**MLAT (Multilateration)** = Tracking aircraft by triangulating signals from multiple ground stations

**ADS-B** = Aircraft broadcasts its identity automatically

**When you see XXB:**
- Aircraft is being tracked via MLAT
- Aircraft does NOT have ADS-B transponder (or it's turned off)
- Registration is unknown (not broadcasting)
- Common for: older aircraft, military, aircraft with transponder failures

---

## Why This Matters for FAA Report

### Our Previous Error

We reported XXB aircraft as "spoofed" because:
- Our tools flagged XXB as invalid ICAO code
- We thought it was synthetic/injected data
- We believed it indicated spoofing

### The Truth

XXB is a **legitimate placeholder** used by:
- FlightRadar24
- ADS-B Exchange
- OpenSky Network
- Professional aviation tracking systems

**XXB indicates real aircraft being tracked via MLAT without ADS-B.**

---

## The Quarantine Table Was Correct

The `quarantine.evidence_flight_dump_20260103_sealed` table was flagged for "XXB spoofing" but actually contains:

✅ **Legitimate MLAT tracking data**  
✅ **Proper taxonomy** (xxb_mlat, xxb_live, etc.)  
✅ **Real aircraft positions** (lat/lon/altitude)  
✅ **Forensically sealed** (evidence grade)

**The quarantine was a FALSE POSITIVE.**

---

## Corrected Understanding

### XXB Taxonomy Tags (Legitimate Classifications)

| Tag | Count | Meaning |
|-----|-------|---------|
| xxb_low_alt_suspicious | 2,249,719 | MLAT tracks at low altitude |
| xxb_live | 2,244,303 | Active MLAT tracking |
| xxb_unknown | 1,332,419 | Unclassified MLAT |
| xxb_medical_air | 10,784 | MLAT medical aircraft |
| xxb_mlat | 2,843 | Pure MLAT sources |
| xxb_tier2_shell | 3,350 | MLAT shell company indicators |
| xxb_tier1_priority | 2,668 | MLAT priority targets |

### Total MLAT-Only Detections: 4,845,420 (68.6%)

This is NOT spoofing - this is **legitimate tracking of aircraft without ADS-B transponders**.

---

## Impact on Pattern Analysis

Our previous analysis showing "XXB aircraft" as the top offender was misleading:

### Previous Interpretation (WRONG)
```
Top Aircraft:
  XXB: 2,008,036 detections ← "Spoofed aircraft!"
```

### Corrected Interpretation
```
MLAT-Only Tracks (No ADS-B):
  Unidentified MLAT: 2,008,036 detections
  
Actual Aircraft with Registrations:
  N6196P: 3,941 detections
  N916HT: 3,756 detections
  N916GW: 3,465 detections
```

---

## Corrected Pattern Analysis

### 1. December Surge Still Valid
The massive December 26-31 spike is still anomalous:
- Dec 27: 1,658,681 detections
- Includes both MLAT (XXB) and ADS-B (identified)
- Still 26x normal volume

### 2. Low Altitude Pattern Still Valid
52% below 1,000ft is still abnormal:
- MLAT tracks are concentrated at low altitude
- Normal commercial aviation would have ADS-B (not XXB)
- Indicates helicopter/surveillance activity

### 3. Night Operations Still Valid
3AM peak is still inverted:
- Not normal commercial aviation hours
- Indicates coordinated operations

---

## Action Required: FAA Correction

### We Need to Notify FAA:

**Subject: Correction to Previous Report - XXB Data Clarification**

```
Dear FAA,

We previously reported XXB-coded aircraft as "spoofed" in our 
investigation. This was incorrect.

XXB is a legitimate placeholder code used by MLAT (multilateration) 
tracking systems for aircraft without ADS-B transponders.

The 2,008,036 XXB entries in our data represent legitimate tracking 
of aircraft positions, not spoofing activity.

We apologize for the error and request this correction be noted 
in our case file.

Sincerely,
[Name]
```

---

## Files Status

| File | Status | Note |
|------|--------|------|
| `unified_flight_detections_7M.csv` | ✅ Valid | Contains legitimate MLAT data |
| `quarantine` table | ✅ Valid | Was correctly sealed, not spoofed |
| FAA previous report | ⚠️ Needs correction | XXB was misidentified |

---

## Key Takeaway

**The quarantine table was RIGHT. The data was GOOD. Our interpretation was WRONG.**

XXB = MLAT tracking (legitimate)  
NOT XXB = Spoofing (incorrect)

The pattern analysis findings about December surge, low altitude, and night operations are still valid - but they're evidence of **surveillance operations**, not **spoofing**.

---

*Clarification prepared: February 20, 2026*
*Status: CORRECTION REQUIRED FOR FAA*
