// Turn a file's bytes into text sections (page / sheet / slide), the same way
// the Brain reads uploads (process-data-room-source). Used by the SharePoint
// reader. Deno-only (esm.sh imports), so vitest does not import this file.
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import { strFromU8, unzipSync } from "https://esm.sh/fflate@0.8.2";
// @ts-ignore vendored ESM build
import * as XLSX from "./vendor/xlsx-0.20.3.mjs";
import { dataRoomFileKind, ooxmlText, slidePaths, type Section } from "./dataRoom.ts";
import { SCANNED_CHARS_PER_PAGE } from "./dealDocuments.ts";
import { trimToData } from "./sheetRange.ts";

export type FileText = {
  sections: Section[];
  /** Every section the file has, when only some were read (big workbooks). */
  allSections?: string[];
  note?: string;
  /** PDF with little or no text layer (a scan): sections will be near-empty. */
  scanned?: { pages: number };
  unsupported?: boolean;
};

/**
 * Above this size a workbook is read one sheet at a time: parsing every sheet
 * of a 6.7MB candidates list exhausted an edge worker (2026-11-11).
 */
export const BIG_WORKBOOK_BYTES = 3 * 1024 * 1024;

/** Sheets to parse for `section`: exact name first, else names containing it; null when nothing matches. */
export function pickSheets(names: string[], section: string | undefined): string[] | null {
  const want = section?.trim().toLowerCase().replace(/^sheet:\s*/, "");
  if (!want) return null;
  const exact = names.filter((n) => n.toLowerCase() === want);
  if (exact.length) return exact;
  const partial = names.filter((n) => n.toLowerCase().includes(want));
  return partial.length ? partial : null;
}

export async function fileToText(
  bytes: Uint8Array,
  fileName: string,
  contentType: string | null,
  opts: { section?: string } = {},
): Promise<FileText> {
  const kind = dataRoomFileKind(fileName, contentType);
  if (kind === "unsupported") return { sections: [], unsupported: true };

  if (kind === "pdf") {
    const pdf = await getDocumentProxy(bytes.slice());
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text as string[];
    const sections = pages.map((p, i) => ({ locator: `Page ${i + 1}`, text: p }));
    const chars = pages.reduce((n, p) => n + p.trim().length, 0);
    return chars / Math.max(1, totalPages) >= SCANNED_CHARS_PER_PAGE
      ? { sections }
      : { sections, scanned: { pages: totalPages } };
  }

  if (kind === "spreadsheet") {
    // Sheet names first (workbook.xml only), so a big workbook can be read one sheet at a time.
    const names: string[] = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
    const picked = pickSheets(names, opts.section);
    const big = bytes.length > BIG_WORKBOOK_BYTES && names.length > 1;
    const wanted = picked ?? (big ? names.slice(0, 1) : names);
    const wb = XLSX.read(bytes, { type: "array", cellDates: true, sheets: wanted, cellFormula: false, cellHTML: false });
    // Trim each sheet to its data first: a pro forma's declared range can run
    // to XFD1048576, and converting that runs the function out of time.
    const sections = wanted.filter((name) => wb.Sheets[name] && trimToData(wb.Sheets[name])).map((name) => ({
      locator: `Sheet: ${name}`,
      text: XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false, strip: true, rawNumbers: true }),
    }));
    return {
      sections,
      allSections: names.map((n) => `Sheet: ${n}`),
      ...(!picked && big
        ? { note: `Large workbook: only the first sheet ("${names[0]}") was read. Pass section with a sheet name to read another.` }
        : {}),
    };
  }

  if (kind === "docx" || kind === "pptx") {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch {
      throw new Error("This Office file could not be opened (an old .doc/.ppt, or damaged).");
    }
    if (kind === "docx") {
      const doc = files["word/document.xml"];
      return { sections: doc ? [{ locator: null, text: ooxmlText(strFromU8(doc)) }] : [] };
    }
    return {
      sections: slidePaths(Object.keys(files)).map((p, i) => {
        const notes = files[p.replace("slides/slide", "notesSlides/notesSlide")];
        const text = ooxmlText(strFromU8(files[p])) + (notes ? `\nSpeaker notes: ${ooxmlText(strFromU8(notes))}` : "");
        return { locator: `Slide ${i + 1}`, text };
      }),
    };
  }

  return { sections: [{ locator: null, text: new TextDecoder().decode(bytes) }] };
}
