import { useLayoutEffect, useRef } from "react";

/**
 * Scroll-triggered reveals for the marketing page.
 *
 * The hidden state is never the CSS default. This hook is the only thing in the
 * app that writes `data-reveal`, and it writes nothing at all when the visitor
 * has asked for reduced motion or when IntersectionObserver is missing. So the
 * no-JS render, the crawler render and the reduced-motion render are all the
 * finished page — there is no path where an observer failing to fire leaves
 * content invisible.
 *
 * Follows the IntersectionObserver pattern already used in DealPipelinePage.
 */

const ROOT_MARGIN = "0px 0px -12% 0px";
const THRESHOLD = 0.15;

/** True when motion should be skipped entirely and content rendered final. */
export function motionOff(): boolean {
  if (typeof window === "undefined") return true;
  if (typeof IntersectionObserver === "undefined") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Whether the element overlaps the viewport right now. Checked before the first
 * paint so anything already on screen skips the animation completely rather
 * than fading in a beat after the visitor can already read it.
 */
function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return r.bottom > 0 && r.top < vh;
}

/**
 * The page carries responsive twins — the seam diagram has a wide SVG and a
 * narrow stacked version, one of which is always display:none. A hidden
 * element has no box, so it never intersects and would sit pending forever;
 * if the visitor then resized across the breakpoint it would appear blank.
 * Leave anything with no layout box in its finished state.
 */
function hasBox(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

type RevealOptions = {
  /**
   * Reveal the element's direct children instead of the element itself. One
   * observer watches the container; the children separate in time through a
   * CSS transition-delay, not through extra observers or timers.
   */
  children?: boolean;
  /** Reveal on mount rather than on scroll. The hero uses this. */
  immediate?: boolean;
  /** Per-child stagger in ms. Written as a CSS variable; CSS does the maths. */
  stagger?: number;
  /** Shifts the first child's stagger index, so a sequence can span two containers. */
  indexOffset?: number;
};

export function useReveal<T extends HTMLElement = HTMLDivElement>(options: RevealOptions = {}) {
  const { children = false, immediate = false, stagger, indexOffset = 0 } = options;
  const ref = useRef<T | null>(null);

  // Layout effect rather than effect: the pending state has to land before the
  // browser paints. On a plain effect the finished state shows for one frame
  // and then hides itself, which reads as a flicker.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || motionOff()) return;

    const targets: HTMLElement[] = children
      ? Array.from(root.children).filter((n): n is HTMLElement => n instanceof HTMLElement)
      : [root];
    if (targets.length === 0) return;

    if (stagger != null) {
      targets.forEach((el, i) => {
        el.style.setProperty("--i", String(i + indexOffset));
        el.style.setProperty("--reveal-stagger", `${stagger}ms`);
      });
    }

    const hide = () => targets.forEach((el) => { el.dataset.reveal = "pending"; });
    const show = () => targets.forEach((el) => { el.dataset.reveal = "shown"; });

    if (immediate) {
      hide();
      // Two frames: the first paints the pending state, the second starts the
      // transition. Flipping both in one frame skips the animation.
      let inner = 0;
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(show); });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }

    if (!hasBox(root)) return;  // hidden at this breakpoint — leave it final
    if (onScreen(root)) return; // already readable — leave it final and static

    hide();

    // threshold 0.15 assumes a section shorter than ~6.7 viewports; every
    // section here is well inside that, so the callback always arrives.
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        show();
        io.unobserve(entry.target); // one-shot: nothing re-animates on the way back up
      }
    }, { rootMargin: ROOT_MARGIN, threshold: THRESHOLD });

    io.observe(root);
    return () => io.disconnect();
  }, [children, immediate, stagger, indexOffset]);

  return ref;
}
