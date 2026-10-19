import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyFlight, classifyPolicyFlag, type Context, type FlightInput } from "./training_rules.ts";

const ctx = (): Context => ({
  watchlist: new Set(["N913KC"]), provenSubjects: new Set(), unsourcedHex: new Set(["A0B312"]), faaMatched: new Set(["N913KC"]),
});
const base: FlightInput = { icao: "ACA2B4", registration: "N913KC", callsign: null, ts: "2026-08-13T19:38:00Z",
  altitude: 800, speed: 60, on_ground: false, taxonomy_tag: null, sameTimestampCount: 1 };

Deno.test("damaged import: 50+ rows at the same timestamp is excluded", () => {
  assertEquals(classifyFlight({ ...base, sameTimestampCount: 50 }, ctx()).reason_code, "DAMAGED_IMPORT_SAME_TIMESTAMP");
});
Deno.test("damaged import: column name stored as value is excluded", () => {
  assertEquals(classifyFlight({ ...base, icao: "icao24" }, ctx()).label, "exclude");
});
Deno.test("unsourced code A0B312 is excluded", () => {
  assertEquals(classifyFlight({ ...base, icao: "A0B312", registration: null }, ctx()).reason_code, "UNSOURCED_TEST_CODE");
});
Deno.test("watchlist airframe is never labeled normal, even as normal_traffic on the ground", () => {
  const c = ctx(); c.faaMatched.clear();
  const d = classifyFlight({ ...base, taxonomy_tag: "normal_traffic", on_ground: true, speed: 5 }, c);
  assertEquals(d.label, "unsorted");
});
Deno.test("XXB code is not excluded just for being XXB", () => {
  const d = classifyFlight({ ...base, icao: "XXB123", registration: null, taxonomy_tag: "normal_traffic" }, ctx());
  assertEquals(d.label, "normal");
});
Deno.test("pre-AGL altitude flag is excluded; AGL-corrected one is kept", () => {
  assertEquals(classifyPolicyFlag({ rule_code: "B-401", evidence: {}, altitude_ft: 1100 }).label, "exclude");
  assertEquals(classifyPolicyFlag({ rule_code: "B-401", evidence: { agl: 510 }, altitude_ft: 1100 }).label, "unsorted");
});
