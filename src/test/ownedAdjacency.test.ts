import { describe, it, expect } from "vitest";
import { placeKey, buildOwnedPlaceMap, ownedNearby } from "@/lib/ownedAdjacency";

const OWNED = buildOwnedPlaceMap([
  { name: "Sunbury Commons", city: "Sunbury", state: "OH", status: "current" },
  { name: "Mandalane", city: "Wheeling", state: "IL", status: "current" },
  { name: "Fairways of Naperville", city: "Naperville", state: "IL", status: "current" },
  { name: "Park Edgewater", city: "Chicago", state: "IL", status: "sold" },
  { name: "The Duncan", city: "Chicago", state: "IL", status: "current" },
  { name: "Brighton Square", city: null, state: "WI", status: "current" },
]);

describe("placeKey", () => {
  it("needs both city and state", () => {
    expect(placeKey("Sunbury", "OH")).toBe("sunbury|oh");
    expect(placeKey("Sunbury", null)).toBeNull();
    expect(placeKey(null, "OH")).toBeNull();
    expect(placeKey("  ", "OH")).toBeNull();
  });

  it("ignores case and extra whitespace", () => {
    expect(placeKey("  st.   CHARLES ", " il ")).toBe("st. charles|il");
  });
});

describe("ownedNearby", () => {
  it("matches the real pipeline overlaps", () => {
    expect(ownedNearby("Sunbury", "OH", OWNED).map((o) => o.name)).toEqual(["Sunbury Commons"]);
    expect(ownedNearby("Wheeling", "IL", OWNED).map((o) => o.name)).toEqual(["Mandalane"]);
    expect(ownedNearby("naperville", "il", OWNED).map((o) => o.name)).toEqual(["Fairways of Naperville"]);
  });

  it("returns every owned asset in the town, sold included", () => {
    expect(ownedNearby("Chicago", "IL", OWNED).map((o) => o.name).sort())
      .toEqual(["Park Edgewater", "The Duncan"]);
  });

  it("does not match on city alone across states", () => {
    expect(ownedNearby("Wheeling", "WV", OWNED)).toEqual([]);
  });

  it("returns nothing for a deal with no location", () => {
    expect(ownedNearby(null, null, OWNED)).toEqual([]);
    expect(ownedNearby("Sunbury", null, OWNED)).toEqual([]);
  });

  it("never matches an owned record that itself lacks a city", () => {
    expect(ownedNearby("Madison", "WI", OWNED)).toEqual([]);
  });
});
