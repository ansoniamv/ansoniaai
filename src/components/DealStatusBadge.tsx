import { Badge } from "@/components/ui/badge";
import type { DealStatus } from "@/lib/dealStatus";

const statusStyles: Record<DealStatus, string> = {
  "New": "bg-slate-500/15 text-slate-700 border-slate-500/30",
  "Screening": "bg-sky-500/15 text-sky-700 border-sky-500/30",
  "On Hold/Tracking": "bg-purple-500/15 text-purple-700 border-purple-500/30",
  "Underwriting": "bg-indigo-500/15 text-indigo-800 border-indigo-500/30",
  "B&F": "bg-amber-500/15 text-amber-700 border-amber-500/30",
  "Under Contract": "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  "Pass": "bg-red-500/15 text-red-700 border-red-500/30",
};

export function DealStatusBadge({ status }: { status: DealStatus }) {
  return (
    <Badge variant="outline" className={statusStyles[status]}>
      {status}
    </Badge>
  );
}
