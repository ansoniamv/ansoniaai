import { describe, expect, it } from "vitest";
import {
  documentFor,
  isUnderwritingAttachment,
  parseCaResult,
  runStatusFor,
} from "../../supabase/functions/_shared/dealAgents";

const att = (name: string, size = 200_000, contentType = "application/pdf") => ({ name, size, contentType });

describe("isUnderwritingAttachment", () => {
  it("takes OMs, rent rolls and T12s", () => {
    expect(isUnderwritingAttachment(att("Judson OM.pdf"))).toBe(true);
    expect(isUnderwritingAttachment(att("Rent Roll 10.31.26.xlsx"))).toBe(true);
    expect(isUnderwritingAttachment(att("T12 Sep-26.xls"))).toBe(true);
  });
  it("skips the executed CA and Texas IABS forms", () => {
    expect(isUnderwritingAttachment(att("Executed Confidentiality Agreement.pdf"))).toBe(false);
    expect(isUnderwritingAttachment(att("Information About Brokerage Services.pdf"))).toBe(false);
    expect(isUnderwritingAttachment(att("Judson - CA.pdf"))).toBe(false);
    expect(isUnderwritingAttachment(att("IABS - MFA.pdf"))).toBe(false);
  });
  it("skips images, inline parts and tiny files", () => {
    expect(isUnderwritingAttachment(att("image001.png", 50_000, "image/png"))).toBe(false);
    expect(isUnderwritingAttachment({ ...att("OM.pdf"), isInline: true })).toBe(false);
    expect(isUnderwritingAttachment(att("OM.pdf", 1_000))).toBe(false);
  });
  it("does not mistake 'Canterfield' or 'Capital' for a CA", () => {
    expect(isUnderwritingAttachment(att("Canterfield T12.xlsx"))).toBe(true);
    expect(isUnderwritingAttachment(att("Capital Markets OM.pdf"))).toBe(true);
  });
});

describe("parseCaResult", () => {
  it("reads a signed run", () => {
    const r = parseCaResult(JSON.stringify({
      outcome: "signed",
      platform: "rcm",
      ca: { standard: true, summary: "Standard 2-year CA", flags: [] },
      documents: [{ file: "docs/OM.pdf", doc_type: "om", title: "Offering Memorandum" }],
    }));
    expect(r.outcome).toBe("signed");
    expect(r.standard).toBe(true);
    expect(r.documents).toHaveLength(1);
  });
  it("treats garbage as a failed run, never a signed one", () => {
    expect(parseCaResult("{not json").outcome).toBe("failed");
    expect(parseCaResult(null).outcome).toBe("failed");
    expect(parseCaResult(JSON.stringify({ outcome: "done!" })).outcome).toBe("failed");
  });
  it("drops document paths that climb out of outputs", () => {
    const r = parseCaResult(JSON.stringify({ outcome: "signed", documents: [{ file: "../../etc/passwd", doc_type: "om" }] }));
    expect(r.documents).toHaveLength(0);
  });
  it("drops flags without a quote", () => {
    const r = parseCaResult(JSON.stringify({ outcome: "needs_approval", ca: { flags: [{ clause: "Non-circumvention" }] } }));
    expect(r.flags).toHaveLength(0);
  });
});

describe("runStatusFor", () => {
  const base = parseCaResult(JSON.stringify({ outcome: "signed", ca: { standard: true } }));
  it("closes a clean signed run", () => {
    expect(runStatusFor(base, false).status).toBe("done");
  });
  it("surfaces a signed run that also carries flags", () => {
    const flagged = { ...base, flags: [{ clause: "Non-solicit", quote: "shall not solicit", why: "3 years" }] };
    expect(runStatusFor(flagged, false).status).toBe("needs_attention");
    expect(runStatusFor(flagged, true).status).toBe("done");
  });
  it("holds a flagged CA for approval", () => {
    expect(runStatusFor({ ...base, outcome: "needs_approval" }, false).status).toBe("needs_approval");
  });
});

describe("documentFor", () => {
  const docs = [{ file: "docs/Brighton Creek OM.pdf", doc_type: "om" as const, title: "OM" }];
  it("matches by path suffix or base name", () => {
    expect(documentFor("docs/Brighton Creek OM.pdf", docs)?.doc_type).toBe("om");
    expect(documentFor("Brighton Creek OM.pdf", docs)?.doc_type).toBe("om");
    expect(documentFor("docs/other.pdf", docs)).toBeNull();
  });
});
