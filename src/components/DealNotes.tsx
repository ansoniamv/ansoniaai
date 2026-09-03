import { EntityNotes } from "@/components/EntityNotes";

export function DealNotes({ dealId }: { dealId: string }) {
  return <EntityNotes entityType="deal" entityId={dealId} className="md:col-span-2" />;
}
