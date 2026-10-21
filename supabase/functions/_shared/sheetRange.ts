// The real extent of a SheetJS worksheet.
//
// A sheet's declared range (!ref) comes from the file, and Excel stretches it
// over anything ever formatted: a pro forma whose data ends at Z120 can declare
// A1:XFD1048576. sheet_to_csv walks every cell of the declared range, so three
// cells of data under a range of A1:ZZ50000 took 15 s of CPU to convert, and a
// real workbook ran the edge function out of time with no error at all.
//
// The extent is measured from the cells actually present and always starts at
// A1, so the CSV is the same as before for any sheet whose range was honest:
// leading blank rows and columns are kept, only the empty tail goes.

/** Column letters + row number of an A1 address, zero-based; null for "!ref" and friends. */
function decodeAddress(key: string): { r: number; c: number } | null {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(key);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

function encodeColumn(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * "A1:<last column><last row>" over the cells that hold a value, or null for a
 * sheet with none. Cells with no value (a styled stub) do not count. Works on
 * SheetJS's default sparse sheets, where each cell is a key like "C7".
 */
export function dataExtent(sheet: Record<string, unknown>): string | null {
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(sheet)) {
    if (key[0] === "!") continue;
    const cell = sheet[key] as { v?: unknown } | null;
    if (cell == null || cell.v === undefined || cell.v === null || cell.v === "") continue;
    const at = decodeAddress(key);
    if (!at) continue;
    if (at.r > maxR) maxR = at.r;
    if (at.c > maxC) maxC = at.c;
  }
  return maxR < 0 ? null : `A1:${encodeColumn(maxC)}${maxR + 1}`;
}

/** Shrink the sheet's declared range to its data, in place. Returns false for an empty sheet. */
export function trimToData(sheet: Record<string, unknown>): boolean {
  const extent = dataExtent(sheet);
  if (!extent) return false;
  sheet["!ref"] = extent;
  return true;
}
