import { describe, expect, it } from "vitest";
import {
  buildOutreachPrompt,
  dealFactsBlock,
  documentFactsBlock,
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
      documents: [],
      companyBrief: "",
      notes: "Prior contact left the firm",
    });
    expect(p).toContain("--- New JV email ---\nHey {first name} –");
    expect(p).toContain("property_name: Arlington Club");
    expect(p).toContain("Prior contact left the firm");
    expect(p).toContain(`"Hey ${FIRST_NAME_TOKEN} –"`);
    expect(p).toContain("UPLOADED DOCUMENTS: none parsed yet");
    expect(p).not.toContain("ABOUT ANSONIA");
  });

  it("puts the parsed documents ahead of the deal record", () => {
    const p = buildOutreachPrompt({
      templates: [{ title: "t", text: "x" }],
      dealFacts: "unit_count: 146",
      documents: ["T12 — t12.xlsx\nNOI 1200000"],
      companyBrief: "",
    });
    expect(p.indexOf("NOI 1200000")).toBeGreaterThan(-1);
    expect(p.indexOf("NOI 1200000")).toBeLessThan(p.indexOf("unit_count: 146"));
  });
});

describe("documentFactsBlock", () => {
  it("reads a T12's totals and category totals, not its months", () => {
    const block = documentFactsBlock({
      doc_type: "t12",
      file_name: "T12.xlsx",
      doc_as_of: "2026-08",
      figures: { noi_annual: { value: 1_200_000, evidence: "Net Operating Income 1,200,000" }, unit_count: { value: null } },
      summary: {
        t12: {
          months: ["2025-09"],
          period: "Sep 2025 – Aug 2026",
          total_income: 2_500_000,
          total_expenses: 1_300_000,
          noi: 1_200_000,
          t3_total_income: 2_600_000,
          t3_total_expenses: 1_320_000,
          t3_noi: 1_280_000,
          categories: [{ category: "payroll", annual: 300_000, t3_annualized: 310_000, lines: ["Salaries"] }],
        },
      },
    });
    expect(block.split("\n")[0]).toBe("T12 — T12.xlsx, as of 2026-08");
    expect(block).toContain('noi_annual: 1200000 ("Net Operating Income 1,200,000")');
    expect(block).not.toContain("unit_count");
    expect(block).toContain("NOI 1200000");
    expect(block).toContain("payroll: 300000 (T3 annualized 310000)");
    expect(block).not.toContain("Salaries");
  });

  it("drops a rent roll's expirations and keeps its unit mix", () => {
    const block = documentFactsBlock({
      doc_type: "rent_roll",
      file_name: "RR.pdf",
      doc_as_of: null,
      figures: null,
      summary: {
        rent_roll: {
          physical_occupancy_pct: 94.5,
          loss_to_lease_pct: 6.2,
          unit_mix: [{ beds: 2, units: 80 }],
          expirations: [{ month: "2026-11", count: 9 }],
          other_income_monthly: [],
        },
      },
    });
    expect(block).toContain('"loss_to_lease_pct":6.2');
    expect(block).toContain('"unit_mix":[{"beds":2,"units":80}]');
    expect(block).not.toContain("expirations");
  });

  it("is empty for a document with nothing read", () => {
    expect(documentFactsBlock({ doc_type: "om", file_name: "OM.pdf", doc_as_of: null, figures: null, summary: null })).toBe("");
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
