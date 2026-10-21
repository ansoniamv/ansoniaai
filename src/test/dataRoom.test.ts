import { describe, expect, it } from "vitest";
import {
  briefPrompt,
  chunkSections,
  dataRoomFileKind,
  mapLinks,
  normalizeSummary,
  ooxmlText,
  pickWebsitePages,
  slidePaths,
} from "../../supabase/functions/_shared/dataRoom";
import { companyBriefBlock } from "../../supabase/functions/_shared/companyBrief";
import { briefIsStale, type DataRoomSource } from "@/lib/dataRoom";

describe("dataRoomFileKind", () => {
  it("recognises the formats the reader handles", () => {
    expect(dataRoomFileKind("Deck.PDF", null)).toBe("pdf");
    expect(dataRoomFileKind("Summerlin Pro Forma.xlsm", null)).toBe("spreadsheet");
    expect(dataRoomFileKind("memo.docx", null)).toBe("docx");
    expect(dataRoomFileKind("Fund III.pptx", null)).toBe("pptx");
    expect(dataRoomFileKind("notes.md", null)).toBe("text");
    expect(dataRoomFileKind("blob", "application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("pptx");
  });

  it("refuses legacy binary Office files rather than reading garbage", () => {
    expect(dataRoomFileKind("old.doc", "application/msword")).toBe("unsupported");
    expect(dataRoomFileKind("old.ppt", null)).toBe("unsupported");
  });
});

describe("ooxmlText", () => {
  it("joins runs within a paragraph and breaks between paragraphs", () => {
    const xml =
      `<w:body><w:p w:rsidR="00A1"><w:r><w:t>Target </w:t></w:r><w:r w:rsidRPr="x"><w:t>IRR 1</w:t></w:r>` +
      `<w:r><w:t>8%</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Hold   5 years</w:t></w:r></w:p></w:body>`;
    expect(ooxmlText(xml)).toBe("Target IRR 18%\nHold 5 years");
  });

  it("does not split a word Word stored across runs with attributes between them", () => {
    expect(ooxmlText(`<w:p><w:r><w:t>Hel</w:t></w:r><w:r w:rsidR="1" w:rsidRPr="2"><w:t>lo</w:t></w:r></w:p>`)).toBe("Hello");
  });

  it("reads slide text runs, tabs and entities", () => {
    const xml = `<p:sld><a:p><a:r><a:t>Cap rate</a:t></a:r><a:tab/><a:r><a:t>5.5% &amp; rising</a:t></a:r></a:p></p:sld>`;
    expect(ooxmlText(xml)).toBe("Cap rate 5.5% & rising");
  });

  it("ignores <w:tab> elements' look-alike <w:t> prefix", () => {
    expect(ooxmlText(`<w:p><w:pPr><w:tabs><w:tab w:val="left"/></w:tabs></w:pPr><w:r><w:t>A</w:t></w:r></w:p>`)).toBe("A");
  });
});

describe("slidePaths", () => {
  it("orders slides numerically and drops non-slide parts", () => {
    expect(
      slidePaths(["ppt/slides/slide10.xml", "ppt/slides/slide2.xml", "ppt/slides/_rels/slide2.xml.rels", "ppt/slides/slide1.xml"]),
    ).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide10.xml"]);
  });
});

describe("chunkSections", () => {
  it("packs lines up to the size and keeps each chunk inside its section", () => {
    const chunks = chunkSections(
      [
        { locator: "Page 1", text: "a".repeat(60) + "\n" + "b".repeat(60) },
        { locator: "Page 2", text: "c".repeat(30) },
      ],
      100,
    );
    expect(chunks.map((c) => [c.ordinal, c.locator, c.content.length])).toEqual([
      [0, "Page 1", 60],
      [1, "Page 1", 60],
      [2, "Page 2", 30],
    ]);
  });

  it("splits a single over-long line and skips empty sections", () => {
    const chunks = chunkSections([{ locator: null, text: "x".repeat(250) }, { locator: "Empty", text: "  \n " }], 100);
    expect(chunks.map((c) => c.content.length)).toEqual([100, 100, 50]);
  });
});

describe("pickWebsitePages", () => {
  it("starts with the address given and prefers useful same-site pages", () => {
    const pages = pickWebsitePages(
      "https://ansonia.example/",
      [
        "https://ansonia.example/",
        "https://www.ansonia.example/about-us",
        "https://ansonia.example/blog/2024/03/some-post",
        "https://ansonia.example/privacy-policy",
        "https://other.example/about",
        "https://ansonia.example/team#leaders",
        "https://ansonia.example/team",
        "https://ansonia.example/brochure.pdf",
        "/investment-strategy",
      ],
      4,
    );
    expect(pages).toEqual([
      "https://ansonia.example/",
      "https://www.ansonia.example/about-us",
      "https://ansonia.example/team",
      "https://ansonia.example/investment-strategy",
    ]);
  });

  it("returns nothing for an invalid address", () => {
    expect(pickWebsitePages("not a url", [])).toEqual([]);
  });
});

describe("mapLinks", () => {
  it("accepts both response shapes Firecrawl has used", () => {
    expect(mapLinks({ links: ["https://a.example/x", { url: "https://a.example/y" }, { title: "no url" }] })).toEqual([
      "https://a.example/x",
      "https://a.example/y",
    ]);
    expect(mapLinks({ data: { links: ["https://a.example/z"] } })).toEqual(["https://a.example/z"]);
    expect(mapLinks(null)).toEqual([]);
  });
});

describe("normalizeSummary", () => {
  it("drops empty facts and falls back to 'other' for an unknown category", () => {
    const s = normalizeSummary({
      summary: " x ",
      key_facts: [{ fact: "Hold 5 years", where: "Page 3" }, { fact: " ", where: "" }],
      suggested_title: "Deck",
      suggested_category: "nonsense",
    });
    expect(s).toMatchObject({ summary: "x", key_facts: [{ fact: "Hold 5 years", where: "Page 3" }], suggested_category: "other" });
    expect(s.transcript).toBeUndefined();
  });
});

describe("briefPrompt", () => {
  it("includes a note's text and each source's facts", () => {
    const p = briefPrompt([
      { title: 'Our "no" list', category: "strategy", kind: "note", processed_at: "2026-10-01T00:00:00Z", summary: null, key_facts: [], body: "No student housing." },
      { title: "Deck", category: "investor_deck", kind: "file", processed_at: null, summary: "Fund III.", key_facts: [{ fact: "Target IRR 18%", where: "Slide 4" }], body: null },
    ]);
    expect(p).toContain(`title="Our 'no' list"`);
    expect(p).toContain("No student housing.");
    expect(p).toContain("- Target IRR 18% (Slide 4)");
    expect(p).toContain('as_of="2026-10-01"');
  });
});

describe("companyBriefBlock", () => {
  it("is empty for an empty brief so prompts run unchanged", () => {
    expect(companyBriefBlock("  ")).toBe("");
  });
  it("labels and truncates", () => {
    const b = companyBriefBlock("abcdef", 3);
    expect(b).toContain("ANSONIA COMPANY BRIEF");
    expect(b).toContain("abc\n[… brief truncated]");
  });
});

describe("briefIsStale", () => {
  const src = (id: string, over: Partial<DataRoomSource> = {}): DataRoomSource =>
    ({ id, status: "ready", include_in_brief: true, processed_at: "2026-10-01T00:00:00Z", ...over }) as DataRoomSource;
  const brief = { content: "x", source_ids: ["a", "b"], model: null, built_at: "2026-10-02T00:00:00Z", edited_at: null };

  it("is current when the brief was built from exactly the included ready sources", () => {
    expect(briefIsStale(brief, [src("a"), src("b"), src("c", { include_in_brief: false }), src("d", { status: "failed" })])).toBe(false);
  });
  it("is stale when a source is added, removed, excluded or re-read", () => {
    expect(briefIsStale(brief, [src("a"), src("b"), src("c")])).toBe(true);
    expect(briefIsStale(brief, [src("a")])).toBe(true);
    expect(briefIsStale(brief, [src("a"), src("b", { include_in_brief: false })])).toBe(true);
    expect(briefIsStale(brief, [src("a"), src("b", { processed_at: "2026-10-03T00:00:00Z" })])).toBe(true);
  });
  it("needs a brief once anything is ready", () => {
    expect(briefIsStale(null, [])).toBe(false);
    expect(briefIsStale(null, [src("a")])).toBe(true);
  });
});
