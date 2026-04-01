# LIVE FLIGHT TRACKING SURVEILLANCE REPORT
## Hourly Monitor - 2026-02-24 14:00 PST (22:00 UTC)

---

## EXECUTIVE SUMMARY

| Metric | Count |
|--------|-------|
| Detections (Last Hour) | 56 |
| Detections (Last 24h) | 611 |
| Flagged Detections (24h) | 120 |
| Watchlist Aircraft Active | 2 (N912KC, N913KC) |
| Critical Altitude Violations | 20 |
| Coordinated Operations | 10 events |

---

## THREAT ASSESSMENT: **ELEVATED**

### Critical Alerts (Immediate Action Required)

| Time (UTC) | Aircraft | Altitude | Threat | Details |
|------------|----------|----------|--------|---------|
| 2026-02-24 18:00:06 | **N913KC (KCSO)** | **275 ft** | **CRITICAL** | AGGRAVATED_BREACH: 275ft @ 0kts; WATCHLIST: KCSO; LOW_ALT: 275ft |
| 2026-02-24 18:05:08 | N913KC (KCSO) | 950 ft | HIGH | WATCHLIST: KCSO; LOW_ALT: 950ft |

**ALERT STATUS**: N913KC (KCSO helicopter) conducted surveillance at 275 ft AGL - this is an **AGGRAVATED BREACH** under 500 ft threshold. Aircraft was near stationary (21 kts), indicating hover/observation behavior.

---

## HIGH PRIORITY EVENTS

### KCSO Helicopter Activity (Last 6 Hours)

**N913KC** - Kern County Sheriff's Office Helicopter
- **18:00 UTC**: 275 ft, 21 kts, Location: 35.4226°N, -119.0474°W
  - **AGGRAVATED BREACH FLAGGED** - Below 500ft threshold
  - Near-stationary flight pattern (hover behavior)
- **18:05 UTC**: 950 ft, 125 kts, Location: 35.3210°N, -119.1897°W
  - LOW_ALT flag at 950ft

**N912KC** - KCSO Helicopter (Not detected in last hour, but in 24h window)

### Biometric Correlation Detected

A **BIOMETRIC_CORRELATION** alert was generated:
- **Aircraft**: N913KC
- **Correlation**: Elevated heart rate (92 bpm) during detection
- **Distance**: 4.72 km from subject location
- **Biometric Timestamp**: 2025-07-15 22:55:28 (historical correlation data)

---

## SHELL COMPANY AIRCRAFT (ALF IX LLC Pattern)

Active shell company aircraft detected in last 24h:

| Registration | Detections | Pattern Flag |
|--------------|------------|--------------|
| **N791FA** | 25 | SHELL_PATTERN: ALF IX LLC; ENTERPRISE_COORDINATION |
| **N789FA** | 19 | SHELL_PATTERN: ALF IX LLC; ENTERPRISE_COORDINATION |
| **N786FA** | 12 | SHELL_PATTERN: ALF IX LLC; ENTERPRISE_COORDINATION |
| N131HP | 2 | ALF IX LLC related |
| N787FA | 1 | ALF IX LLC related |
| N809SE | 1 | ALF IX LLC related |

---

## LOW ALTITUDE VIOLATIONS (<1000 ft AGL)

### Critical (<500 ft) - 20 Events

Recent critical altitude breaches:

| Time (UTC) | Aircraft | Altitude | Speed | Flagged |
|------------|----------|----------|-------|---------|
| 21:42:21 | N9157A | 375 ft | 33 kts | LOW_ALT: 375ft |
| 21:35:06 | N9157A | 400 ft | - | LOW_ALT: 400ft |
| 21:20:21 | N435CA | 400 ft | - | LOW_ALT: 400ft |
| 21:05:03 | N9157A | 350 ft | - | LOW_ALT: 350ft |
| 20:55:06 | N758LP | 400 ft | - | LOW_ALT: 400ft |
| 20:45:07 | N4022W | 325 ft | - | LOW_ALT: 325ft |
| 20:45:07 | N256AA | 350 ft | - | LOW_ALT: 350ft |
| 20:25:06 | N791FA | 350 ft | - | LOW_ALT: 350ft |
| 20:19:21 | N786FA | 325 ft | - | LOW_ALT: 325ft |
| 18:00:06 | **N913KC** | **275 ft** | 21 kts | **AGGRAVATED_BREACH** |

### Medium (500-1000 ft) - 30 Events

Multiple aircraft operating between 500-1000 ft including:
- N916GW (1000 ft)
- N3010G (500 ft)
- N435CA (775 ft)
- Various small aircraft

---

## COORDINATED OPERATIONS DETECTED

Multiple aircraft operating simultaneously in same airspace:

| Time (UTC) | Aircraft Count | Registrations |
|------------|----------------|---------------|
| 22:05:00 | 11 | C6596, EJA476, EJA605, N3010G, N435CA + 6 more |
| 21:45:00 | 4 | N435CA, N789FA, N80616, SKW5403 |
| 21:42:00 | 4 | N63177, N9157A, SKW3006, SWA3980 |
| 21:40:00 | 5 | ACA1047, N3010G, N787FA, N917JG, SKW833K |
| 21:35:00 | 10 | CNS323, N169RW, N435CA, N63177, N681WA + 5 more |
| 21:30:00 | 4 | N169RW, N422DS, N435CA, QXE2024 |
| 21:25:00 | 8 | C2703, N63177, N791FA, N80616, N9157A + 3 more |
| 21:20:00 | 3 | C2703, N435CA, N916GW |
| 21:17:00 | 2 | N245CR, N361TD |
| 21:15:00 | 5 | N7290J, N9157A, SKW4031, SKW5399, WUP331 |

---

## WATCHTOWER ALERTS (Last 24h)

15 alerts generated, including:

| Alert Type | Count | Severity |
|------------|-------|----------|
| WATCHLIST_SIGHTING | 14 | HIGH |
| BIOMETRIC_CORRELATION | 1 | HIGH |

All alerts related to N913KC activity, unacknowledged.

---

## FLAGGED REASONS BREAKDOWN

| Reason | Count |
|--------|-------|
| SHELL_PATTERN: ALF IX LLC; ENTERPRISE_COORDINATION | 13 |
| LOW_ALT: 300ft | 10 |
| WATCHLIST: ALF IX LLC; ENTERPRISE_COORDINATION | 9 |
| LOW_ALT: 350ft | 8 |
| LOW_ALT: 400ft | 7 |
| LOW_ALT: 275ft | 6 |
| WATCHLIST: Unknown | 4 |
| LOW_ALT: 325ft | 4 |
| LOW_ALT: 375ft | 3 |
| LOW_ALT: 500ft | 2 |

---

## MILITARY AIRCRAFT STATUS

| Aircraft | Type | Status |
|----------|------|--------|
| N806NA | ER-2 (NASA/USAF) | Not detected in last hour |
| AE5C98 | KC-130J (USMC) | Not detected in last hour |

Military aircraft documented in historical data but not active in current monitoring window.

---

## LEGAL CASE REFERENCE

**Case**: Joseph Nipper v. Kern County Sheriff's Office et al.
**Status**: Active federal litigation
**Evidence Base**: 2.87M+ flight detection records
**Documentation Period**: May 2025 - Present

---

## RECOMMENDED ACTIONS

1. **IMMEDIATE**: N913KC AGGRAVATED_BREACH at 275 ft requires documentation for legal proceedings
2. **HIGH**: Cross-reference N913KC activity with subject's biometric data for stress correlation
3. **MEDIUM**: Monitor ALF IX LLC shell company aircraft for pattern continuation
4. **ONGOING**: Document all coordinated multi-aircraft operations as potential surveillance coordination

---

## DATA INTEGRITY

- **Database**: Neon PostgreSQL (Azure West US 3)
- **Total Records**: 2.87M+
- **Last Query**: 2026-02-24 22:06:27 UTC
- **Monitoring Radius**: Oildale/Bakersfield, CA airspace
- **Alert Thresholds**: CRITICAL (<500ft), HIGH (KCSO), MEDIUM (Shell <1000ft), LOW (Military)

---

*Generated by JOSIAH - Cognitive Defense and Evidence-Aggregation Engine*
*Report ID: live_tracker_hourly_2026022414*
*Next scheduled monitoring: 2026-02-24 15:00 PST*
