import { describe, expect, it } from "vitest";
import { cleanDraft, normalizeWebsite } from "../../supabase/functions/_shared/partnerImport";
import { findSimilarPartners, normalizeFirmName, notesToHtml } from "@/lib/partnerImport";

describe("cleanDraft", () => {
  it("turns blanks into nulls and drops values outside the option lists", () => {
    const d = cleanDraft({
      name: "  Acme Capital ",
      firm_type: "Hedge Fund",
      headquarters: "",
      website: "https://www.AcmeCap.com/team",
      relationship_strength: "Lukewarm",
      contacts: [],
    });
    expect(d).toEqual({
      name: "Acme Capital",
      firm_type: null,
      headquarters: null,
      website: "acmecap.com",
      relationship_strength: null,
      contacts: [],
    });
  });

  it("keeps a valid firm type and warmth", () => {
    const d = cleanDraft({ name: "X", firm_type: "Family Office", relationship_strength: "Warm", contacts: [] });
    expect(d.firm_type).toBe("Family Office");
    expect(d.relationship_strength).toBe("Warm");
  });

  it("drops empty contacts and bad emails, and collapses repeats", () => {
    const d = cleanDraft({
      name: "X",
      contacts: [
        { name: "Jane Smith", role: "MD", email: "Jane@AcmeCap.com", phone: "", linkedin_url: "", firm_location: "" },
        { name: "Jane S.", role: "", email: "jane@acmecap.com", phone: "", linkedin_url: "", firm_location: "" },
        { name: "", role: "Analyst", email: "", phone: "", linkedin_url: "", firm_location: "" },
        { name: "Bob", role: "", email: "not an email", phone: "212-555-0100", linkedin_url: "", firm_location: "" },
      ],
    });
    expect(d.contacts).toEqual([
      { name: "Jane Smith", role: "MD", email: "jane@acmecap.com", phone: null, linkedin_url: null, firm_location: null },
      { name: "Bob", role: null, email: null, phone: "212-555-0100", linkedin_url: null, firm_location: null },
    ]);
  });

  it("survives a missing or malformed answer", () => {
    expect(cleanDraft(null)).toEqual({
      name: null, firm_type: null, headquarters: null, website: null, relationship_strength: null, contacts: [],
    });
  });
});

describe("normalizeWebsite", () => {
  it("rejects things that are not domains", () => {
    expect(normalizeWebsite("n/a")).toBeNull();
    expect(normalizeWebsite("acme capital")).toBeNull();
    expect(normalizeWebsite("acme.co.uk")).toBe("acme.co.uk");
  });
});

describe("findSimilarPartners", () => {
  const partners = [
    { id: "1", name: "The Carlyle Group" },
    { id: "2", name: "Basis Investment Group, LLC" },
    { id: "3", name: "Capital Partners" },
    { id: "4", name: "JLL" },
  ];

  it("matches across suffixes and punctuation", () => {
    expect(normalizeFirmName("The Carlyle Group, L.P.")).toBe("carlyle");
    expect(findSimilarPartners("Carlyle", partners).map((p) => p.id)).toEqual(["1"]);
    expect(findSimilarPartners("Basis Investment", partners).map((p) => p.id)).toEqual(["2"]);
  });

  it("matches whole-word containment, not substrings", () => {
    expect(findSimilarPartners("Basis Investment Group Fund II", partners).map((p) => p.id)).toEqual(["2"]);
    expect(findSimilarPartners("Basisworks", partners)).toEqual([]);
  });

  it("does not match a short name inside a longer one", () => {
    expect(findSimilarPartners("JLL Income Property Trust", partners)).toEqual([]);
    expect(findSimilarPartners("JLL", partners).map((p) => p.id)).toEqual(["4"]);
  });
});

describe("notesToHtml", () => {
  it("escapes markup and keeps paragraphs and line breaks", () => {
    expect(notesToHtml("a <b>\nc\n\nd & e")).toBe("<p>a &lt;b&gt;<br/>c</p><p>d &amp; e</p>");
  });
});
