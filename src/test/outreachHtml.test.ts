import { describe, expect, it } from "vitest";
import { fillTokensHtml, outreachEmailHtml, outreachTextToHtml, unfilledPlaceholders } from "@/lib/outreachDraft";

describe("outreachTextToHtml", () => {
  it("turns paragraphs and * bullets into paragraphs and a list", () => {
    const text = "Hey {{contact_first_name}} –\n\nReaching out about A & B.\n\n1900 at Canterfield Overview\n* 260 units, 2018 vintage\n* T12 NOI: ~$3.48M\n\nThanks,\nMax";
    expect(outreachTextToHtml(text)).toBe(
      "<p>Hey {{contact_first_name}} –</p>" +
        "<p>Reaching out about A &amp; B.</p>" +
        "<p>1900 at Canterfield Overview</p>" +
        "<ul><li><p>260 units, 2018 vintage</p></li><li><p>T12 NOI: ~$3.48M</p></li></ul>" +
        "<p>Thanks,<br>Max</p>",
    );
  });

  it("reads - bullets and a line after the list", () => {
    expect(outreachTextToHtml("- one\n- two\nafter")).toBe(
      "<ul><li><p>one</p></li><li><p>two</p></li></ul><p>after</p>",
    );
  });

  it("keeps [[placeholders]] findable", () => {
    expect(unfilledPlaceholders(outreachTextToHtml("* CFO: [[CFO date]]"))).toEqual(["CFO date"]);
  });
});

describe("fillTokensHtml", () => {
  it("escapes the values it fills in", () => {
    expect(fillTokensHtml("<p>Hi {{partner_name}}</p>", { partner_name: "A & <B>" })).toBe(
      "<p>Hi A &amp; &lt;B&gt;</p>",
    );
  });
});

describe("outreachEmailHtml", () => {
  it("keeps empty paragraphs as blank lines", () => {
    expect(outreachEmailHtml("<p>a</p><p></p><p>b</p>")).toContain("<p>a</p><p><br></p><p>b</p>");
  });
});
