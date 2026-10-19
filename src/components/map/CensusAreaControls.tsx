import { NO_DATA_HEX } from "@/lib/mapLayers";
import { AREA_BY_ID, AREA_LAYERS, areaLegend, type AreaLayerId } from "@/lib/censusLayers";
import type { CensusAreaState } from "@/hooks/useCensusAreas";

function span(v: { start: number; end: number }): string {
  return `${v.start}–${String(v.end).slice(2)}`;
}

/**
 * The "shade the map" half of the layer panel: one census layer at a time, or
 * none, independent of what the pins are coloured by.
 */
export function CensusAreaControls({
  value, onChange, state, disabled,
}: {
  value: AreaLayerId | null;
  onChange: (id: AreaLayerId | null) => void;
  state: CensusAreaState;
  disabled?: boolean;
}) {
  const layer = value ? AREA_BY_ID.get(value) : undefined;
  const rows: Array<{ id: AreaLayerId | null; label: string; help?: string }> = [
    { id: null, label: "None" },
    ...AREA_LAYERS.map((l) => ({ id: l.id, label: l.label, help: l.help })),
  ];

  return (
    <>
      <div className="p-3 space-y-1 border-b border-hairline">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-medium">
            Shade areas · Census
          </span>
          {state.vintage && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              ACS {span(state.vintage)}
            </span>
          )}
        </div>
        {rows.map((r) => (
          <label
            key={r.id ?? "none"}
            htmlFor={"map-area-" + (r.id ?? "none")}
            title={r.help}
            className="flex items-center gap-2 text-xs cursor-pointer py-0.5"
          >
            <input
              type="radio"
              id={"map-area-" + (r.id ?? "none")}
              name="map-area"
              className="accent-primary h-3 w-3 shrink-0"
              checked={value === r.id}
              onChange={() => onChange(r.id)}
              disabled={disabled}
            />
            <span className="flex-1">{r.label}</span>
          </label>
        ))}
      </div>

      {layer && (
        <div className="p-3 space-y-1.5 border-b border-hairline">
          {areaLegend(layer).map((b) => (
            <div key={b.label} className="flex items-center gap-2 text-xs">
              <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: b.hex }} />
              <span className="text-muted-foreground tabular-nums">{b.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 text-xs">
            <span className="h-3 w-3 rounded-sm shrink-0 opacity-40" style={{ background: NO_DATA_HEX }} />
            <span className="text-muted-foreground">Not published</span>
          </div>

          <p className="text-[11px] text-muted-foreground pt-1 tabular-nums">
            {state.status === "error" ? (
              <span className="text-destructive">{state.error ?? "Census layer could not be loaded."}</span>
            ) : state.tooWide ? (
              "Zoom in to shade areas."
            ) : state.status === "loading" && state.inView === 0 ? (
              "Loading areas…"
            ) : (
              <>
                {state.level === "tract" ? "Tracts" : "Counties"} · {state.withValue} of {state.inView} in view
                {" "}{state.inView === 1 ? "has" : "have"} a value
                {state.status === "loading" ? " · updating…" : ""}
              </>
            )}
          </p>
          {layer.countyOnly && state.baselineVintage && state.vintage && (
            <p className="text-[11px] text-muted-foreground tabular-nums">
              ACS {span(state.baselineVintage)} → {span(state.vintage)}, annualised over{" "}
              {state.vintage.end - state.baselineVintage.end} years.
            </p>
          )}
          {!layer.countyOnly && state.level === "county" && (
            <p className="text-[11px] text-muted-foreground">Zoom in to a metro to see census tracts.</p>
          )}
          <p className="text-[11px] text-muted-foreground">{layer.help}</p>
        </div>
      )}
    </>
  );
}
