import { describe, expect, it } from "vitest";
import { NO_DATA_HEX, RAMP } from "@/lib/mapLayers";
import {
  AREA_BY_ID, AREA_LAYERS, SEQ_RAMP, areaHex, areaLegend, formatArea, type AcsAttrs,
} from "@/lib/censusLayers";
import {
  MAX_TILES, dataZoom, levelFor, mergeTiles, parseVintage, tileBounds, tilesFor,
  type AreaFeature,
} from "@/lib/censusTiles";

const BLANK: AcsAttrs = {
  GEOID: "48113", NAME: "Dallas County", State: "Texas", ALAND: null,
  B01001_001E: null, B01002_001E: null, B19049_001E: null, B19049_001M: null,
  B25002_001E: null, B25002_003E: null, B25003_001E: null, B25003_003E: null,
  B25058_001E: null, B25077_001E: null,
};
const at = (patch: Partial<AcsAttrs>): AcsAttrs => ({ ...BLANK, ...patch });

const INCOME = AREA_BY_ID.get("acs_median_income")!;
const GROWTH = AREA_BY_ID.get("acs_pop_growth")!;
const VACANCY = AREA_BY_ID.get("acs_vacancy")!;
const RENT = AREA_BY_ID.get("acs_median_rent")!;
const DENSITY = AREA_BY_ID.get("acs_pop_density")!;

describe("area values", () => {
  it("has no vacancy rate for a tract with no housing units", () => {
    // 0/0 must not become 0%, the tightest market on the map.
    expect(VACANCY.value(at({ B25002_001E: 0, B25002_003E: 0 }), {})).toBeNull();
    expect(VACANCY.value(at({ B25002_001E: 200, B25002_003E: 20 }), {})).toBeCloseTo(10);
  });

  it("has no density without land area", () => {
    expect(DENSITY.value(at({ B01001_001E: 5000, ALAND: 0 }), {})).toBeNull();
    // One square mile of land, 5,000 people.
    expect(DENSITY.value(at({ B01001_001E: 5000, ALAND: 2_589_988.11 }), {})).toBeCloseTo(5000);
  });

  it("annualises growth over the gap between vintages", () => {
    // Dallas County, ACS 2010–14 → 2019–23, as the service returned it.
    const ctx = { baseline: new Map([["48113", 2448943]]), growthYears: 9 };
    expect(GROWTH.value(at({ B01001_001E: 2603816 }), ctx)).toBeCloseTo(0.68, 2);
  });

  it("leaves a county with no baseline grey rather than calling it flat", () => {
    const ctx = { baseline: new Map<string, number>(), growthYears: 9 };
    expect(GROWTH.value(at({ GEOID: "09110", B01001_001E: 900000 }), ctx)).toBeNull();
    // And refuses to divide by a span it was not given.
    expect(GROWTH.value(at({ B01001_001E: 2603816 }), { baseline: new Map([["48113", 2448943]]) })).toBeNull();
  });

  it("reads a null ACS value as no value, never as zero", () => {
    for (const layer of AREA_LAYERS) {
      expect(layer.value(BLANK, { baseline: new Map(), growthYears: 9 })).toBeNull();
    }
  });
});

describe("area colours", () => {
  it("draws no-value grey only for null", () => {
    expect(areaHex(null, INCOME)).toBe(NO_DATA_HEX);
    for (const layer of AREA_LAYERS) {
      for (const v of [-5, 0, 1, 50, 1e6]) expect(areaHex(v, layer)).not.toBe(NO_DATA_HEX);
    }
  });

  it("keeps green as good news: high income green, high vacancy red", () => {
    expect(areaHex(120000, INCOME)).toBe(RAMP[0]);
    expect(areaHex(30000, INCOME)).toBe(RAMP[4]);
    expect(areaHex(25, VACANCY)).toBe(RAMP[4]);
  });

  it("uses the single-hue ramp for layers with no good direction", () => {
    expect(areaHex(500, RENT)).toBe(SEQ_RAMP[0]);
    expect(areaHex(3000, RENT)).toBe(SEQ_RAMP[4]);
  });

  it("legend and map agree for a value inside every band", () => {
    for (const layer of AREA_LAYERS) {
      const [a, b, c, d] = layer.breaks;
      const samples = [a - 1, (a + b) / 2, (b + c) / 2, (c + d) / 2, d + 1];
      const legend = areaLegend(layer);
      samples.forEach((v, i) => expect(areaHex(v, layer)).toBe(legend[i].hex));
    }
  });

  it("prints a top-coded median as a floor", () => {
    expect(formatArea(250001, INCOME)).toBe("$250,000+");
    expect(formatArea(80000, INCOME)).toBe("$80,000");
  });
});

describe("parseVintage", () => {
  it("reads the span from the service's copyright text", () => {
    expect(parseVintage(
      "U.S. Census Bureau's American Community Survey (ACS) 2019-2023 5-year estimates, Table(s) B01001",
    )).toEqual({ start: 2019, end: 2023 });
  });

  it("refuses anything that is not a five-year span", () => {
    expect(parseVintage("ACS 2019-2024 5-year estimates")).toBeNull();
    expect(parseVintage("ACS 2023 1-year estimates")).toBeNull();
    expect(parseVintage("")).toBeNull();
    expect(parseVintage(undefined)).toBeNull();
  });
});

describe("tiling", () => {
  it("draws counties when zoomed out, and always for growth", () => {
    expect(levelFor(5, INCOME)).toBe("county");
    expect(levelFor(9, INCOME)).toBe("tract");
    expect(levelFor(12, GROWTH)).toBe("county");
  });

  it("clamps the data zoom per level", () => {
    expect(dataZoom(2, "county")).toBe(3);
    expect(dataZoom(15, "tract")).toBe(12);
    expect(dataZoom(9.7, "tract")).toBe(9);
  });

  it("covers the bounds it is given", () => {
    const tiles = tilesFor({ west: -97, south: 32.6, east: -96.6, north: 33 }, 10)!;
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      const b = tileBounds(t);
      expect(b.east).toBeGreaterThan(-97);
      expect(b.west).toBeLessThan(-96.6);
      expect(b.north).toBeGreaterThan(32.6);
      expect(b.south).toBeLessThan(33);
    }
  });

  it("clamps a wrapped world instead of asking for tiles that do not exist", () => {
    const tiles = tilesFor({ west: -400, south: -80, east: 400, north: 80 }, 3)!;
    expect(tiles.every((t) => t.x >= 0 && t.x < 8 && t.y >= 0 && t.y < 8)).toBe(true);
  });

  it("refuses a view that needs too many tiles", () => {
    expect(tilesFor({ west: -180, south: -80, east: 180, north: 80 }, 6)).toBeNull();
    expect(MAX_TILES).toBeGreaterThan(0);
  });

  it("keeps an area that two tiles both returned once", () => {
    const f = (geoid: string): AreaFeature => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      properties: at({ GEOID: geoid }),
    });
    expect(mergeTiles([[f("a"), f("b")], [f("b"), f("c")]]).map((x) => x.properties.GEOID))
      .toEqual(["a", "b", "c"]);
  });
});
