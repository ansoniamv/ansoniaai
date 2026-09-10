# Brand assets

Two files belong here. Both paths are defined as constants at the top of
`src/pages/LandingPage.tsx` (`ATLAS_MARK_SRC`, `SKYLINE_SRC`), so replacing
either is a one-line change.

## `atlas-mark.png` — the blue "A"

Placed, never modified: no recolour, crop, rotation, drop shadow, or CSS
filter.

The current file is **119×124px, recovered from a screenshot** (background
keyed to transparent), so it has no resolution to spare:

- Rendered at **32px tall** (`MARK_H` in LandingPage.tsx) — inside the
  permitted 24–40px window.
- **Never upscale it.** Do not raise `MARK_H` above `h-10` (40px).
- Height is set and width left `auto`. The source is not square, so forcing a
  square would stretch it ~4% — a modification.
- Clear space of at least its own height on all sides; the lockup gap matches
  the rendered height.

When a higher-resolution or SVG source arrives, drop it in and update
`ATLAS_MARK_SRC`. The size ceiling can be lifted at the same time.

## `chicago-skyline.webp` — the hero background

1377×687 WebP, anchored bottom-centre so the skyline and waterline stay in
frame at every breakpoint. Beyond ~1400px it scales and the navy scrim carries
the contrast rather than chasing crispness.

A solid navy (`#002752`) sits behind it, so a missing file yields the scrim
colour rather than a gap — text is never stranded on bare photo.

## Until these are added

The landing page still renders correctly: the hero falls back to solid navy
and the mark hides itself rather than showing a broken-image glyph. It is not
launch-ready without them, but nothing breaks and no code change is required.
