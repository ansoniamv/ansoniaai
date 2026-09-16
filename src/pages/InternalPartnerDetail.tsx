/**
 * The internal desk — what /partners/:id renders when the record is one of our
 * own (partners.is_internal = true) rather than an outside capital source.
 *
 * Reached only from PartnerDetail's `partner.is_internal` guard, which is why
 * the partner arrives as a prop: the parent has already loaded and narrowed it.
 *
 * Deliberately absent, because none of it applies to ourselves: capital status,
 * relationship warmth, AI enrichment / summary regeneration, archiving,
 * PartnerSuggestionsSection, WarmthSignalsPanel, CapitalStatusCard,
 * PartnerLearningPanel, the investment-criteria editor, and the contacts card.
 */
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, StickyNote, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

import { EntityNotes } from "@/components/EntityNotes";
import { FloatingPanel } from "@/components/FloatingPanel";
import { PartnerAttachmentsCard } from "@/components/PartnerAttachmentsCard";
import { InternalComingInCard } from "@/components/internal/InternalComingInCard";
import { InternalAtlasFeedCard } from "@/components/internal/InternalAtlasFeedCard";
import { InternalOpenItemsCard } from "@/components/internal/InternalOpenItemsCard";
import type { Partner } from "@/hooks/usePartners";
import { useState } from "react";

/**
 * Brand pair from the theme: navy #002752 text on light blue #6aa3d8, the
 * combination index.css calls out as AA-contrast safe.
 */
/** Section heading for a reused card that brings its own header. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#002752]">
      {children}
    </div>
  );
}

function InternalBadge() {
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] bg-[#6aa3d8] text-[#002752]">
      Internal
    </span>
  );
}

export default function InternalPartnerDetail({ partner }: { partner: Partner }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [notesOpen, setNotesOpen] = useState(false);

  const goBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate("/partners");
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2 mb-1 h-7 px-2 text-muted-foreground">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5 flex-wrap">
            <Building2 className="h-5 w-5 text-[#002752] shrink-0" />
            <span className="truncate">{partner.name}</span>
            <InternalBadge />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Our own desk — deal flow, the Atlas feed, notes and open items. Not an outside capital
            source, so there is no capital status, warmth or investment criteria here.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setNotesOpen(true)} className="shrink-0">
          <StickyNote className="h-3.5 w-3.5 mr-1.5" /> Notes
        </Button>
      </div>

      <InternalComingInCard />

      <InternalAtlasFeedCard />

      {/*
        Important Notes and Files reuse EntityNotes / PartnerAttachmentsCard
        unchanged. Both render their own Card with their own header, so they get
        a section label above rather than a wrapper Card around (which would nest
        one card inside another). Notes land in the same `notes` table under
        entity_type 'partner', exactly as on the external profile.
      */}
      <div className="space-y-2">
        <SectionLabel>Important Notes</SectionLabel>
        <EntityNotes entityType="partner" entityId={partner.id} />
      </div>

      <div className="space-y-2">
        <SectionLabel>Files</SectionLabel>
        <PartnerAttachmentsCard partnerId={partner.id} />
      </div>

      <InternalOpenItemsCard partnerId={partner.id} />

      <FloatingPanel
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <StickyNote className="h-4 w-4" /> Notes · {partner.name}
          </span>
        }
        storageKey={`partner-notes-panel:${partner.id}`}
        defaultWidth={480}
        defaultHeight={620}
      >
        <EntityNotes
          entityType="partner"
          entityId={partner.id}
          className="border-0 shadow-none rounded-none"
        />
      </FloatingPanel>
    </div>
  );
}
