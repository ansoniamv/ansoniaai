import { describe, expect, it } from "vitest";
import { senderMailboxUpn } from "../../supabase/functions/_shared/senderMailbox";

describe("senderMailboxUpn", () => {
  it("takes a company address as the mailbox, lower-cased", () => {
    expect(senderMailboxUpn(" PVdovets@AnsoniaProperties.com ", "ansoniaproperties.com")).toBe(
      "pvdovets@ansoniaproperties.com",
    );
  });

  it("refuses an address outside the company domain", () => {
    expect(senderMailboxUpn("someone@gmail.com", "ansoniaproperties.com")).toBeNull();
    expect(senderMailboxUpn("x@evil-ansoniaproperties.com", "ansoniaproperties.com")).toBeNull();
  });

  it("refuses a missing or malformed address", () => {
    expect(senderMailboxUpn(null, "ansoniaproperties.com")).toBeNull();
    expect(senderMailboxUpn("ansoniaproperties.com", "ansoniaproperties.com")).toBeNull();
    expect(senderMailboxUpn("a b@ansoniaproperties.com", "ansoniaproperties.com")).toBeNull();
  });
});
