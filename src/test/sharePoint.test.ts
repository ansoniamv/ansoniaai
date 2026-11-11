import { describe, expect, it } from "vitest";
import {
  cleanFolderPath,
  driveRootPathUrl,
  folderFromParentPath,
  inFolder,
  isItemId,
  isSharePointSite,
  listFolder,
  searchKql,
  folderFromWebUrl,
  cleanSnippet,
  searchSite,
  toEntry,
  windowSections,
} from "../../supabase/functions/_shared/sharePoint";

describe("cleanFolderPath", () => {
  it("treats missing as the library root", () => {
    expect(cleanFolderPath(undefined)).toBe("");
    expect(cleanFolderPath("")).toBe("");
    expect(cleanFolderPath("/")).toBe("");
  });
  it("normalizes slashes and strips the library name", () => {
    expect(cleanFolderPath("\\04. Chicago Properties\\Kenwood Deal\\")).toBe("04. Chicago Properties/Kenwood Deal");
    expect(cleanFolderPath("Shared Documents/01. Texas Properties")).toBe("01. Texas Properties");
  });
  it("accepts a pasted SharePoint URL", () => {
    expect(
      cleanFolderPath("https://ansoniaproperties.sharepoint.com/sites/Acquisitions2/Shared%20Documents/04.%20Chicago%20Properties"),
    ).toBe("04. Chicago Properties");
  });
  it("keeps non-ASCII folder names", () => {
    expect(cleanFolderPath("04. Chicago Properties/ΩOld Chicago Deals")).toBe("04. Chicago Properties/ΩOld Chicago Deals");
  });
  it("refuses traversal and Graph path syntax", () => {
    expect(cleanFolderPath("../x")).toBeNull();
    expect(cleanFolderPath("a/:/children")).toBeNull();
    expect(cleanFolderPath(42)).toBeNull();
  });
});

describe("driveRootPathUrl", () => {
  it("addresses the root without a path segment", () => {
    expect(driveRootPathUrl("acquisitions", "", ":/children")).toMatch(/\/drive\/root\/children$/);
  });
  it("encodes each path segment", () => {
    const url = driveRootPathUrl("asset_management", "Owned Properties/1015 Villages at Canterfield", ":/children");
    expect(url).toContain("/drive/root:/Owned%20Properties/1015%20Villages%20at%20Canterfield:/children");
    expect(url).toContain("b7ab1842-f5ab-4064-91ae-f72c3779b623");
  });
});

describe("small validators", () => {
  it("isSharePointSite only accepts the two granted sites", () => {
    expect(isSharePointSite("acquisitions")).toBe(true);
    expect(isSharePointSite("asset_management")).toBe(true);
    expect(isSharePointSite("root")).toBe(false);
    expect(isSharePointSite("toString")).toBe(false);
  });
  it("isItemId", () => {
    expect(isItemId("01352QH4JBDB6BQORHHRGLNWK7PDYEVKE7")).toBe(true);
    expect(isItemId("../../users")).toBe(false);
    expect(isItemId("")).toBe(false);
  });
  it("searchKql groups the words and scopes to the library or a folder", () => {
    expect(searchKql("  Canterfield   T12 ", "acquisitions", "")).toBe(
      '(Canterfield T12) path:"https://ansoniaproperties.sharepoint.com/sites/Acquisitions2/Shared Documents"',
    );
    expect(searchKql("rent roll", "asset_management", "Owned Properties")).toBe(
      '(rent roll) path:"https://ansoniaproperties.sharepoint.com/sites/AssetManagement/Shared Documents/Owned Properties"',
    );
  });
  it("searchKql strips scope escapes the user wrote", () => {
    const k = searchKql('x) OR (path:"https://ansoniaproperties.sharepoint.com/sites/HumanResources" OR site:foo y', "acquisitions", "")!;
    expect(k).not.toMatch(/HumanResources|site:/);
    expect(k.startsWith("(x OR OR y)")).toBe(true);
    expect(searchKql('"unbalanced', "acquisitions", "")).toBe(
      '(unbalanced) path:"https://ansoniaproperties.sharepoint.com/sites/Acquisitions2/Shared Documents"',
    );
    expect(searchKql("   ", "acquisitions", "")).toBeNull();
  });
  it("folderFromWebUrl and cleanSnippet", () => {
    const lib = "https://ansoniaproperties.sharepoint.com/sites/Acquisitions2/Shared%20Documents";
    expect(folderFromWebUrl("acquisitions", `${lib}/04.%20Chicago%20Properties/K/T12.xlsx`)).toBe("04. Chicago Properties/K");
    expect(folderFromWebUrl("acquisitions", `${lib}/top.xlsx`)).toBe("");
    expect(
      folderFromWebUrl("acquisitions", "https://ansoniaproperties.sharepoint.com/sites/HumanResources/Shared Documents/a/b.pdf"),
    ).toBe("");
    expect(cleanSnippet("<ddd/><c0>Canterfield</c0> Overview<ddd/>")).toBe("… Canterfield Overview …");
  });
  it("inFolder matches the subtree only", () => {
    expect(inFolder("04. Chicago Properties/Kenwood", "04. chicago properties")).toBe(true);
    expect(inFolder("04. Chicago Properties", "04. Chicago Properties")).toBe(true);
    expect(inFolder("04. Chicago Properties Old", "04. Chicago Properties")).toBe(false);
    expect(inFolder("anything", "")).toBe(true);
  });
});

describe("toEntry", () => {
  it("reads folder from parentReference.path", () => {
    expect(folderFromParentPath("/drives/b!abc/root:/04.%20Chicago%20Properties/Kenwood")).toBe("04. Chicago Properties/Kenwood");
    expect(folderFromParentPath("/drives/b!abc/root:")).toBe("");
    expect(folderFromParentPath(undefined)).toBe("");
  });
  it("shapes a file and a folder", () => {
    const f = toEntry("acquisitions", {
      id: "01ABC", name: "T12.xlsx", size: 2048, file: {}, lastModifiedDateTime: "2026-10-01T00:00:00Z",
      lastModifiedBy: { user: { displayName: "Pat" } }, webUrl: "https://x", parentReference: { path: "/drives/d/root:/A" },
    });
    expect(f).toMatchObject({ kind: "file", folder: "A", size_bytes: 2048, modified_by: "Pat" });
    const d = toEntry("acquisitions", { id: "01DEF", name: "A", folder: { childCount: 3 } });
    expect(d).toMatchObject({ kind: "folder", child_count: 3, folder: "" });
  });
});

describe("windowSections", () => {
  const sections = [
    { locator: "Sheet: Summary", text: "a".repeat(10) },
    { locator: "Sheet: T12", text: "b".repeat(10) },
    { locator: "Sheet: Empty", text: "  " },
  ];
  it("returns everything that fits, dropping empty sections", () => {
    const w = windowSections(sections, { max: 1000 });
    expect(w.sections).toEqual(["Sheet: Summary", "Sheet: T12"]);
    expect(w.text).toContain("## Sheet: T12\nbbbbbbbbbb");
    expect(w.note).toBeUndefined();
  });
  it("picks a section by name", () => {
    const w = windowSections(sections, { section: "t12", max: 1000 });
    expect(w.text).toBe("## Sheet: T12\nbbbbbbbbbb");
  });
  it("prefers an exact section name over partial matches", () => {
    const pages = [3, 30, 31].map((n) => ({ locator: `Page ${n}`, text: `p${n}` }));
    expect(windowSections(pages, { section: "page 3", max: 1000 }).text).toBe("## Page 3\np3");
    const sheets = [{ locator: "Sheet: T12", text: "a" }, { locator: "Sheet: T12 Comparison", text: "b" }];
    expect(windowSections(sheets, { section: "T12", max: 1000 }).text).toBe("## Sheet: T12\na");
    expect(windowSections(sheets, { section: "comparison", max: 1000 }).text).toBe("## Sheet: T12 Comparison\nb");
  });
  it("says when a section is missing", () => {
    expect(windowSections(sections, { section: "Rent Roll", max: 1000 }).note).toMatch(/No section matches/);
  });
  it("pages with start and says where to continue", () => {
    const w = windowSections(sections, { max: 5 });
    expect(w.returned).toEqual([0, 5]);
    expect(w.note).toMatch(/start=5/);
    const w2 = windowSections(sections, { start: 5, max: 1000 });
    expect(w2.returned[0]).toBe(5);
    expect(w2.note).toBeUndefined();
  });
});

describe("network helpers", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  it("listFolder sorts folders first then newest files", async () => {
    const fetcher = async () => ok({ value: [
      { id: "1", name: "old.pdf", file: {}, lastModifiedDateTime: "2020-01-01" },
      { id: "2", name: "B", folder: {} },
      { id: "3", name: "new.pdf", file: {}, lastModifiedDateTime: "2026-01-01" },
      { id: "4", name: "A", folder: {} },
    ] });
    const { entries } = await listFolder(fetcher, "t", "acquisitions", "");
    expect(entries.map((e) => e.name)).toEqual(["A", "B", "new.pdf", "old.pdf"]);
  });
  it("searchSite drops hits from other libraries and outside the folder", async () => {
    let sent = "";
    const lib = "https://ansoniaproperties.sharepoint.com/sites/Acquisitions2/Shared%20Documents";
    const acq = { driveId: "b!sq45xHr8I0KWNiX0V-WaqWFYk3uAbf1EocfErDcnYpVApWJ7MSvTSpDWgIbGmGV_" };
    const fetcher = async (_u: string, init?: RequestInit) => {
      sent = String(init?.body);
      return ok({ value: [{ hitsContainers: [{ hits: [
        { summary: "<c0>rent</c0> roll", resource: { id: "1", name: "RR.xlsx", file: {}, webUrl: `${lib}/04.%20Chicago%20Properties/K/RR.xlsx`, parentReference: acq } },
        {
          resource: {
            id: "2", name: "K", size: 0, file: { mimeType: "application/octet-stream" },
            webUrl: `${lib}/04.%20Chicago%20Properties/K`, parentReference: acq,
          },
        },
        {
          resource: {
            id: "3", name: "s.xlsx", file: {},
            webUrl: "https://ansoniaproperties.sharepoint.com/sites/HumanResources/Shared%20Documents/04.%20Chicago%20Properties/s.xlsx",
            parentReference: { driveId: "b!other" },
          },
        },
        { resource: { id: "4", name: "TX.xlsx", file: {}, webUrl: `${lib}/01.%20Texas%20Properties/TX.xlsx`, parentReference: acq } },
      ] }] }] });
    };
    const r = await searchSite(fetcher, "t", "acquisitions", "rent roll", "04. Chicago Properties");
    expect(r.map((e) => [e.item_id, e.kind, e.folder])).toEqual([
      ["1", "file", "04. Chicago Properties/K"],
      ["2", "folder", "04. Chicago Properties"],
    ]);
    expect(r[0].snippet).toBe("rent roll");
    expect(JSON.parse(sent).requests[0].region).toBe("NAM");
  });
  it("maps a 403 to access denied", async () => {
    const fetcher = async () => new Response(JSON.stringify({ error: { code: "accessDenied" } }), { status: 403 });
    await expect(listFolder(fetcher, "t", "acquisitions", "")).rejects.toThrow(/access denied/);
  });
});
