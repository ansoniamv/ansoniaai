/// <reference lib="webworker" />
// Parses a CoStar export off the main thread; the sheet is ~170 MB of XML.
import { parseCostarExport } from "@/lib/costarExport";

self.onmessage = async (e: MessageEvent<File>) => {
  try {
    const result = await parseCostarExport(e.data, (p) => self.postMessage({ type: "progress", ...p }));
    self.postMessage({ type: "done", result });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
