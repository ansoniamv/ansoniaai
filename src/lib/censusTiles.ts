/**
 * Fetching census areas for the map, one web-mercator tile at a time.
 *
 * There is no vector-tile service for tracts — neither Esri's Living Atlas nor
 * Census TIGERweb publishes one — so areas come from feature-service queries.
 * Asking for "everything in the viewport" fails twice over: a metro at tract
 * zoom is ~3 MB of polygons, and the answer cannot be reused after a pan. So
 * the viewport is cut into tiles at a data zoom, each tile is one query with
 * geometry generalised to a pixel at that zoom (~4 KB for a rural tile,
 * 0.2 s), and tiles are cached for the session. An area spanning two tiles
 * comes back from both; it is the same generalised shape, kept once by GEOID.
 */
import { ACS_FIELDS, type AcsAttrs, type AreaLayer, type AreaLevel } from "@/lib/censusLayers";

const LIVING_ATLAS = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services";
export const ACS_SERVICE = LIVING_ATLAS + "/ACS_Highlights_Population_Housing_Basics_Boundaries/FeatureServer";
/** The oldest ACS vintage Living Atlas publishes, used as the growth baseline. */
export const ACS_BASELINE_SERVICE = LIVING_ATLAS + "/ACS_10_14_Total_Population_Boundaries/FeatureServer";

const LAYER_INDEX: Record<AreaLevel, number> = { county: 1, tract: 2 };

/**
 * Below this map zoom areas are counties. The service itself stops drawing
 * tracts above 1:2,000,000 (about zoom 8), and at a state-wide view tracts are
 * thousands of polygons a few pixels across — noise, not information.
 */
export const TRACT_MIN_ZOOM = 8;

/** The data zoom never goes past 12: tract outlines do not get any sharper. */
const DATA_ZOOM = { county: [3, 9], tract: [TRACT_MIN_ZOOM, 12] } as const;

/** More tiles than this in one view means something is wrong; fetch nothing. */
export const MAX_TILES = 120;

export type Tile = { x: number; y: number; z: number };
export type Bounds = { west: number; south: number; east: number; north: number };

export function levelFor(zoom: number, layer: AreaLayer): AreaLevel {
  return layer.countyOnly || zoom < TRACT_MIN_ZOOM ? "county" : "tract";
}

export function dataZoom(zoom: number, level: AreaLevel): number {
  const [lo, hi] = DATA_ZOOM[level];
  return Math.min(hi, Math.max(lo, Math.floor(zoom)));
}

const MAX_LAT = 85.0511287798;

function lngToX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

function latToY(lat: number, z: number): number {
  const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export function tileBounds({ x, y, z }: Tile): Bounds {
  const n = 2 ** z;
  const lat = (yy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: lat(y), south: lat(y + 1) };
}

/** The tiles at zoom z covering the bounds, or null if there are too many. */
export function tilesFor(b: Bounds, z: number): Tile[] | null {
  const n = 2 ** z;
  // MapLibre's bounds run past ±180 when the world wraps. Clamp rather than
  // wrap: every census area is inside one copy of the world.
  const west = Math.max(-180, b.west);
  const east = Math.min(180, b.east);
  if (east <= west) return [];
  const x0 = Math.max(0, Math.floor(lngToX(west, z)));
  const x1 = Math.min(n - 1, Math.floor(lngToX(east, z)));
  const y0 = Math.max(0, Math.floor(latToY(b.north, z)));
  const y1 = Math.min(n - 1, Math.floor(latToY(b.south, z)));
  const count = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (count > MAX_TILES) return null;
  const out: Tile[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ x, y, z });
  return out;
}

export function tileQueryUrl(level: AreaLevel, tile: Tile): string {
  const b = tileBounds(tile);
  // Half a pixel of a 256-px tile at this zoom, in degrees. Generalising
  // is what keeps a tile to a few kilobytes, but each polygon is simplified
  // on its own, so neighbours pull apart; at a full pixel the cracks between
  // counties showed as white slivers at national zoom.
  const offset = 360 / 2 ** tile.z / 512;
  const params = new URLSearchParams({
    where: "1=1",
    geometry: [b.west, b.south, b.east, b.north].join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: ACS_FIELDS.join(","),
    outSR: "4326",
    resultType: "tile",
    maxAllowableOffset: String(offset),
    geometryPrecision: tile.z >= 10 ? "6" : "5",
    f: "geojson",
  });
  return `${ACS_SERVICE}/${LAYER_INDEX[level]}/query?${params}`;
}

export type AreaFeature = {
  type: "Feature";
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
  properties: AcsAttrs;
};

/**
 * ArcGIS reports most failures as HTTP 200 with an `error` body, so a status
 * check alone would cache an error as "this tile has no areas" — an empty
 * patch of map that looks exactly like ocean.
 */
async function getJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Census layer request failed (HTTP ${res.status})`);
  const body = (await res.json()) as Record<string, unknown>;
  const err = body.error as { message?: string } | undefined;
  if (err) throw new Error("Census layer request failed: " + (err.message ?? "unknown error"));
  return body;
}

const tileCache = new Map<string, Promise<AreaFeature[]>>();

export function fetchTile(level: AreaLevel, tile: Tile): Promise<AreaFeature[]> {
  const key = `${level}/${tile.z}/${tile.x}/${tile.y}`;
  let p = tileCache.get(key);
  if (!p) {
    p = getJson(tileQueryUrl(level, tile)).then((body) => {
      const features = body.features;
      if (!Array.isArray(features)) throw new Error("Census layer returned no feature list");
      return (features as AreaFeature[]).filter(
        (f) => f.geometry && typeof f.properties?.GEOID === "string",
      );
    });
    // A failed tile is forgotten, so the next pan asks again instead of the
    // hole staying for the rest of the session.
    p.catch(() => tileCache.delete(key));
    tileCache.set(key, p);
  }
  return p;
}

/** Merge tiles, keeping each area once. */
export function mergeTiles(tiles: AreaFeature[][]): AreaFeature[] {
  const seen = new Map<string, AreaFeature>();
  for (const t of tiles) for (const f of t) if (!seen.has(f.properties.GEOID)) seen.set(f.properties.GEOID, f);
  return [...seen.values()];
}

/**
 * "(ACS) 2019-2023 5-year estimates" → { start: 2019, end: 2023 }.
 *
 * Living Atlas updates these layers in place to each new ACS release, so the
 * vintage is read from the service rather than written here; a hard-coded
 * "2019–23" would quietly become false in December. Anchored on "5-year" and
 * checked for a five-year span, so a description that changes shape yields
 * null and the growth layer refuses to draw instead of dividing by a guess.
 */
export function parseVintage(copyright: unknown): { start: number; end: number } | null {
  if (typeof copyright !== "string") return null;
  const m = /\b(\d{4})\s*-\s*(\d{4}) 5-year estimates\b/.exec(copyright);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (end - start !== 4 || start < 2005 || end > 2100) return null;
  return { start, end };
}

export type Vintage = { start: number; end: number };

let vintageP: Promise<Vintage> | null = null;
export function fetchVintage(service = ACS_SERVICE): Promise<Vintage> {
  const run = () => getJson(service + "?f=json").then((b) => {
    const v = parseVintage(b.copyrightText);
    if (!v) throw new Error("Could not read the ACS vintage from the census layer");
    return v;
  });
  if (service !== ACS_SERVICE) return run();
  if (!vintageP) {
    vintageP = run();
    vintageP.catch(() => { vintageP = null; });
  }
  return vintageP;
}

export type GrowthBaseline = { vintage: Vintage; population: Map<string, number> };

let baselineP: Promise<GrowthBaseline> | null = null;

/** County population in the baseline vintage: ~3,200 rows, ~20 KB, once. */
export function fetchGrowthBaseline(): Promise<GrowthBaseline> {
  if (!baselineP) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "GEOID,B01001_001E",
      returnGeometry: "false",
      // "standard" lifts the cap from the layer's 2,000 to 32,000 rows for an
      // attribute-only query. Without it the answer is silently truncated
      // and two-thirds of the counties would read as "no baseline".
      resultType: "standard",
      f: "json",
    });
    baselineP = Promise.all([
      fetchVintage(ACS_BASELINE_SERVICE),
      getJson(`${ACS_BASELINE_SERVICE}/1/query?${params}`),
    ]).then(([vintage, body]) => {
      if (body.exceededTransferLimit) throw new Error("Growth baseline was truncated by the census layer");
      const rows = (body.features as Array<{ attributes: { GEOID: string; B01001_001E: number | null } }>) ?? [];
      const population = new Map<string, number>();
      for (const r of rows) {
        const p = r.attributes?.B01001_001E;
        if (typeof r.attributes?.GEOID === "string" && typeof p === "number" && Number.isFinite(p)) {
          population.set(r.attributes.GEOID, p);
        }
      }
      if (population.size === 0) throw new Error("Growth baseline came back empty");
      return { vintage, population };
    });
    baselineP.catch(() => { baselineP = null; });
  }
  return baselineP;
}
