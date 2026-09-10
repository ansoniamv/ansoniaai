import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motionOff, useReveal } from "@/hooks/useReveal";

/**
 * Public marketing page for Atlas AI, served at "/" to signed-out visitors.
 * Signed-in users never see this — App.tsx renders the Ansonia-branded
 * dashboard at the same path instead.
 *
 * Palette is restricted to the two Ansonia brand colours already defined as
 * tokens in index.css — #002752 (navy, --primary) and #6AA3D8 (sky, --accent)
 * — plus the existing neutral ramp. No third hue is introduced.
 *
 * Motion is opt-out by construction: the reveal states live behind a
 * data-reveal attribute that only useReveal writes, so no-JS and
 * reduced-motion visitors get the finished page. See src/hooks/useReveal.ts.
 */

const NAVY = "#002752";
const SKY = "#6AA3D8";

// ── Brand assets ──────────────────────────────────────────────────────────
// Both paths live here so replacing an asset is a one-line change. A
// higher-resolution / SVG mark is expected; swapping ATLAS_MARK_SRC is all it
// should take.
const ATLAS_MARK_SRC = "/brand/atlas-mark.png";
const SKYLINE_SRC = "/brand/chicago-skyline.webp";

// The current mark is 119x124 and was recovered from a screenshot, so it has no
// resolution to spare: never render it above 40px tall, and never upscale it.
// 32px sits inside the permitted 24-40px window with room on both sides.
const MARK_H = "h-8";

/** Sky-blue hairline tracking scroll position. The only thing that moves persistently. */
function ScrollProgress() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (motionOff()) return; // CSS hides the bar too; this skips the listener as well
    let raf = 0;
    const write = () => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
      ref.current?.style.setProperty("--scroll-progress", p.toFixed(4));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(write); };

    write();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={ref} aria-hidden className="scroll-progress" />;
}

type BlockProps = { children: ReactNode; className?: string; style?: CSSProperties };

/** Reveals its whole subtree as one unit when it scrolls into view. */
function Reveal({ children, className, style }: BlockProps) {
  const ref = useReveal<HTMLDivElement>();
  return <div ref={ref} className={className} style={style}>{children}</div>;
}

/** Reveals its direct children in DOM order. One observer, CSS does the stagger. */
function RevealGroup({ children, className, style, stagger = 90 }: BlockProps & { stagger?: number }) {
  const ref = useReveal<HTMLDivElement>({ children: true, stagger });
  return <div ref={ref} className={className} style={style}>{children}</div>;
}

/**
 * Logo mark. Placed, never modified: no filter, recolour, crop, rotation or
 * shadow. Height is set and width left auto — the source is 119x124, so
 * forcing a square would stretch it ~4%, which is a modification.
 */
function AtlasMark({ heightClass = MARK_H }: { heightClass?: string }) {
  return (
    <img
      src={ATLAS_MARK_SRC}
      alt=""
      aria-hidden
      width={119}
      height={124}
      className={`${heightClass} w-auto shrink-0 select-none`}
      // Until the asset is dropped in, hide the element rather than show a
      // broken-image glyph. The wordmark still carries the brand.
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

/**
 * Mark + wordmark lockup. 16px, so the two read as one lockup rather than as
 * a mark and a separate word. The Ansonia guidelines set no clear-space rule
 * around the mark — they require it be placed unmodified and set a minimum
 * width for the linear wordmark — so this spacing is a design choice.
 */
function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <AtlasMark />
      <span
        className="font-mono text-sm tracking-[0.28em] font-medium"
        style={{ color: dark ? "#FFFFFF" : NAVY }}
      >
        ATLAS AI
      </span>
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-muted-foreground mb-4">
      {children}
    </p>
  );
}

export default function LandingPage() {
  // Hero animates on mount, never on scroll — it is the first thing painted.
  const navRef = useReveal<HTMLElement>({ immediate: true });
  // indexOffset 1 continues the sequence the nav starts: nav 0ms, headline
  // 70ms, subhead 140, body 210, CTA row 280. The photograph never animates.
  const heroCopyRef = useReveal<HTMLDivElement>({
    immediate: true, children: true, stagger: 70, indexOffset: 1,
  });

  // Smooth anchor scrolling, scoped to this page. Setting scroll-behavior on
  // <html> globally would also change the signed-in app's programmatic
  // scrolls, so the class goes on at mount and comes off at unmount.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("landing-smooth");
    return () => root.classList.remove("landing-smooth");
  }, []);

  return (
    <div className="bg-background text-foreground">
      <ScrollProgress />

      {/* ───────────────────────── Hero ─────────────────────────
          Sized to its content, never 100vh. The navy base sits under the
          photograph so that if the image is missing (or still loading) the
          scrim colour is what shows — text never lands on bare photo. */}
      <header className="relative isolate overflow-hidden" style={{ backgroundColor: NAVY }}>
        {/* 1377x687 WebP. bg-cover + bg-bottom keeps the skyline and waterline
            in frame at every width; past ~1400px it simply scales and the
            scrim carries the contrast rather than chasing crispness. The navy
            on the parent shows through if the file is absent. Deliberately
            outside every reveal: no fade, no zoom, no parallax. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-bottom bg-no-repeat"
          style={{ backgroundImage: `url('${SKYLINE_SRC}')` }}
        />
        {/* Bottom-heavy scrim: near-opaque navy where the copy sits, clearing
            toward the top so the skyline and waterline stay legible. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            // Stops chosen against measured contrast, not by eye. All hero copy
            // is white, which clears 4.5:1 from 65% scrim upward, so the top can
            // stay light enough for the skyline to read while the copy zone
            // still lands comfortably above AA (9.7:1 at 38%, 12.9:1 at 68%).
            background:
              `linear-gradient(to bottom, ${NAVY}A6 0%, ${NAVY}D6 38%, ${NAVY}F0 68%, ${NAVY}FA 100%)`,
          }}
        />

        <div className="relative mx-auto w-full max-w-6xl px-6 pt-8 pb-24 sm:pb-28 lg:pb-32">
          <nav ref={navRef} className="flex items-center justify-between">
            <Wordmark dark />
            {/* Full white, not white/80: the scrim is at its lightest here and
                80% measured 3.30:1 against a bright sky pixel — below AA. */}
            <Link
              to="/auth"
              className="font-mono text-[11px] tracking-[0.18em] uppercase text-white hover:opacity-80 transition-opacity"
            >
              Sign in
            </Link>
          </nav>

          <div ref={heroCopyRef} className="mt-20 sm:mt-28 lg:mt-36 max-w-3xl">
            <h1 className="font-serif text-white text-4xl sm:text-5xl lg:text-6xl leading-[1.08] tracking-tight">
              Deal flow to capital flow, in one system.
            </h1>
            {/* White, not sky. Sky measures only 4.55:1 over the brightest part
                of the photograph and needs a 92% scrim to clear AA — which would
                wash the skyline out. Sky stays the accent on solid-navy surfaces
                (CTA, footer, diagram), where it measures 5.55:1. */}
            <p className="mt-6 text-lg sm:text-xl text-white/95">
              The acquisitions operating system for boutique multifamily private equity.
            </p>
            <p className="mt-6 max-w-2xl text-base sm:text-lg leading-relaxed text-white/80">
              A boutique multifamily shop runs two pipelines that never talk to each other — the
              deals coming in, and the capital that would take them. Atlas AI is where both live:
              inbound flow scored against your buybox, tracked through IC, and matched to the
              partners who actually want it.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4">
              <a
                href="mailto:MVasylechko@ansoniaproperties.com?subject=Atlas%20AI%20walkthrough"
                className="inline-flex items-center justify-center px-7 h-12 rounded-[3px] font-mono text-[12px] tracking-[0.14em] uppercase font-medium transition-colors"
                style={{ backgroundColor: SKY, color: NAVY }}
              >
                Request a walkthrough
              </a>
              <a
                href="#the-seam"
                className="inline-flex items-center justify-center px-7 h-12 rounded-[3px] border font-mono text-[12px] tracking-[0.14em] uppercase text-white/90 hover:text-white hover:border-white/60 transition-colors"
                style={{ borderColor: "rgba(255,255,255,0.35)" }}
              >
                See how it works
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* ───────────────────────── The seam ───────────────────────── */}
      <section id="the-seam" className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28 scroll-mt-8">
        <Reveal>
          <Eyebrow>The seam</Eyebrow>
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-[2.75rem] leading-[1.15] tracking-tight max-w-4xl">
            The expensive failure isn't a missed email. It's a live deal with no call list.
          </h2>
          <p className="mt-6 max-w-3xl text-base sm:text-lg leading-relaxed text-muted-foreground">
            Deal pipeline software tracks assets. Investor software tracks LPs. Neither owns the
            handoff between them — and at a six-person firm, the person sourcing the deal is the
            person raising against it. That handoff is where weeks disappear: reconstructing who is
            warm, who has dry powder, and who already passed on Phoenix twice and why.
          </p>
        </Reveal>

        <SeamDiagram />
      </section>

      {/* ───────────────────── Four pillars ───────────────────── */}
      <section className="border-t" style={{ borderColor: "hsl(var(--hairline))" }}>
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <Reveal>
            <Eyebrow>What it does</Eyebrow>
            <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">Four pillars, one record</h2>
          </Reveal>

          {/* DOM order is reading order: top-left, top-right, bottom-left, bottom-right. */}
          <RevealGroup
            className="mt-12 grid gap-px sm:grid-cols-2"
            style={{ backgroundColor: "hsl(var(--hairline))" }}
          >
            <Pillar
              n="01"
              title="Capture & screen"
              body="The shared acquisitions mailbox is ingested and parsed automatically. Every deal is scored against your buybox on arrival and tiered. Nothing dies in a folder."
            />
            <Pillar
              n="02"
              title="Pipeline management"
              body="Stage, status, owner, next action, decision history. Dashboards that answer what's live, what's stalled, and what we passed on — with the reason attached."
            />
            <Pillar
              n="03"
              title="Capital partner intelligence"
              body="Every engaged firm as a living record: check size, geography, product type, structure preference, relationship warmth, last touch, and the full history of what they've seen and how they responded."
            />
            <Pillar
              n="04"
              title="Deal-to-partner matching"
              moat
              body="A deal clears IC and Atlas returns a ranked call list: who fits, who's warm, who's deploying, who already passed on something similar. Outreach is drafted; a person approves and sends. Nothing auto-fires."
            />
          </RevealGroup>

          <Reveal>
            <p className="mt-8 text-sm sm:text-base text-muted-foreground max-w-3xl">
              Pillars 1–3 are each sold on their own by someone. Pillar 4 only exists when all three
              sit in the same database.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ───────────────────── Buybox ───────────────────── */}
      <section className="border-t" style={{ borderColor: "hsl(var(--hairline))" }}>
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <Reveal>
            <Eyebrow>Your buybox, encoded</Eyebrow>
            <h2 className="font-serif text-3xl sm:text-4xl tracking-tight max-w-3xl">
              Screening criteria stop living in someone's head.
            </h2>
          </Reveal>

          {/* One unit. Six criteria revealing in sequence is exactly the
              over-animation this page is meant to avoid. */}
          <Reveal
            className="mt-10 max-w-2xl border rounded-[3px] overflow-hidden"
            style={{ borderColor: "hsl(var(--hairline))" }}
          >
            <div
              className="px-5 py-3 border-b font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground"
              style={{ borderColor: "hsl(var(--hairline))", backgroundColor: "hsl(var(--muted))" }}
            >
              Example configuration
            </div>
            <ul className="p-5 space-y-2.5 font-mono text-[13px] leading-relaxed">
              {[
                "150+ units, value-add",
                "1990s–2010s vintage",
                "In-place rents 10%+ below market",
                "New supply < 5% of inventory",
                "Population & job growth above national average",
                "Median household income ≥ $55,000",
              ].map((line) => (
                <li key={line} className="flex gap-3">
                  <span aria-hidden style={{ color: SKY }}>—</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal>
            <p className="mt-5 max-w-2xl text-sm text-muted-foreground">
              Every firm's buybox is different. Yours gets configured during onboarding, and every
              inbound deal is scored against it automatically.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ───────────────────── Where we sit ───────────────────── */}
      <section className="border-t" style={{ borderColor: "hsl(var(--hairline))" }}>
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <Reveal>
            <Eyebrow>Where we sit</Eyebrow>
            <h2 className="font-serif text-3xl sm:text-4xl tracking-tight max-w-3xl">
              Two categories exist. The seam between them doesn't.
            </h2>
          </Reveal>

          {/* Left to right, so the navy Atlas AI lane lands last. */}
          <RevealGroup className="mt-12 grid gap-6 lg:grid-cols-3">
            <Lane
              title="Deal pipeline platforms"
              body="Own the asset workflow. Enterprise-priced, enterprise-implemented, and blind to who would fund the deal."
            />
            <Lane
              title="Investor & LP platforms"
              body="Own reporting, distributions and the data room. They start after the capital is already committed."
            />
            <Lane
              title="Atlas AI"
              body="The only place a scored deal and a ranked, warmth-aware partner list are the same query."
              ours
            />
          </RevealGroup>
        </div>
      </section>

      {/* ───────────────────── Built for ───────────────────── */}
      <section className="border-t" style={{ borderColor: "hsl(var(--hairline))" }}>
        <Reveal className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <Eyebrow>Built for boutique shops</Eyebrow>
          <dl className="grid gap-px sm:grid-cols-2 lg:grid-cols-4" style={{ backgroundColor: "hsl(var(--hairline))" }}>
            {[
              ["Firm", "US multifamily PE sponsors, $50M–$1B AUM"],
              ["Team", "2–10 person acquisitions group"],
              ["Volume", "500–3,000 inbound OMs a year"],
              ["Buyer", "Principal or Head of Acquisitions"],
            ].map(([k, v]) => (
              <div key={k} className="bg-background p-6">
                <dt className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{k}</dt>
                <dd className="mt-2 text-sm leading-relaxed">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 font-serif text-xl sm:text-2xl tracking-tight max-w-2xl">
            Too small for an enterprise build-out. Too big for Excel and Outlook folders.
          </p>
        </Reveal>
      </section>

      {/* ───────────────────── Trust ───────────────────── */}
      <section className="border-t" style={{ borderColor: "hsl(var(--hairline))" }}>
        <Reveal className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28 grid gap-10 sm:grid-cols-3">
          {[
            ["Human-approved by default.", "Atlas proposes; a person decides. Nothing sends itself."],
            ["Your data is yours.", "Per-tenant isolation, with capital-partner data walled off."],
            ["Built by operators.", "Designed inside an active acquisitions shop, against real deal flow."],
          ].map(([lead, rest]) => (
            <div key={lead}>
              <div aria-hidden className="h-px w-10 mb-5" style={{ backgroundColor: SKY }} />
              <p className="text-base leading-relaxed">
                <span className="font-medium">{lead}</span>{" "}
                <span className="text-muted-foreground">{rest}</span>
              </p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* ───────────────────── Footer ───────────────────── */}
      <footer style={{ backgroundColor: NAVY }}>
        <Reveal className="mx-auto w-full max-w-6xl px-6 py-14 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-8">
          <div>
            <Wordmark dark />
            <p className="mt-4 text-sm text-white/70 max-w-md">
              The acquisitions operating system for boutique multifamily private equity.
            </p>
          </div>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-white/50">
            An Ansonia Properties company
          </p>
        </Reveal>
      </footer>
    </div>
  );
}

function Pillar({ n, title, body, moat = false }: { n: string; title: string; body: string; moat?: boolean }) {
  return (
    <div
      // reveal-inner: the card holds its own background while its contents
      // move, so the grid's hairline never shows through mid-reveal.
      className="reveal-inner p-7 sm:p-8 relative"
      style={{ backgroundColor: moat ? `${SKY}1F` : "hsl(var(--background))" }}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">{n}</span>
        {moat && (
          <span
            className="font-mono text-[9px] tracking-[0.2em] uppercase px-2 py-1 rounded-[2px]"
            style={{ backgroundColor: NAVY, color: "#FFFFFF" }}
          >
            The moat
          </span>
        )}
      </div>
      <h3 className="mt-4 font-serif text-xl sm:text-2xl tracking-tight">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Lane({ title, body, ours = false }: { title: string; body: string; ours?: boolean }) {
  return (
    <div
      className="p-7 rounded-[3px] border h-full"
      style={
        ours
          ? { backgroundColor: NAVY, borderColor: NAVY }
          : { borderColor: "hsl(var(--hairline))" }
      }
    >
      <h3
        className="font-serif text-xl tracking-tight"
        style={ours ? { color: "#FFFFFF" } : undefined}
      >
        {title}
      </h3>
      <p
        className="mt-3 text-sm leading-relaxed"
        style={{ color: ours ? "rgba(255,255,255,0.78)" : "hsl(var(--muted-foreground))" }}
      >
        {body}
      </p>
    </div>
  );
}

const DEAL = ["Inbound OMs", "Buybox score", "Comps & enrich", "Stage & IC decision"];
const CAPITAL = ["Engaged firms", "Appetite & check size", "Warmth & last touch", "Pass history"];

const DIAGRAM_LABEL =
  "Two lanes converge on a matching engine. The deal-flow lane runs inbound OMs, buybox score, " +
  "comps and enrichment, then stage and IC decision. The capital-flow lane runs engaged firms, " +
  "appetite and check size, warmth and last touch, then pass history. Both feed a human-approved " +
  "matching engine, which outputs a ranked call list.";

// The sky lane draws a beat behind the navy one.
const SKY_LANE: CSSProperties = { "--lane-delay": "150ms" } as CSSProperties;

/**
 * The two-lane convergence diagram. Inline SVG on wide screens; on narrow
 * screens the lanes stack as text rather than shrinking to illegibility. The
 * aria-label describes the finished diagram and is accurate at every point of
 * the animation, including before it starts.
 */
function SeamDiagram() {
  return (
    <div className="mt-14">
      <SeamDiagramWide />
      <SeamDiagramNarrow />
    </div>
  );
}

function SeamDiagramWide() {
  // reveal-draw keeps the container itself from fading — its parts animate.
  const ref = useReveal<HTMLDivElement>();

  return (
    <div ref={ref} className="reveal-draw hidden md:block">
      {/* viewBox leaves room for the outermost labels. */}
      <svg role="img" aria-label={DIAGRAM_LABEL} viewBox="0 0 1000 300" className="w-full h-auto">
        <defs>
          <marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path className="arrow-head" d="M0,0 L8,4 L0,8 z" fill="currentColor" />
          </marker>
        </defs>

        {/* Deal-flow lane */}
        <text className="draw-fade font-mono" x="0" y="26" fontSize="11" letterSpacing="2.5" fill="currentColor" opacity="0.55">
          DEAL FLOW
        </text>
        {DEAL.map((t, i) => (
          <g key={t} transform={`translate(${i * 168}, 44)`} color={NAVY}>
            <rect className="draw-fade" width="152" height="42" rx="2" fill="none" stroke={NAVY} strokeWidth="1.25" />
            <text className="draw-fade" x="76" y="26" textAnchor="middle" fontSize="12.5" fill={NAVY}>{t}</text>
            {i < DEAL.length - 1 && (
              // pathLength normalises every segment to one unit, so a 14px
              // connector and a 90px curve draw at the same rate.
              <line className="lane-seg" pathLength={1} x1="152" y1="21" x2="166" y2="21" stroke={NAVY} strokeWidth="1.25" markerEnd="url(#ah)" />
            )}
          </g>
        ))}

        {/* Capital-flow lane */}
        <text className="draw-fade font-mono" x="0" y="212" fontSize="11" letterSpacing="2.5" fill="currentColor" opacity="0.55">
          CAPITAL FLOW
        </text>
        {CAPITAL.map((t, i) => (
          <g key={t} transform={`translate(${i * 168}, 228)`} color={SKY}>
            <rect className="draw-fade" width="152" height="42" rx="2" fill="none" stroke={SKY} strokeWidth="1.25" />
            <text className="draw-fade" x="76" y="26" textAnchor="middle" fontSize="12.5" fill={NAVY}>{t}</text>
            {i < CAPITAL.length - 1 && (
              <line className="lane-seg" style={SKY_LANE} pathLength={1} x1="152" y1="21" x2="166" y2="21" stroke={SKY} strokeWidth="1.25" markerEnd="url(#ah)" />
            )}
          </g>
        ))}

        {/* Convergence into the matching engine */}
        <g color={NAVY}>
          <path className="lane-seg" pathLength={1} d="M676,86 C740,112 740,124 762,138" fill="none" stroke={NAVY} strokeWidth="1.25" markerEnd="url(#ah)" />
        </g>
        <g color={SKY}>
          <path className="lane-seg" style={SKY_LANE} pathLength={1} d="M676,228 C740,202 740,190 762,172" fill="none" stroke={SKY} strokeWidth="1.25" markerEnd="url(#ah)" />
        </g>

        <rect className="draw-fade" x="770" y="128" width="150" height="54" rx="2" fill={NAVY} />
        <text className="draw-fade" x="845" y="149" textAnchor="middle" fontSize="12.5" fill="#FFFFFF">Matching engine</text>
        <text className="draw-fade" x="845" y="167" textAnchor="middle" fontSize="10.5" fill={SKY}>human-approved</text>

        <g color={NAVY}>
          <line className="lane-seg" pathLength={1} x1="920" y1="155" x2="944" y2="155" stroke={NAVY} strokeWidth="1.25" markerEnd="url(#ah)" />
        </g>
        <text className="draw-fade" x="1000" y="150" textAnchor="end" fontSize="12.5" fill={NAVY} fontWeight="500">Ranked</text>
        <text className="draw-fade" x="1000" y="167" textAnchor="end" fontSize="12.5" fill={NAVY} fontWeight="500">call list</text>
      </svg>
    </div>
  );
}

/** Narrow: stacked, full-size text, and a plain group reveal — no line drawing. */
function SeamDiagramNarrow() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <div ref={ref} className="md:hidden space-y-8" role="img" aria-label={DIAGRAM_LABEL}>
      <StackLane title="Deal flow" steps={DEAL} color={NAVY} />
      <StackLane title="Capital flow" steps={CAPITAL} color={SKY} />
      <div className="rounded-[3px] p-5 text-center" style={{ backgroundColor: NAVY }}>
        <p className="text-sm text-white">Matching engine</p>
        <p className="mt-1 font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: SKY }}>
          human-approved
        </p>
      </div>
      <p className="text-center font-serif text-lg tracking-tight">↓ Ranked call list</p>
    </div>
  );
}

function StackLane({ title, steps, color }: { title: string; steps: string[]; color: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-3">{title}</p>
      <ul className="space-y-2">
        {steps.map((s) => (
          <li
            key={s}
            className="border rounded-[2px] px-4 py-3 text-sm"
            style={{ borderColor: color }}
          >
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}
