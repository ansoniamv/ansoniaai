import { Link } from "react-router-dom";
import { ExternalLink, Building2 } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { WarmthBadge } from "@/components/WarmthBadge";
import { EntityNotes } from "@/components/EntityNotes";
import { NoteComposerDialog } from "@/components/NoteComposerDialog";
import type { Partner } from "@/hooks/usePartners";

const formatEquityRange = (min: number | null, max: number | null) => {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `$${min}M – $${max}M`;
  if (min != null) return `$${min}M+`;
  return `Up to $${max}M`;
};

const getStrategies = (p: Partner) => {
  const s: string[] = [];
  if (p.strategy_value_add) s.push("Value-Add");
  if (p.strategy_core_plus) s.push("Core+");
  if (p.strategy_workforce) s.push("Workforce");
  if (p.strategy_affordable) s.push("Affordable");
  return s;
};

interface Props {
  partner: Partner;
  trigger: React.ReactNode;
}

export function PartnerQuickView({ partner: p, trigger }: Props) {
  const strategies = getStrategies(p);

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{p.name}</span>
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2 mt-1">
                {p.firm_type && <Badge variant="outline" className="text-[10px]">{p.firm_type}</Badge>}
                <WarmthBadge strength={p.relationship_strength} />
                {p.ansonia_poc && <span className="text-xs text-muted-foreground">POC: {p.ansonia_poc}</span>}
              </SheetDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to={`/partners/${p.id}`}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Full page
              </Link>
            </Button>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground text-center mb-3">
              Overview
            </h3>
            <div className="rounded-lg border bg-card/50 divide-y divide-border">
              <KVRow label="Equity range" value={formatEquityRange(p.min_equity_m, p.max_equity_m)} />
              <KVRow label="Hold period" value={p.hold_period?.length ? p.hold_period.join(", ") : "—"} />
              <KVRow label="Investor type" value={p.investor_type?.length ? p.investor_type.join(", ") : "—"} />
              <KVRow label="Product types" value={p.product_types?.length ? p.product_types.join(", ") : "—"} />
              <KVRow label="Geography" value={p.geography?.length ? p.geography.join(", ") : "—"} />
              <KVRow label="Strategy" value={strategies.length ? strategies.join(", ") : "—"} />
              <KVRow
                label="Site"
                value={[p.urban_infill && "Urban Infill", p.suburban && "Suburban"].filter(Boolean).join(", ") || "—"}
              />
            </div>
          </section>

          {p.additional_notes && (
            <section>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground text-center mb-2">
                Additional notes
              </h3>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{p.additional_notes}</p>
            </section>
          )}

          <Separator />

          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Notes</h3>
              <NoteComposerDialog
                presetEntity={{ entity_type: "partner", entity_id: p.id, label: p.name }}
              />
            </div>
            <EntityNotes entityType="partner" entityId={p.id} />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function KVRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm">
      <span className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">{label}</span>
      <span className="text-right min-w-0 truncate">{value}</span>
    </div>
  );
}

