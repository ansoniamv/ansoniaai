import { format } from "date-fns";
import { Share2 } from "lucide-react";
import { useLastPipelineExport } from "@/hooks/usePipelineExports";

/** "Last shared: 12 deals on Aug 14 by Maxym" — so nobody re-sends the same list blind. */
export function PipelineSharedLine({ partnerId }: { partnerId: string }) {
  const { data } = useLastPipelineExport(partnerId);
  if (!data) return null;
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Share2 className="h-3 w-3" />
      <span>
        Pipeline shared: {data.deal_count} deal{data.deal_count === 1 ? "" : "s"} on{" "}
        {format(new Date(data.exported_at), "MMM d")}
        {data.exporter_name ? ` by ${data.exporter_name}` : ""}
      </span>
    </div>
  );
}
