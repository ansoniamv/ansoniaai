import { describe, expect, it } from "vitest";
import {
  GRADED_LAYERS, NO_DATA_HEX, RAMP, bandHex, bandIndex, legendBands,
} from "@/lib/mapLayers";

const UC = GRADED_LAYERS.find((l) => l.id === "uc_pct")!;            // lower is better
const INCOME = GRADED_LAYERS.find((l) => l.id === "median_income")!; // higher is better

describe("bandIndex", () => {
  it("puts a value below the first break in band 0 and above the last in band 4", () => {
    expect(bandIndex(0, UC.breaks)).toBe(0);
    expect(bandIndex(0.5, UC.breaks)).toBe(4);
  });

  it("treats a break as the floor of its band, not the ceiling", () => {
    // 2% is "2–4%", not "<2%". Without this a deal sitting exactly on a
    // threshold would be graded one band kinder than the legend claims.
    expect(bandIndex(0.0199, UC.breaks)).toBe(0);
    expect(bandIndex(0.02, UC.breaks)).toBe(1);
  });
});

describe("bandHex", () => {
  it("colours a low value green when lower is better", () => {
    expect(bandHex(0.005, UC)).toBe(RAMP[0]);
    expect(bandHex(0.12, UC)).toBe(RAMP[4]);
  });

  it("flips the ramp when higher is better, so green always means good news", () => {
    // The whole point of `better`. A $30k tract and an 11%-under-construction
    // submarket are both bad, and both have to be red.
    expect(bandHex(30000, INCOME)).toBe(RAMP[4]);
    expect(bandHex(120000, INCOME)).toBe(RAMP[0]);
  });

  it("never returns the no-data grey for a real number", () => {
    for (const layer of GRADED_LAYERS) {
      for (const v of [-1, 0, 0.5, 1, 100, 1e6]) {
        expect(bandHex(v, layer)).not.toBe(NO_DATA_HEX);
      }
    }
  });
});

describe("legendBands", () => {
  it("lists bands ascending in raw value with the colour that band draws", () => {
    const bands = legendBands(UC);
    expect(bands.map((b) => b.label)).toEqual([
      "< 2.0%", "2.0% – 4.0%", "4.0% – 6.0%", "6.0% – 8.0%", "8.0% +",
    ]);
    // Ascending UC is worsening, so the swatches run green to red.
    expect(bands.map((b) => b.hex)).toEqual([...RAMP]);
  });

  it("runs the swatches the other way for a higher-is-better layer", () => {
    expect(legendBands(INCOME).map((b) => b.hex)).toEqual([...RAMP].reverse());
  });

  it("agrees with bandHex for a value inside every band", () => {
    // The legend and the pins are computed separately; this is the check that
    // they cannot drift apart and quietly label a colour wrongly.
    for (const layer of GRADED_LAYERS) {
      const bands = legendBands(layer);
      const [a, b, c, d] = layer.breaks;
      const probes = [a - Math.abs(a || 1), a, b, c, d];
      probes.forEach((v, i) => {
        expect(bandHex(v, layer)).toBe(bands[i].hex);
      });
    }
  });
});

describe("layer definitions", () => {
  it("has ascending breaks, so the bands cannot overlap", () => {
    for (const layer of GRADED_LAYERS) {
      const [a, b, c, d] = layer.breaks;
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
      expect(c).toBeLessThan(d);
    }
  });

  it("gives every layer a unique id", () => {
    const ids = GRADED_LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
