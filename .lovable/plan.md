

# Upgrade Josiah Sentinel: Adaptive Learning and Autonomous Countermeasures

## Overview

Transform Josiah Sentinel from a pattern-detection system into an adaptive AI that learns from its own scan history, automatically escalates threat classifications, and generates proactive countermeasure recommendations -- making Watchtower a forward-looking defense system rather than a reactive alert feed.

## What Changes

### 1. New Database Table: `sentinel_learned_threats`

A persistent memory store so Sentinel retains knowledge across scans instead of starting fresh each time.

Columns:
- `id` (uuid, primary key)
- `registration` (text) -- aircraft tail number
- `threat_type` (text) -- e.g. LOW_ALTITUDE, SHELL_COMPANY, REPEAT_OFFENDER
- `total_violations` (int) -- cumulative count across all scans
- `escalation_level` (int, default 1) -- auto-increments as violations accumulate
- `first_seen` (timestamptz)
- `last_seen` (timestamptz)
- `avg_altitude` (numeric)
- `countermeasure_status` (text) -- NONE, RECOMMENDED, FILED, ACTIVE
- `countermeasure_actions` (jsonb) -- log of recommended/taken actions
- `ai_threat_profile` (text) -- AI-generated summary of this aircraft's behavior
- `updated_at` (timestamptz)

### 2. Upgrade `josiah-sentinel` Edge Function

Add three new capabilities after the existing scan logic:

**A. Threat Memory Update** -- After each scan, upsert every violating aircraft into `sentinel_learned_threats`. Increment `total_violations`, update `last_seen`, and auto-escalate `escalation_level` when thresholds are crossed (e.g., 10 violations = level 2, 50 = level 3, 100 = level 4).

**B. Adaptive Threshold Adjustment** -- For aircraft at escalation level 3+, lower detection thresholds automatically (e.g., altitude threshold goes from 2000ft to 3000ft for known offenders, convergence minimum drops from 3 to 2 aircraft if shell company assets are involved).

**C. AI Countermeasure Generation** -- After the existing AI synthesis step, make a second AI call specifically asking for countermeasure recommendations based on the escalation level and violation history. Store these in `countermeasure_actions` and return them in the report.

The report gains two new fields:
- `adaptive_thresholds` -- shows which thresholds were dynamically adjusted and why
- `countermeasures` -- array of recommended actions (e.g., "File FAA complaint for N791FA - 435 low-altitude violations", "Request ADS-B audit for 4 invisible KCSO aircraft")

### 3. Upgrade Sentinel UI Component

Add a new **Countermeasures** tab alongside the existing Violations, Patterns, Synthesis, and History tabs.

Content:
- List of AI-generated countermeasure recommendations with priority badges
- Escalation level indicators per aircraft (visual scale 1-5)
- "Mark as Filed" / "Mark as Active" buttons to track countermeasure status
- Adaptive threshold display showing which thresholds Sentinel auto-adjusted

Update the **Learned Patterns** tab to show escalation history and cumulative violation counts from the persistent store.

### 4. Feed Countermeasures into Watchtower

Update `WatchtowerAlertsHub` to display countermeasure alerts from Sentinel as a new alert type (`countermeasure`) with a distinct visual style, so proactive recommendations appear alongside reactive detections.

## Technical Details

### Database Migration

```sql
CREATE TABLE sentinel_learned_threats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration text NOT NULL,
  threat_type text NOT NULL,
  total_violations int DEFAULT 1,
  escalation_level int DEFAULT 1,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now(),
  avg_altitude numeric,
  countermeasure_status text DEFAULT 'NONE',
  countermeasure_actions jsonb DEFAULT '[]',
  ai_threat_profile text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(registration, threat_type)
);
```

RLS policies restricting to investigator/admin roles (matching existing patterns).

### Edge Function Changes (josiah-sentinel)

After the existing violation detection (steps 1-8), add:

```text
Step 9.5: THREAT MEMORY UPDATE
  - For each violation, upsert into sentinel_learned_threats via Neon
  - Calculate new escalation_level based on total_violations
  - If escalation crossed a threshold, add to proactive_alerts

Step 9.6: ADAPTIVE THRESHOLDS
  - Query sentinel_learned_threats for level 3+ aircraft
  - Widen detection radius for known offenders
  - Add "ADAPTIVE_ESCALATION" violation type for newly escalated threats

Step 9.7: AI COUNTERMEASURE GENERATION
  - Second AI call with escalation context
  - Generate specific legal/administrative actions
  - Store in countermeasure_actions jsonb
```

### UI Component Updates

- `JosiahSentinelMonitor.tsx`: Add 5th tab "Countermeasures", update report interface, display escalation badges
- `WatchtowerAlertsHub.tsx`: Add `countermeasure` alert type with shield icon and green styling

## Sequence

1. Create `sentinel_learned_threats` table with RLS
2. Update `josiah-sentinel` edge function with memory, adaptation, and countermeasure logic
3. Update `JosiahSentinelMonitor.tsx` with Countermeasures tab and escalation display
4. Update `WatchtowerAlertsHub.tsx` to surface countermeasure alerts
5. Deploy and test end-to-end

