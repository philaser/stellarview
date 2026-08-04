import { describe, it, expect } from "vitest";
import { classifyRegime, classifyConstellation, annotate } from "../src/sat/catalog";
import { parseTleBlock } from "../src/sat/tle";

// CURRENT TLEs from CelesTrak (fetched 2026-08-04)
const ISS_BLOCK = `ISS (ZARYA)
1 25544U 98067A   26215.79638706  .00007444  00000+0  14146-3 0  9999
2 25544  51.6316  64.4821 0007224   9.2337 350.8783 15.49332738579132`;

const GPS_BLOCK = `NAVSTAR 43 (USA 132)
1 24876U 97035A   26215.56685980 -.00000002  00000+0  00000+0 0  9995
2 24876  56.0194  96.7224 0104596  57.9721 303.1158  2.00564025212909`;

const GOES_BLOCK = `GOES 16
1 41866U 16071A   26215.85468562 -.00000082  00000+0  00000+0 0  9999
2 41866   0.4487  85.2768 0001085 105.6447 324.4846  1.00271010 35581`;

describe("classifyRegime", () => {
  it("classifies real satellites by orbital period", () => {
    const [leo] = parseTleBlock(ISS_BLOCK);
    const [meo] = parseTleBlock(GPS_BLOCK);
    const [geo] = parseTleBlock(GOES_BLOCK);
    expect(classifyRegime(leo.periodS)).toBe("leo");
    expect(classifyRegime(meo.periodS)).toBe("meo");
    expect(classifyRegime(geo.periodS)).toBe("geo");
  });

  it("applies the exact LEO/MEO boundary at 128 min and MEO/GEO at 1000 min", () => {
    expect(classifyRegime(128 * 60 - 1)).toBe("leo");
    expect(classifyRegime(128 * 60)).toBe("meo");
    expect(classifyRegime(1000 * 60 - 1)).toBe("meo");
    expect(classifyRegime(1000 * 60)).toBe("geo");
  });
});

describe("classifyConstellation", () => {
  it("maps known prefixes and defaults to other", () => {
    expect(classifyConstellation("STARLINK-1008")).toBe("starlink");
    expect(classifyConstellation("ONEWEB-0001")).toBe("oneweb");
    expect(classifyConstellation("GPS BIIR-1")).toBe("gps");
    expect(classifyConstellation("NAVSTAR 82")).toBe("gps");
    expect(classifyConstellation("IRIDIUM 33")).toBe("iridium");
    expect(classifyConstellation("NOAA 18")).toBe("other");
    expect(classifyConstellation("ISS (ZARYA)")).toBe("other");
  });
});

describe("annotate", () => {
  it("adds regime and constellation to a parsed satellite", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const cat = annotate(iss);
    expect(cat.regime).toBe("leo");
    expect(cat.constellation).toBe("other");
    expect(cat.name).toBe(iss.name);
    expect(cat.catnr).toBe(iss.catnr);
  });
});
