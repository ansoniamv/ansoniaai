import { describe, expect, it } from "vitest";
import {
  extractLinks,
  findCaLinks,
  findCaLinksInThread,
  platformFor,
  unwrapSafeLink,
} from "../../supabase/functions/_shared/caLinks";

const safe = (url: string) =>
  `https://nam10.safelinks.protection.outlook.com/?url=${encodeURIComponent(url)}&amp;data=05%7C02%7Cacq&amp;reserved=0`;

// Trimmed from real acquisitions-inbox emails (Nov 2026).
const RCM_BLAST = `
<div>Having trouble viewing this email? <a href="${safe("https://my.rcm1.com/handler/email.aspx?pv=abc")}">View online instead</a>.</div>
<td><a href="${safe("https://my.rcm1.com/buyer/agreement?pv=cPlG4rX")}" style="text-decoration:none"><strong>SIGN CONFIDENTIALITY AGREEMENT</strong></a></td>
<td><a href="${safe("https://my.rcm1.com/handler/modern.aspx?pv=cPlG4rX")}"><b>PROPERTY WEBSITE</b></a></td>
<a href="${safe("https://www.walkerdunlop.com/")}">Kansas City</a>
<a href="${safe("https://my.rcm1.com/buyer/unsubscribe?pv=cPlG4rX")}">Unsubscribe</a>`;

const CBRE_PERSONAL = `
<p>The CA and Flyer Links are below.</p>
<p><a href="${safe("https://www.cbredealflow.com/buyer/agreement?pv=JRMEX")}">CA Link</a></p>
<p><a href="${safe("https://www.cbredealflow.com/buyer/brochure?pv=JRMEX")}">Listing Flyer</a></p>
<a href="mailto:john.jaeger@cbre.com">john.jaeger@cbre.com</a>
<a href="${safe("https://www.cbre.com/about/privacy-policy")}">CBRE – Privacy Policy.</a>`;

const NO_CA = `<p>Guidance is $16.5m or 110k/door.</p><a href="${safe("https://www.northmarq.com/")}">northmarq.com</a>`;

describe("unwrapSafeLink", () => {
  it("returns the wrapped URL", () => {
    expect(unwrapSafeLink(safe("https://my.rcm1.com/buyer/agreement?pv=x"))).toBe("https://my.rcm1.com/buyer/agreement?pv=x");
  });
  it("leaves plain URLs alone", () => {
    expect(unwrapSafeLink("https://crexi.com/properties/1")).toBe("https://crexi.com/properties/1");
  });
});

describe("extractLinks", () => {
  it("keeps anchor text and drops mailto", () => {
    const links = extractLinks(CBRE_PERSONAL);
    expect(links.map((l) => l.text)).toContain("CA Link");
    expect(links.some((l) => l.url.startsWith("mailto"))).toBe(false);
  });
  it("reads plain-text emails", () => {
    const links = extractLinks("Sign the CA here:\nhttps://app.buildout.com/website/123/ca\nThanks");
    expect(links[0].url).toBe("https://app.buildout.com/website/123/ca");
  });
});

describe("platformFor", () => {
  it("recognises RCM on a broker's own domain by its path", () => {
    expect(platformFor("https://www.cbredealflow.com/buyer/agreement?pv=1")).toBe("rcm");
  });
  it("falls back to the host", () => {
    expect(platformFor("https://app.buildout.com/x")).toBe("buildout");
    expect(platformFor("https://example.com/x")).toBe("other");
  });
});

describe("findCaLinks", () => {
  it("finds the RCM CA button and the property website", () => {
    const { ca, dealRoom } = findCaLinks(RCM_BLAST);
    expect(ca?.url).toBe("https://my.rcm1.com/buyer/agreement?pv=cPlG4rX");
    expect(ca?.platform).toBe("rcm");
    expect(dealRoom.map((d) => d.url)).toEqual(["https://my.rcm1.com/handler/modern.aspx?pv=cPlG4rX"]);
  });
  it("finds a bare 'CA Link' in a broker's personal email", () => {
    const { ca } = findCaLinks(CBRE_PERSONAL);
    expect(ca?.url).toBe("https://www.cbredealflow.com/buyer/agreement?pv=JRMEX");
  });
  it("finds nothing in a reply without a CA", () => {
    expect(findCaLinks(NO_CA).ca).toBeNull();
  });
  it("never takes an unsubscribe link", () => {
    const { ca } = findCaLinks(`<a href="https://x.com/unsubscribe/agreement">Unsubscribe from this agreement</a>`);
    expect(ca).toBeNull();
  });
});

describe("findCaLinksInThread", () => {
  it("takes the first email that carries a CA", () => {
    const { ca } = findCaLinksInThread([NO_CA, CBRE_PERSONAL, RCM_BLAST]);
    expect(ca?.url).toContain("cbredealflow.com");
  });
});
