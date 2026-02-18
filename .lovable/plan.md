
# Fix Simulation Page Map Crash

## Root Cause Analysis

There are **three compounding bugs** causing the `/simulation` page to crash:

### Bug 1: `MapFallback` Used Before Declaration (ReferenceError)

In `IncidentSimulator.tsx`, the `Suspense fallback` references `MapFallback` at **line 447**, but `MapFallback` is declared as a `const` at **line 359** — which is *after* the `return (...)` statement. In JavaScript, `const` and `let` are not hoisted, so when React evaluates the JSX return block, `MapFallback` is in the temporal dead zone and throws a `ReferenceError`.

**Fix:** Move the `MapFallback` const to the top of the component function body (before the `return`), or inline the fallback JSX directly into `<Suspense fallback={...}>`.

### Bug 2: `react-leaflet` Marker + `L.divIcon` Crash After Bundling

The project memory explicitly documents this pattern:

> "bundling/minification crashes ('s is not a function') when rendering large Leaflet-based datasets"

`SimulationMapView.tsx` uses `react-leaflet`'s `<Marker>` component with a custom `L.divIcon` created inline. When this module is lazy-loaded and minified, the `react-leaflet` internal render functions lose their references (`render2 is not a function`).

The **stable pattern already used in this project** (from `AircraftMapContent.tsx`) is: use **imperative Leaflet** (`L.map`, `L.circleMarker`, `useRef`) instead of the `react-leaflet` component API. This is what the architecture memory specifically calls out.

**Fix:** Rewrite `SimulationMapView.tsx` to use the imperative Leaflet approach with `useRef` and `L.circleMarker` (matching `AircraftMapContent.tsx`), removing all `react-leaflet` components (`MapContainer`, `TileLayer`, `Marker`, `Popup`, `Circle`, `useMap`).

### Bug 3: Named vs Default Export in Lazy Import

`IncidentSimulator.tsx` does:
```ts
const SimulationMapView = lazy(() => import("./simulation/SimulationMapView"));
```

`SimulationMapView.tsx` exports **both** a named export and a default export. The `lazy()` call correctly picks up the default export, but the named export `export function SimulationMapView` is also exported, which can cause module resolution confusion in some bundler configurations. The fix is to remove the named export and keep only the default export.

---

## Files to Modify

### 1. `src/components/dashboard/simulation/SimulationMapView.tsx` — Full Rewrite

Replace all `react-leaflet` component usage with the **imperative Leaflet** pattern from `AircraftMapContent.tsx`:

- Remove: `MapContainer`, `TileLayer`, `Marker`, `Popup`, `Circle`, `useMap` from `react-leaflet`
- Add: `useRef`, `L.map`, `L.tileLayer`, `L.circleMarker`, `L.circle` from `leaflet`
- Use two `useEffect` hooks — one to initialize the map (with cleanup), one to update markers on `visibleFlights` change
- Keep the `ready` state delay (150ms) as the memory pattern requires it
- Keep the `FlightEvent` interface export (needed by `IncidentSimulator.tsx`)
- Remove named export of the component function, keep only `export default`
- Draw the target location using `L.circle` imperatively instead of `<Circle>`
- Render aircraft as `L.circleMarker` with threat-level colors instead of `<Marker>` with `L.divIcon` (eliminates the icon crash)
- Bind `bindPopup` with HTML string for aircraft details (same as `AircraftMapContent.tsx` pattern)

### 2. `src/components/dashboard/IncidentSimulator.tsx` — Two targeted fixes

**Fix A:** Move `MapFallback` declaration to before the `return` statement (currently it's after at line 359 — move it to around line 295, before the `return`).

**Fix B:** Change the `Suspense fallback` to inline JSX to avoid the reference issue entirely:
```tsx
<Suspense fallback={
  <div className="h-full flex items-center justify-center bg-muted/20">
    <div className="text-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">Loading map...</p>
    </div>
  </div>
}>
```

---

## Implementation Detail: New SimulationMapView Pattern

```text
useRef(mapContainer)  ← div element reference
useRef(mapInstance)   ← L.Map instance
useRef(markers[])     ← L.CircleMarker array
useRef(targetCircle)  ← L.Circle for the red target ring

useEffect #1 (init):
  - Check mapContainerRef.current exists and mapRef.current is null
  - Create L.map(container, { center: mapCenter, zoom: 11 })
  - Add dark CartoDB tile layer
  - Add target circle (L.circle at mapCenter, radius 500, red dashed)
  - Set mapRef.current = map
  - Return cleanup: map.remove(), mapRef.current = null

useEffect #2 (update markers, depends on [visibleFlights]):
  - Guard: if !mapRef.current return
  - Clear: markersRef.current.forEach(m => m.remove()), reset array
  - Filter valid lat/lng
  - For each flight: L.circleMarker with threat color + radius
  - bindPopup(HTML string with registration, altitude, speed, threat level)
  - Push to markersRef.current
```

This exactly mirrors `AircraftMapContent.tsx` which already works stably in the project.

---

## What This Does NOT Change

- The `IncidentSimulator.tsx` data loading logic (Neon queries, biometric processing, AI analysis) — untouched
- The timeline scrubber, playback controls, alert panels — untouched
- The `FlightEvent` interface — kept, still exported from `SimulationMapView.tsx`
- The lazy import pattern — kept (still uses `React.lazy`)
- The 150ms `ready` state delay — kept (required by architecture memory)
