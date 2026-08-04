# Satellite Tracker v1.5 — Day/Night Terminator Overlay

Date: 2026-08-04
Status: Approved (pre-implementation)
Depends on: satellite tracker v1.4 (shipped)

## Purpose

Show the day/night terminator on the map: the night hemisphere rendered as a translucent dark overlay, making satellite visibility geometry obvious. Reuses the existing `sun.ts` solar math.

## Implementation

- **New pure module `sat-client/src/sat/terminator.ts`:** `nightPolygon(date, points = 360): [lon, lat][]` — samples the terminator great circle (90° from the subsolar point) via two orthonormal vectors perpendicular to the sun direction; unwraps longitudes (no consecutive jump > 180°, existing groundTrack pattern); orders the sweep so the winding encloses the night pole (anti-subsolar point inside the polygon — verified by an even-odd test, reversed if needed); closes the ring. Deterministic and unit-testable.
- **App:** `night` state (polygon | null) computed immediately on load and refreshed every 60s (small effect, no tick coupling); `showNight` toggle state (default true) + "Day/Night" checkbox in the controls; passes `night={showNight ? polygon : null}` to MapView.
- **MapView:** new required prop `night: [lon, lat][] | null`; effect (styleLoaded-gated, declared after the clusters effect) upserts a `night` GeoJSON source + `night-layer` fill layer (`rgba(2, 6, 23, 0.35)`, no antialiasing) inserted below the satellite layers (`beforeId: "satellites-cluster-layer"`); null → removes the layer.

## Testing

- **terminator.ts (vitest):** polygon is closed; contains the anti-subsolar point and excludes the subsolar point (even-odd); no consecutive longitude jump > 180°; deterministic at a fixed date.
- **MapView (vitest):** night prop → `night-layer` added below satellites; null → removed.
- **App (vitest):** Day/Night checkbox toggles the prop.
- **Visual:** overlay renders as a dark dusk region with a clean terminator curve; toggle works; satellite clusters/dots render above it; no console errors.

## Out of scope

Twilight bands, animated sunset gradients, day/night for the flight tracker, terminator-only mode.
