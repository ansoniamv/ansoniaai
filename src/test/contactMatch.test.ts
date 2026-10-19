import { describe, expect, it } from "vitest";
import {
  findContactByName,
  resolveContact,
  splitFullName,
} from "../../supabase/functions/_shared/contactMatch";

// Shapes taken from live partner_suggestions that were filed as
// "Add X — possible duplicate of X (different email)" and, once approved,
// inserted a second row for the same person.
const intervest = [
  { id: "hutton", name: "Will Hutton", email: "c.dirutigliano@intervest.com" },
  { id: "other", name: "Carla Dirutigliano", email: null },
];

describe("resolveContact", () => {
  it("treats a known name writing from a new firm address as an email change", () => {
    const r = resolveContact(intervest, { name: "Will Hutton", email: "w.hutton@intervest.com" }, ["intervest.com"]);
    expect(r).toEqual({ kind: "name", contact: intervest[0] });
  });

  it("matches nicknames (William ↔ Will)", () => {
    const r = resolveContact(intervest, { name: "William Hutton", email: "w.hutton@intervest.com" }, []);
    expect(r.kind).toBe("name");
  });

  it("accepts the stored email's own domain even when no firm domains are passed", () => {
    const r = resolveContact(intervest, { name: "Will Hutton", email: "w.hutton@intervest.com" }, []);
    expect(r.kind).toBe("name");
  });

  it("does not overwrite a work email with an off-domain namesake", () => {
    const r = resolveContact(intervest, { name: "Will Hutton", email: "willhutton@gmail.com" }, ["intervest.com"]);
    expect(r.kind).toBe("lookalike");
  });

  it("prefers an exact email match over everything else", () => {
    const r = resolveContact(intervest, { name: "Someone Else", email: "C.Dirutigliano@intervest.com" }, []);
    expect(r).toEqual({ kind: "email", contact: intervest[0] });
  });

  it("matches by name when no email is proposed (signature-only details)", () => {
    const r = resolveContact(intervest, { name: "Will Hutton", email: null }, []);
    expect(r.kind).toBe("name");
  });

  it("fills an email on a contact stored with none, when the address is on a firm domain", () => {
    const r = resolveContact(intervest, { name: "Carla Dirutigliano", email: "c.d@intervest.com" }, ["intervest.com"]);
    expect(r).toEqual({ kind: "name", contact: intervest[1] });
  });

  it("returns none for a genuinely new person", () => {
    const r = resolveContact(intervest, { name: "Jane Doe", email: "j.doe@intervest.com" }, ["intervest.com"]);
    expect(r.kind).toBe("none");
  });

  it("refuses an ambiguous name rather than guessing which row to overwrite", () => {
    const twins = [
      { id: "a", name: "Will Hutton", email: "a@intervest.com" },
      { id: "b", name: "Will Hutton", email: "b@intervest.com" },
    ];
    expect(resolveContact(twins, { name: "Will Hutton", email: "c@intervest.com" }, ["intervest.com"]).kind).toBe("none");
  });
});

describe("splitFullName", () => {
  it("reads Outlook's 'Last, First Middle' form", () => {
    expect(splitFullName("Smith, Payton Larson")).toEqual({ first: "payton", last: "smith" });
    expect(findContactByName(
      [{ id: "p", name: "Payton Larson Smith", email: "payton.larson.smith@barings.com" }],
      "Smith, Payton Larson",
    )?.id).toBe("p");
  });
});
