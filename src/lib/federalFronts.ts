// Documented federal aerial-surveillance front companies.
// Sources: AP (2015), BuzzFeed News "Spies in the Skies" (2016/2017),
// The Intercept (Alazhari discovery, 2021), CJR, Detroit News, Willamette Week.
// Registry cities cluster in Bristow/Manassas VA (FBI), Fort Worth/Grapevine TX (DEA),
// and UPS Store / mail-drop addresses (USMS, DHS).

export interface FrontCompany {
  name: string;
  agency: "FBI" | "DEA" | "USMS" | "DHS" | "CBP" | "ANG";
  city: string;
  note: string;
}

export const FEDERAL_FRONTS: FrontCompany[] = [
  { name: "FVX RESEARCH", agency: "FBI", city: "Bristow / Manassas VA", note: "One of AP's original 13" },
  { name: "KQM AVIATION", agency: "FBI", city: "Bristow / Manassas VA", note: "Aircraft used in 24-day Alazhari surveillance" },
  { name: "NBR AVIATION", agency: "FBI", city: "Bristow VA", note: "AP original 13" },
  { name: "PXW SERVICES", agency: "FBI", city: "Bristow / Greenville DE", note: "Found by RTL-SDR squawk sweep (4414/4415)" },
  { name: "NG RESEARCH", agency: "FBI", city: "Bristow / Manassas VA", note: "AP + BuzzFeed confirmed" },
  { name: "OBR LEASING", agency: "FBI", city: "Bristow / Manassas VA", note: "BuzzFeed suspect list" },
  { name: "OTV LEASING", agency: "FBI", city: "Bristow / Greenville DE", note: "Cessna that circled Dearborn MI, 2015" },
  { name: "NBY PRODUCTIONS", agency: "FBI", city: "Bristow / Manassas VA", note: "Fleet refreshed post-2015 (2021 Cessna 182T)" },
  { name: "PSL SURVEYS", agency: "FBI", city: "Bristow / Greenville DE", note: "Named in Alazhari discovery" },
  { name: "RKT PRODUCTIONS", agency: "FBI", city: "Bristow / Manassas VA", note: "Owned N404KR, flown over CA post-San Bernardino" },
  { name: "AEROGRAPHICS", agency: "FBI", city: "Bristow VA", note: "Traced by Wiseman's LA orbit logs" },
  { name: "NATIONAL AIRCRAFT LEASING", agency: "FBI", city: "Greenville DE (UPS Store)", note: "Citation jet w/ Wescam MX-20; circled BLM protests 2020" },
  { name: "SILVER CREEK AVIATION SERVICES", agency: "DEA", city: "Fort Worth TX", note: "Caught by BuzzFeed random-forest classifier" },
  { name: "CHAPARRAL AIR GROUP", agency: "DEA", city: "Grapevine TX", note: "Second DEA front caught by the classifier" },
  { name: "EARLY DETECTION ALARM SYSTEMS", agency: "USMS", city: "Spring TX (UPS Store)", note: "N1789M — Portland protests 2020, cartel hunts in Mexico" },
  { name: "GLOBAL GEO MAPPING", agency: "CBP", city: "Albuquerque NM (Kirtland AFB)", note: "FAA contact phone was a movie-prop number" },
  { name: "MIDWEST AERIAL IMAGING", agency: "DHS", city: "—", note: "Helicopters over Chicago/Detroit; RNC 2016" },
  { name: "AIR CERBERUS", agency: "ANG", city: "—", note: "RC-26 fleet; registrations canceled 2017" },
];

// Postgres regex used to match faa_master.name against the front list.
export const FRONT_REGEX = FEDERAL_FRONTS.map((f) => f.name).join("|");

export const AGENCY_FOR = (registrant: string): FrontCompany | undefined =>
  FEDERAL_FRONTS.find((f) => registrant.toUpperCase().includes(f.name));

// Behavioral tradecraft signatures documented by community trackers (Wiseman, 2015).
export const FRONT_SQUAWKS = ["4414", "4415"];
export const FRONT_CALLSIGN_REGEX = "^(JENNA|JENA|ROSS)";

// Confirmed present in the Watchtower detection archive (verified 2026-09-01).
export const CONFIRMED_FRONT_TAILS = ["N125AL", "N484JB", "N795DH"];
