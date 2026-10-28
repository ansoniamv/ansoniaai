import { describe, expect, it } from "vitest";
import { outreachAddressees, type OutreachContact } from "@/lib/outreachRecipients";

const c = (id: string, over: Partial<OutreachContact> = {}): OutreachContact => ({
  id,
  name: id,
  email: `${id}@firm.com`,
  is_primary: false,
  always_cc: false,
  ...over,
});

describe("outreachAddressees", () => {
  it("addresses the default contact, not the first one", () => {
    const { to } = outreachAddressees([c("anna"), c("bart", { is_primary: true })]);
    expect(to?.id).toBe("bart");
  });

  it("falls back to the first contact with an email when there is no default", () => {
    const { to } = outreachAddressees([c("noemail", { email: " " }), c("anna"), c("bart")]);
    expect(to?.id).toBe("anna");
  });

  it("skips a default contact that has no email", () => {
    const { to } = outreachAddressees([c("bart", { is_primary: true, email: null }), c("anna")]);
    expect(to?.id).toBe("anna");
  });

  it("a picked contact overrides the default", () => {
    const { to } = outreachAddressees([c("anna"), c("bart", { is_primary: true })], "anna");
    expect(to?.id).toBe("anna");
  });

  it("CCs always-CC contacts but never the To contact", () => {
    const list = [c("bart", { is_primary: true }), c("anna", { always_cc: true }), c("joe", { always_cc: true, email: null })];
    expect(outreachAddressees(list).cc.map((x) => x.id)).toEqual(["anna"]);
    expect(outreachAddressees(list, "anna").cc.map((x) => x.id)).toEqual([]);
  });

  it("returns no To when nobody has an email", () => {
    expect(outreachAddressees([c("anna", { email: null })])).toEqual({ to: null, cc: [] });
  });
});
