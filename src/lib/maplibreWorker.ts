import { setWorkerUrl } from "maplibre-gl";
// Vite emits this as a real asset and hands back its URL, which is the whole
// point: the URL becomes statically traceable.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

/**
 * Point MapLibre at its tile-parsing worker explicitly.
 *
 * Without this the map renders its container, controls and attribution, and
 * then nothing else — a blank white rectangle that looks like a styling bug and
 * is not one. MapLibre parses every vector tile in a Web Worker; when the worker
 * fails to load, no tile is ever decoded, so no basemap and no markers appear.
 * The console says only:
 *
 *   Worker failed to load. Check that the worker URL is correct.
 *
 * MapLibre constructs the worker from a URL held in a variable. Rollup cannot
 * trace `new Worker(someVariable)` back to a module, so the production build
 * emitted no worker chunk at all and the URL resolved to nothing. Verified on
 * the built output: `new Worker(e,{type:"module"})` with no worker asset beside
 * it. The dev server fails the same way for its own reason — the pre-bundled
 * copy under .vite/deps breaks the relative path.
 *
 * Importing the worker with `?url` makes it an asset Vite emits and fingerprints,
 * and setWorkerUrl tells MapLibre where it landed. This runs as a module side
 * effect so it is in place before any Map is constructed.
 */
setWorkerUrl(workerUrl);
