import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookDraft, type OutlookSession } from "@/lib/outlookMail";

const session = { token: "tok", account: { username: "max@ansoniaproperties.com" } } as OutlookSession;

afterEach(() => vi.unstubAllGlobals());

describe("createOutlookDraft", () => {
  it("creates an HTML draft in the signed-in person's own mailbox", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "m1", webLink: "https://outlook.office365.com/x" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await createOutlookDraft(session, { to: ["anna@dra.com"], subject: "Hi", html: "<p>Hey</p>" });

    expect(r).toEqual({ id: "m1", webLink: "https://outlook.office365.com/x" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      subject: "Hi",
      body: { contentType: "HTML", content: "<p>Hey</p>" },
      toRecipients: [{ emailAddress: { address: "anna@dra.com" } }],
    });
  });

  it("surfaces Microsoft's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Access is denied." } }), { status: 403 }),
      ),
    );
    await expect(createOutlookDraft(session, { to: ["a@b.com"], subject: "s", html: "h" })).rejects.toThrow(
      "Outlook refused the draft: Access is denied.",
    );
  });
});
