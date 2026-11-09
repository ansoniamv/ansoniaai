import { describe, it, expect } from "vitest";
import { signWebhook, verifyFathomWebhook } from "../../supabase/functions/_shared/fathomWebhook";
import { encryptSecret, decryptSecret } from "../../supabase/functions/_shared/fathomCrypto";
import {
  chunkTranscript,
  matchPartners,
  meetingRow,
} from "../../supabase/functions/_shared/fathomIngest";
import { FathomClient, authorizeUrl } from "../../supabase/functions/_shared/fathomApi";

const SECRET = "whsec_" + btoa("0123456789abcdef0123456789abcdef");
const KEY = btoa(String.fromCharCode(...new Array(32).fill(7)));

describe("verifyFathomWebhook", () => {
  const id = "msg_2x2zwLOcWaRTzsLK8KtbQt1FTk9";
  const ts = "1712345678";
  const body = '{"recording_id":1}';

  it("matches the Standard Webhooks reference vector", async () => {
    // Test vector from the Standard Webhooks spec (svix), which Fathom's
    // signature format follows.
    const sig = await signWebhook(
      "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
      "msg_p5jXN8AQM9LWM0D4loKWxJek",
      "1614265330",
      '{"test": 2432232314}',
    );
    expect(sig).toBe("g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("accepts a valid signature, including among several", async () => {
    const sig = await signWebhook(SECRET, id, ts, body);
    const base = { secret: SECRET, id, timestamp: ts, body, nowSeconds: 1712345678 };
    expect(await verifyFathomWebhook({ ...base, signatureHeader: `v1,${sig}` })).toBe(true);
    expect(await verifyFathomWebhook({ ...base, signatureHeader: `v1,bm9wZQ== v1,${sig}` })).toBe(true);
  });

  it("refuses a tampered body, wrong version, missing header, or stale timestamp", async () => {
    const sig = await signWebhook(SECRET, id, ts, body);
    const base = { secret: SECRET, id, timestamp: ts, nowSeconds: 1712345678 };
    expect(await verifyFathomWebhook({ ...base, body: body + " ", signatureHeader: `v1,${sig}` })).toBe(false);
    expect(await verifyFathomWebhook({ ...base, body, signatureHeader: `v2,${sig}` })).toBe(false);
    expect(await verifyFathomWebhook({ ...base, body, signatureHeader: null })).toBe(false);
    expect(
      await verifyFathomWebhook({ ...base, body, signatureHeader: `v1,${sig}`, nowSeconds: 1712345678 + 301 }),
    ).toBe(false);
    expect(
      await verifyFathomWebhook({ ...base, timestamp: "", body, signatureHeader: `v1,${sig}`, nowSeconds: 0 }),
    ).toBe(false);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and uses a fresh IV each time", async () => {
    const a = await encryptSecret("refresh-token-123", KEY);
    const b = await encryptSecret("refresh-token-123", KEY);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(await decryptSecret(a, KEY)).toBe("refresh-token-123");
  });

  it("fails on the wrong key or a tampered value", async () => {
    const enc = await encryptSecret("x", KEY);
    const other = btoa(String.fromCharCode(...new Array(32).fill(8)));
    await expect(decryptSecret(enc, other)).rejects.toThrow();
    const flipped = enc.slice(0, -2) + (enc.slice(-2) === "AA" ? "AB" : "AA");
    await expect(decryptSecret(flipped, KEY)).rejects.toThrow();
  });

  it("refuses a key that is not 32 bytes", async () => {
    await expect(encryptSecret("x", btoa("short"))).rejects.toThrow(/32 bytes/);
  });
});

describe("chunkTranscript", () => {
  const line = (speaker: string, text: string, timestamp: string) => ({
    speaker: { display_name: speaker },
    text,
    timestamp,
  });

  it("keeps speakers and the first timestamp, and splits only between lines", () => {
    const items = [
      line("Jane Doe", "a".repeat(50), "00:00:05"),
      line("Max V", "b".repeat(50), "00:00:20"),
      line("Jane Doe", "c".repeat(50), "00:01:00"),
    ];
    const chunks = chunkTranscript(items, 130);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ seq: 0, speakers: "Jane Doe, Max V", start_ts: "00:00:05" });
    expect(chunks[0].content).toBe(`Jane Doe: ${"a".repeat(50)}\nMax V: ${"b".repeat(50)}`);
    expect(chunks[1]).toMatchObject({ seq: 1, speakers: "Jane Doe", start_ts: "00:01:00" });
  });

  it("skips empty lines and keeps an oversized line whole", () => {
    const chunks = chunkTranscript(
      [line("A", "  ", "00:00:01"), line("B", "x".repeat(300), "00:00:02")],
      100,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(`B: ${"x".repeat(300)}`);
  });

  it("returns nothing for an empty transcript", () => {
    expect(chunkTranscript([])).toEqual([]);
  });
});

describe("matchPartners", () => {
  const contacts = [
    { partner_id: "p-barings", email: "Ann@Barings.com" },
    { partner_id: "p-pccp", email: "bob@pccp.com" },
    { partner_id: "p-solo", email: "solo.investor@gmail.com" },
    { partner_id: "p-ours", email: "someone@ansoniaproperties.com" },
  ];

  it("matches exact emails, then partner domains", () => {
    expect(
      matchPartners(
        [
          { email: "ann@barings.com" },
          { email: "new.person@pccp.com" },
          { email: "max@ansoniaproperties.com" },
        ],
        contacts,
      ),
    ).toEqual(["p-barings", "p-pccp"]);
  });

  it("matches a free-mail contact only by exact email, never by domain", () => {
    expect(matchPartners([{ email: "stranger@gmail.com" }], contacts)).toEqual([]);
    expect(matchPartners([{ email: "solo.investor@gmail.com" }], contacts)).toEqual(["p-solo"]);
  });

  it("never matches by our own domain", () => {
    expect(matchPartners([{ email: "daniel@ansoniaproperties.com" }], contacts)).toEqual([]);
  });

  it("ignores invitees without an email", () => {
    expect(matchPartners([{ name: "Dial-in", email: null }], contacts)).toEqual([]);
  });
});

describe("meetingRow", () => {
  it("prefers the calendar title and the actual recording times", () => {
    const row = meetingRow({
      recording_id: 42,
      title: "Impromptu Zoom Meeting",
      meeting_title: "Barings intro",
      share_url: "https://fathom.video/share/x",
      created_at: "2026-11-01T17:01:30Z",
      scheduled_start_time: "2026-11-01T16:00:00Z",
      recording_start_time: "2026-11-01T16:01:12Z",
      calendar_invitees: [{ name: "Ann", email: "ann@barings.com", is_external: true }],
      recorded_by: { name: "Max", email: "max@ansoniaproperties.com" },
    });
    expect(row).toMatchObject({
      recording_id: 42,
      title: "Barings intro",
      started_at: "2026-11-01T16:01:12Z",
      recorded_by_name: "Max",
      share_url: "https://fathom.video/share/x",
      invitees: [{ name: "Ann", email: "ann@barings.com", is_external: true }],
    });
  });
});

describe("FathomClient", () => {
  it("sends the API key header and the external-only filter", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 });
    }) as unknown as typeof fetch;
    await new FathomClient({ kind: "api_key", key: "k" }, fetchImpl).listMeetings({
      since: "2026-10-10T00:00:00Z",
      withContent: true,
    });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/external/v1/meetings");
    expect(url.searchParams.get("calendar_invitees_domains_type")).toBe("one_or_more_external");
    expect(url.searchParams.get("include_transcript")).toBe("true");
    expect((calls[0].init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
  });

  it("retries a 429 after Retry-After, then gives up with the status", async () => {
    let n = 0;
    const waits: number[] = [];
    const fetchImpl = (async () => {
      n++;
      return new Response("", { status: 429, headers: { "Retry-After": "3" } });
    }) as unknown as typeof fetch;
    const client = new FathomClient({ kind: "bearer", token: "t" }, fetchImpl, async (ms) => {
      waits.push(ms);
    });
    await expect(client.getSummary(1)).rejects.toMatchObject({ status: 429 });
    expect(n).toBe(3);
    expect(waits).toEqual([3000, 3000]);
  });

  it("builds the authorize URL the SDK builds", () => {
    const url = new URL(authorizeUrl("cid", "https://ansoniaai.vercel.app/integrations/fathom/callback", "s1"));
    expect(url.origin + url.pathname).toBe("https://fathom.video/external/v1/oauth2/authorize");
    expect(url.searchParams.get("scope")).toBe("public_api");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("s1");
  });
});
