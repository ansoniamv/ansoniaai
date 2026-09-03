import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import { MAX_TEARSHEET_DEALS, saveTearsheetPayload } from "@/lib/tearsheetPayload";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { Deal } from "@/hooks/useDeals";
import { usePartners } from "@/hooks/usePartners";
import { ACTIVE_STATUSES, getStatus } from "@/lib/dealStatus";
import { marketLabel } from "@/lib/partnerPipelineFit";

/**
 * Export the deals currently on screen — either as an internal Excel dump or
 * as a branded, client-facing tearsheet for one capital partner.
 */
export function ExportPipelineDialog({
  open,
  onOpenChange,
  deals,
  onInternalExport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The caller's CURRENTLY FILTERED deal set — the export must match the screen. */
  deals: Deal[];
  /** Today's internal Excel behaviour, if the caller has one. */
  onInternalExport?: (deals: Deal[]) => void;
}) {
  const [audience, setAudience] = useState<"partner" | "internal">("partner");
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [partnerQuery, setPartnerQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeOutside, setIncludeOutside] = useState(true);
  const [includeScore, setIncludeScore] = useState(false);

  const navigate = useNavigate();
  const { data: partners } = usePartners();


  const isActive = (d: Deal) => (ACTIVE_STATUSES as readonly string[]).includes(getStatus(d));
  const isOffMarket = (d: Deal) => (d as { marketed?: boolean | null }).marketed === false;

  // Default selection: active + on-market only.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(deals.filter((d) => isActive(d) && !isOffMarket(d)).map((d) => d.id)));
  }, [open, deals]);

  const filteredPartners = useMemo(() => {
    const q = partnerQuery.trim().toLowerCase();
    const list = (partners ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
    return list.slice(0, 40);
  }, [partners, partnerQuery]);

  const partner = useMemo(
    () => (partners ?? []).find((p) => p.id === partnerId) ?? null,
    [partners, partnerId],
  );

  const chosenDeals = useMemo(
    () => deals.filter((d) => selected.has(d.id)),
    [deals, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const capped = chosenDeals.slice(0, MAX_TEARSHEET_DEALS);
  const isCapped = chosenDeals.length > MAX_TEARSHEET_DEALS;

  const handlePreview = () => {
    if (!partnerId) return toast.error("Pick a capital partner first");
    if (!capped.length) return toast.error("Select at least one deal");
    // Client-side navigation only — a hard GET on this deep route can 500 before the app loads.
    const token = saveTearsheetPayload({
      partnerId,
      dealIds: capped.map((d) => d.id),
      showScore: includeScore,
      includeOutside,
    });
    onOpenChange(false);
    navigate(`/pipeline-tearsheet/${partnerId}?s=${token}`);
  };


  const handleInternalExcel = () => {
    if (!chosenDeals.length) return toast.error("Select at least one deal");
    if (onInternalExport) onInternalExport(chosenDeals);
    else toast.error("Internal export is not available on this view");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Export pipeline</DialogTitle>
          <DialogDescription>
            {deals.length} deal{deals.length === 1 ? "" : "s"} currently on screen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Audience */}
          <div>
            <Label className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Audience
            </Label>
            <RadioGroup
              value={audience}
              onValueChange={(v) => setAudience(v as "partner" | "internal")}
              className="mt-2 space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="partner" id="aud-partner" />
                <Label htmlFor="aud-partner" className="font-normal">
                  For a capital partner (branded tearsheet)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="internal" id="aud-internal" />
                <Label htmlFor="aud-internal" className="font-normal">
                  Internal export (Excel)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {audience === "partner" && (
            <div>
              <Label className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Partner
              </Label>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={partner && !partnerQuery ? partner.name : partnerQuery}
                  onChange={(e) => {
                    setPartnerQuery(e.target.value);
                    setPartnerId(null);
                  }}
                  placeholder="Search capital partners…"
                  className="h-9 pl-9 border-hairline"
                />
              </div>
              {partnerQuery.trim() && !partnerId && (
                <ScrollArea className="mt-1 max-h-40 rounded-sm border border-hairline">
                  {filteredPartners.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No partners found</div>
                  )}
                  {filteredPartners.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPartnerId(p.id);
                        setPartnerQuery("");
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      {p.name}
                    </button>
                  ))}
                </ScrollArea>
              )}
            </div>
          )}

          {/* Deals */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Checkbox
                  checked={
                    deals.length > 0 && deals.every((d) => selected.has(d.id))
                      ? true
                      : deals.some((d) => selected.has(d.id))
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={() =>
                    setSelected(
                      deals.length > 0 && deals.every((d) => selected.has(d.id))
                        ? new Set()
                        : new Set(deals.map((d) => d.id)),
                    )
                  }
                  aria-label={
                    deals.length > 0 && deals.every((d) => selected.has(d.id))
                      ? "Clear all deals"
                      : "Select all deals"
                  }
                />
                <Label className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Select all
                </Label>
              </div>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {selected.size} of {deals.length} selected
              </span>
            </div>
            <ScrollArea className="mt-2 h-52 rounded-sm border border-hairline">
              <div className="divide-y divide-hairline">
                {deals.map((d) => (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted/50"
                  >
                    <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} />
                    <span className="flex-1 truncate font-medium">{d.property_name}</span>
                    <span className="truncate text-muted-foreground">{marketLabel(d)}</span>
                    <Badge variant="outline" className="h-4 border-hairline px-1 text-[9px]">
                      {getStatus(d)}
                    </Badge>
                    {isOffMarket(d) && (
                      <Badge
                        variant="outline"
                        className="h-4 border-[#B7791F]/40 bg-[#B7791F]/10 px-1 text-[9px] text-[#B7791F]"
                      >
                        Off-market
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            </ScrollArea>
            {(() => {
              const offMarketSelected = deals.filter(
                (d) => (d as { marketed?: boolean | null }).marketed === false && selected.has(d.id),
              ).length;
              return (
                offMarketSelected > 0 && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                    {offMarketSelected} off-market {offMarketSelected === 1 ? "deal is" : "deals are"}{" "}
                    included — these may be under NDA. Uncheck any that should not leave the firm.
                  </p>
                )
              );
            })()}
          </div>


          {audience === "partner" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="opt-outside" className="font-normal text-sm">
                  Include deals outside their box (with reasons)
                </Label>
                <Switch id="opt-outside" checked={includeOutside} onCheckedChange={setIncludeOutside} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="opt-score" className="font-normal text-sm">
                  Include our fit score
                </Label>
                <Switch id="opt-score" checked={includeScore} onCheckedChange={setIncludeScore} />
              </div>
            </div>
          )}

          {audience === "partner" && isCapped && (
            <p className="text-[11px] text-muted-foreground">
              Showing the first {MAX_TEARSHEET_DEALS} — narrow the filters for a shorter list.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          {audience === "partner" ? (
            <Button onClick={handlePreview} disabled={!chosenDeals.length} title={!chosenDeals.length ? "Select at least one deal" : undefined}>
              <Printer className="mr-1.5 h-4 w-4" />
              Open tearsheet (PDF)

            </Button>
          ) : (
            <Button onClick={handleInternalExcel}>
              <Download className="mr-1.5 h-4 w-4" />
              Download Excel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
