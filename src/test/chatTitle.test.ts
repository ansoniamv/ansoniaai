import { describe, it, expect } from "vitest";
import {
  cleanTitle,
  fallbackTitle,
  legacyTitle,
  MAX_TITLE_CHARS,
  NEW_THREAD_TITLE,
  toTitleCase,
} from "../../supabase/functions/_shared/chatTitleText";

describe("toTitleCase", () => {
  it("capitalizes main words and keeps small words lowercase mid-title", () => {
    expect(toTitleCase("DRA deals in pipeline")).toBe("DRA Deals in Pipeline");
    expect(toTitleCase("Grandview exit price at Aviary")).toBe("Grandview Exit Price at Aviary");
    expect(toTitleCase("Cook County 60% affordable rents")).toBe("Cook County 60% Affordable Rents");
    expect(toTitleCase("Miami and Florida capital partners")).toBe("Miami and Florida Capital Partners");
  });

  it("capitalizes each part of a hyphenated word", () => {
    expect(toTitleCase("Peak State meeting follow-ups")).toBe("Peak State Meeting Follow-Ups");
  });

  it("capitalizes a small word when it is first or last", () => {
    expect(toTitleCase("in the pipeline")).toBe("In the Pipeline");
    expect(toTitleCase("what to follow up")).toBe("What to Follow Up");
  });

  it("lowercases a capitalized small word mid-title but keeps all-caps abbreviations", () => {
    expect(toTitleCase("Deals In Pipeline")).toBe("Deals in Pipeline");
    expect(toTitleCase("Partners ON Expansion")).toBe("Partners ON Expansion");
  });

  it("never lowercases existing capitals in other words", () => {
    expect(toTitleCase("SKY55 rent roll for CBRE")).toBe("SKY55 Rent Roll for CBRE");
    expect(toTitleCase("Skydeck Capital fit for 820 S")).toBe("Skydeck Capital Fit for 820 S");
  });

  it("leaves an ellipsis in place", () => {
    expect(toTitleCase("Capital partners tied to Berkshire…")).toBe("Capital Partners Tied to Berkshire…");
  });
});

describe("fallbackTitle", () => {
  it("keeps a short message whole, in Title Case", () => {
    expect(fallbackTitle("who is the new governor of texas")).toBe("Who Is the New Governor of Texas");
  });

  it("cuts a long message at a word boundary with an ellipsis, never mid-word", () => {
    const t = fallbackTitle("Meeting up with DRA what deals in our pipeline fit their criteria best");
    expect(t).toBe("Meeting up with DRA What Deals in Our…");
    expect(t.length).toBeLessThanOrEqual(MAX_TITLE_CHARS + 1);
  });

  it("flattens newlines and runs of spaces", () => {
    expect(fallbackTitle("  hello\n\n  there  ")).toBe("Hello There");
  });

  it("falls back to the placeholder for an empty message", () => {
    expect(fallbackTitle("   ")).toBe(NEW_THREAD_TITLE);
  });
});

describe("cleanTitle", () => {
  it("strips quotes, a 'Title:' prefix and ending punctuation", () => {
    expect(cleanTitle('"DRA deals in pipeline."')).toBe("DRA Deals in Pipeline");
    expect(cleanTitle("Title: Platform tour")).toBe("Platform Tour");
  });

  it("keeps proper names and acronyms as written", () => {
    expect(cleanTitle("grandview equity check")).toBe("Grandview Equity Check");
    expect(cleanTitle("SKY55 rent roll")).toBe("SKY55 Rent Roll");
  });

  it("caps at six words and the character limit", () => {
    expect(cleanTitle("one two three four five six seven eight")).toBe("One Two Three Four Five Six");
    const long = cleanTitle("Extraordinarily comprehensive multifamily underwriting assumptions review");
    expect(long!.length).toBeLessThanOrEqual(MAX_TITLE_CHARS + 1);
    expect(long!.endsWith("…")).toBe(true);
  });

  it("returns null for nothing usable, so the caller falls back", () => {
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle('  ""  ')).toBeNull();
    expect(cleanTitle(undefined)).toBeNull();
    expect(cleanTitle(42)).toBeNull();
  });
});

describe("legacyTitle", () => {
  it("matches the title the chat function used to save", () => {
    const msg = "what are the 60% affordable rents for column\nin Dallas and how do they compare";
    expect(legacyTitle(msg)).toBe(msg.slice(0, 60).replace(/\n/g, " "));
  });
});
