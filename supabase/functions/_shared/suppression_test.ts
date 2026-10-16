import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifySuppression } from "./suppression.ts";

const KBFL = { lat: 35.4336, lon: -119.0568 };
const t0 = 1_700_000_000_000;

Deno.test("zero altitude at 50 kts or less is not flagged", () => {
  const p = { ts: t0, alt: 0, spd: 50, lat: 35.0, lon: -118.6 };
  assertEquals(classifySuppression(p, [p]).cls, "NOT_SUPPRESSION");
});

Deno.test("away from airports, >50 kts with no altitude is en-route suppression", () => {
  const p = { ts: t0, alt: null, spd: 140, lat: 35.0, lon: -118.6 };
  assertEquals(classifySuppression(p, [p]).cls, "EN_ROUTE_ALTITUDE_SUPPRESSION");
});

Deno.test("at the airport, never stopping and climbing back out is a touch-and-go, not excused", () => {
  const p = { ts: t0, alt: 0, spd: 128, ...KBFL };
  const ctx = [
    { ts: t0 - 60_000, alt: 875, spd: 129, ...KBFL },
    p,
    { ts: t0 + 60_000, alt: 1150, spd: 147, ...KBFL },
  ];
  assertEquals(classifySuppression(p, ctx).cls, "AIRPORT_TOUCH_AND_GO");
});

Deno.test("at the airport, slowing to a stop is a normal landing roll", () => {
  const p = { ts: t0, alt: 0, spd: 70, ...KBFL };
  const ctx = [p, { ts: t0 + 60_000, alt: 0, spd: 5, ...KBFL }];
  assertEquals(classifySuppression(p, ctx).cls, "AIRPORT_LANDING_ROLL");
});
