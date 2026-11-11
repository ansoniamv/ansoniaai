import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FloatingPanel, clampToViewport } from "@/components/FloatingPanel";

describe("FloatingPanel opening with a saved off-screen spot", () => {
  const KEY = "partner-notes-panel:pccp";

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    Object.assign(window, { innerWidth: 1366, innerHeight: 768 });
  });

  const panel = () => screen.getByText("Notes · PCCP").closest(".fixed") as HTMLElement;

  it("opens on screen even though the saved position is off it", () => {
    localStorage.setItem(`${KEY}:pos`, JSON.stringify({ x: 2400, y: 1300 }));
    localStorage.setItem(`${KEY}:size`, JSON.stringify({ w: 480, h: 620 }));
    render(
      <FloatingPanel open onClose={() => {}} title="Notes · PCCP" storageKey={KEY}>
        <button>Add Note</button>
      </FloatingPanel>,
    );
    const left = parseFloat(panel().style.left);
    const top = parseFloat(panel().style.top);
    expect(left + 480).toBeLessThanOrEqual(1366);
    expect(top + 620).toBeLessThanOrEqual(768);
  });

  it("opens restored when it was left minimized, so Add Note is visible", () => {
    localStorage.setItem(`${KEY}:min`, "1");
    render(
      <FloatingPanel open onClose={() => {}} title="Notes · PCCP" storageKey={KEY}>
        <button>Add Note</button>
      </FloatingPanel>,
    );
    expect(screen.getByText("Add Note")).toBeInTheDocument();
  });
});

const size = { w: 480, h: 620 };
const laptop = { w: 1366, h: 768 };

describe("clampToViewport", () => {
  it("leaves a position that already fits alone", () => {
    expect(clampToViewport({ x: 100, y: 100 }, size, laptop)).toEqual({ x: 100, y: 100 });
  });

  it("pulls back a spot saved on a bigger monitor", () => {
    // Saved at the bottom-right of a 2560x1440 screen, reopened on a laptop.
    const p = clampToViewport({ x: 2048, y: 788 }, size, laptop);
    expect(p.x + size.w).toBeLessThanOrEqual(laptop.w);
    expect(p.y + size.h).toBeLessThanOrEqual(laptop.h);
  });

  it("pulls back a spot dragged off the top-left", () => {
    expect(clampToViewport({ x: -300, y: -50 }, size, laptop)).toEqual({ x: 8, y: 8 });
  });

  it("brings the Add Note button up when only the header was on screen", () => {
    // Dragging allows the header down to innerHeight - 40, leaving the body below the fold.
    const p = clampToViewport({ x: 200, y: laptop.h - 40 }, size, laptop);
    expect(p.y + size.h).toBeLessThanOrEqual(laptop.h);
  });

  it("fits a panel bigger than the window (it renders at 95% of the viewport)", () => {
    const p = clampToViewport({ x: 500, y: 500 }, { w: 3000, h: 3000 }, laptop);
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.x + laptop.w * 0.95).toBeLessThanOrEqual(laptop.w);
    expect(p.y + laptop.h * 0.95).toBeLessThanOrEqual(laptop.h);
  });

  it("recovers from a corrupt saved position", () => {
    const p = clampToViewport({ x: null as unknown as number, y: NaN }, size, laptop);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(p.x + size.w).toBeLessThanOrEqual(laptop.w);
  });
});
