import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Resets scroll to the top on every route change.
 *
 * Belt-and-suspenders: some pages use `window` as the scroller, others use the
 * AppLayout `<main>` container, and a few nested sections have their own
 * `overflow-auto` wrappers. We reset all of them, disable the browser's
 * automatic scroll restoration, and run the reset again on the next two frames
 * so content that mounts asynchronously (Suspense, data-driven layouts) can't
 * leave the page scrolled mid-way.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    const reset = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      document
        .querySelectorAll<HTMLElement>("main, [data-scroll-root]")
        .forEach((el) => {
          el.scrollTop = 0;
          el.scrollLeft = 0;
        });
    };
    reset();
    const r1 = requestAnimationFrame(() => {
      reset();
      const r2 = requestAnimationFrame(reset);
      (reset as any)._r2 = r2;
    });
    const t = window.setTimeout(reset, 120);
    return () => {
      cancelAnimationFrame(r1);
      window.clearTimeout(t);
    };
  }, [pathname]);

  return null;
}
