import { describe, it, expect } from "vitest";
import {
  cleanTitle,
  fallbackTitle,
  legacyTitle,
  MAX_TITLE_CHARS,
  NEW_THREAD_TITLE,
} from "../../supabase/functions/_shared/chatTitleText";

describe("fallbackTitle", () => {
  it("keeps a short message whole, capitalized", () => {
    expect(fallbackTitle("who is the new governor of texas")).toBe("Who is the new governor of texas");
  });

  it("cuts a long message at a word boundary with an ellipsis, never mid-word", () => {
    const t = fallbackTitle("Meeting up with DRA what deals in our pipeline fit their criteria best");
    expect(t).toBe("Meeting up with DRA what deals in our…");
    expect(t.length).toBeLessThanOrEqual(MAX_TITLE_CHARS + 1);
  });

  it("flattens newlines and runs of spaces", () => {
    expect(fallbackTitle("  hello\n\n  there  ")).toBe("Hello there");
  });

  it("falls back to the placeholder for an empty message", () => {
    expect(fallbackTitle("   ")).toBe(NEW_THREAD_TITLE);
  });
});

describe("cleanTitle", () => {
  it("strips quotes, a 'Title:' prefix and ending punctuation", () => {
    expect(cleanTitle('"DRA deals in pipeline."')).toBe("DRA deals in pipeline");
    expect(cleanTitle("Title: Platform tour")).toBe("Platform tour");
  });

  it("keeps proper names as written and capitalizes the first letter", () => {
    expect(cleanTitle("grandview equity check")).toBe("Grandview equity check");
    expect(cleanTitle("SKY55 rent roll")).toBe("SKY55 rent roll");
  });

  it("caps at six words and the character limit", () => {
    expect(cleanTitle("one two three four five six seven eight")).toBe("One two three four five six");
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
