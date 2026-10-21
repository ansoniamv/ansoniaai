import { describe, expect, it } from "vitest";
import {
  buildOutreachPrompt,
  dealFactsBlock,
  FIRST_NAME_TOKEN,
  normalizeOutreachDraft,
} from "../../supabase/functions/_shared/partnerOutreach";
import { unfilledPlaceholders } from "@/lib/outreachDraft";

describe("dealFactsBlock", () => {
  it("keeps the fields with a value and drops empty ones", () => {
    const block = dealFactsBlock({
      property_name: "Randall Highlands",
      unit_count: 146,
      vintage_year: 2013,
      cfo_date: null,
      notes: "  ",
      floor_plans: [],
      building_amenities: ["Pool"],
      not_an_outreach_field: "x",
    });
    expect(block).toBe(
      'property_name: Randall Highlands\nunit_count: 146\nvintage_year: 2013\nbuilding_amenities: ["Pool"]',
    );
  });
});

describe("buildOutreachPrompt", () => {
  it("carries the template, the deal and the sender's notes", () => {
    const p = buildOutreachPrompt({
      templates: [{ title: "New JV email", text: "Hey {first name} –" }],
      dealFacts: "property_name: Arlington Club",
      omSummaries: [],
      companyBrief: "",
      notes: "Prior contact left the firm",
    });
    expect(p).toContain("--- New JV email ---\nHey {first name} –");
    expect(p).toContain("property_name: Arlington Club");
    expect(p).toContain("Prior contact left the firm");
    expect(p).toContain(`"Hey ${FIRST_NAME_TOKEN} –"`);
    expect(p).not.toContain("OFFERING MEMORANDUM");
    expect(p).not.toContain("ABOUT ANSONIA");
  });
});

describe("normalizeOutreachDraft", () => {
  it("turns the template's name slot into the token the dialog fills", () => {
    const d = normalizeOutreachDraft({
      subject: "Subject: New JV Opportunity - Ansonia Properties",
      body: "Hey {first name} –\r\n\r\nWe're pursuing…",
      check: ["CFO date", " ", 3],
    });
    expect(d.subject).toBe("New JV Opportunity - Ansonia Properties");
    expect(d.body).toBe(`Hey ${FIRST_NAME_TOKEN} –\n\nWe're pursuing…`);
    expect(d.check).toEqual(["CFO date", "3"]);
  });

  it("leaves the real token alone and does not double-wrap {{first_name}}", () => {
    expect(normalizeOutreachDraft({ subject: "s", body: `Hey ${FIRST_NAME_TOKEN} –` }).body).toBe(`Hey ${FIRST_NAME_TOKEN} –`);
    expect(normalizeOutreachDraft({ subject: "s", body: "Hey {{first_name}} –" }).body).toBe(`Hey ${FIRST_NAME_TOKEN} –`);
  });

  it("rejects an empty draft", () => {
    expect(() => normalizeOutreachDraft({ subject: "", body: "x" })).toThrow();
    expect(() => normalizeOutreachDraft(null)).toThrow();
  });
});

describe("unfilledPlaceholders", () => {
  it("lists each [[placeholder]] once across subject and body", () => {
    expect(unfilledPlaceholders("New JV", "CFO: [[CFO date]]\nAgain [[CFO date]] and [[ HH income ]]")).toEqual([
      "CFO date",
      "HH income",
    ]);
  });

  it("ignores single brackets and the name token", () => {
    expect(unfilledPlaceholders(`Hey ${FIRST_NAME_TOKEN} – see [attached]`)).toEqual([]);
  });
});
