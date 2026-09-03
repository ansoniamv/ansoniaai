import { FileText, ChevronDown, AlertCircle } from "lucide-react";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type NoteSection = {
  title: string;
  notes: string[];
};

const platformWideNotes: NoteSection = {
  title: "Platform-Wide UX Standards",
  notes: [
    "Single-click a cell to edit inline; double-click a row to open the record detail page.",
    "Excel-like keyboard navigation: Tab/Shift-Tab to move between columns, Arrow keys to move around, Ctrl+Arrow to jump to edges (first/last column, first/last row), Enter or F2 to start editing, Escape to cancel.",
    "Typing on an active cell starts editing immediately (like a spreadsheet).",
    "Columns are show/hide toggleable; selection persists in localStorage.",
    "Columns are drag-and-drop reorderable with visual drop indicators; order persists in localStorage.",
    "Columns are resizable by dragging header edges; widths persist in localStorage.",
    "Property/Name column text is left-aligned; all other columns are center-aligned.",
    "Fullscreen toggle expands any table view to fill the viewport.",
    "Search bar filters across key text fields (name, city, state, broker, etc.).",
    "Sort by clicking column headers.",
    "Multi-select status/filter controls where applicable.",
  ],
};

const phaseNotes: NoteSection[] = [
  {
    title: "Phase 1 — Deal Pipeline",
    notes: [
      "Core table view for tracking RE PE acquisition deals.",
      "Columns: Property, AI Score, Broker, City, State, Status, Marketed?, Units, Asking Price ($M), Est. Equity ($M), $/Unit, Year Built, Affordable, Value-Add, Avg HH Income, Pop Growth, Notes.",
      "Status options: New, Screening, On Hold/Tracking, Underwriting, B&F, Under Contract, Pass.",
      "Estimated Equity auto-calculates as Asking Price × 35% whenever price changes.",
      "$/Unit formula: (Asking Price / Units) × 100, displayed with 'K' suffix.",
      "AI Score column: score 0–100, color-coded (green ≥80, yellow ≥50, red <50), hover tooltip shows reasoning. Will be powered by buy-box criteria (Phase 3).",
      "Marketed? column: Y/N toggle (switch control inline, checkbox on deal form).",
      "Deal detail page shows all fields with edit capability; AI Score displayed with color badge and summary.",
      "Sample data seeded from Ansonia's acquisition pipeline raw file.",
    ],
  },
  {
    title: "Phase 2 — Capital Partners",
    notes: [
      "Full CRM-style table for tracking LP / equity partners.",
      "Columns: Firm Name, Warmth, Firm Type, Equity Range ($M), Strategy, Geography, Product Types, Investor Type, Hold Period, Location Pref, Ansonia POC, Status, Data Source, Notes.",
      "Warmth levels ranked 1–5: 1. Existing Partner, 2. Very Warm, 3. Warm, 4. Tepid, 5. Cold. Sorting follows this rank order.",
      "Firm Type options: GP, LP, Family Office, REIT, Insurance, Pension, Endowment, Fund of Funds, Other.",
      "Equity Range displays as '$MinM – $MaxM'; calculated from min_equity_m and max_equity_m fields.",
      "Equity columns sort numerically (not alphabetically); filter dropdowns also ordered numerically.",
      "Strategy flags: Value-Add (VA), Core+ (C+), Workforce (WF), Affordable (Aff). Displayed as comma-separated abbreviations.",
      "Geography and Product Types stored as arrays; displayed comma-separated.",
      "Investor Type: multi-select with options JV, Large JV, Sidecar. Stored as array; displayed as tags.",
      "Location Preference: Urban Infill / Suburban boolean flags.",
      "Per-column multi-select filter dropdowns on every column header; filter by any values present in the dataset.",
      "All filter dropdowns include a '(Blank)' option to filter for null/empty values.",
      "Double-click a row to open the partner detail page; single-click a cell to edit inline.",
      "Partner detail page with full profile, contacts sub-table (name, role, email, phone, LinkedIn, firm location, Ansonia POC), and interaction timeline (type, content, date, author, source).",
      "Contacts and interactions each have add/edit/delete capability within the partner detail page.",
      "Data imported from cleaned HTML source of Ansonia's existing partner list.",
    ],
  },
  {
    title: "Phase 3 — Buy Box Scoring (Pillars + Thesis)",
    notes: [
      "Replaced legacy red/yellow/green criteria with weighted pillars + free-text investment thesis.",
      "6 pillars stored in buy_box_pillars: Market Demand & Demographics, Market Supply & Rent Dynamics, Location & Accessibility, Asset Quality & Vintage, Value-Add Opportunity, Deal Economics. Weights must sum to 100%.",
      "Each pillar has buy_box_signals — sub-criteria with field_source path (e.g. deals.median_income_tract, deal_enrichment.rings.5mi.pop_growth_5yr, derived.rent_gap_pct), scoring_method (higher_better/lower_better/range_optimal/boolean), min/max/optimal ranges, and weight_within_pillar.",
      "buy_box_thesis: singleton free-text. Sent to Lovable AI (gemini-3-flash-preview) along with deal data and pillar scores → returns a -10/+10 adjustment + rationale stored in ai_score_summary.",
      "Final ai_score = clamp(weighted_pillar_score + thesis_adjustment, 0, 100). Full breakdown stored in deals.pillar_scores jsonb for transparency in ScoreBreakdown component.",
      "Auto-scoring: edge function deal-score is invoked (a) on deal creation from NewDeal.tsx, (b) nightly via pg_cron at 03:00 UTC, (c) manually via Re-score button on Deal Detail.",
      "Supply data: permits-enrich pulls Census Building Permits Survey (BPS) — free, no API key. CBSA crosswalk TBD; signal scores null until wired.",
    ],
  },
  {
    title: "Phase 4 — AI Partner Matching",
    notes: [
      "Given a deal, automatically recommend the best-fit capital partners from the partners database.",
      "Matching criteria: equity range fit (deal equity need falls within partner's min/max), strategy alignment (value-add, core+, workforce, affordable), geography overlap, product type match, investor type compatibility.",
      "Warmth-weighted ranking: closer existing relationships ranked higher when match scores are similar.",
      "Match score displayed as percentage with breakdown tooltip showing which criteria matched/missed.",
      "UI: 'Find Partners' button on deal detail page opens a ranked list of matching partners with match scores.",
      "Ability to filter matches by minimum match score, warmth level, or firm type.",
      "One-click action to add a matched partner to a deal's capital raise pipeline (Phase 5).",
      "AI-powered reasoning: optional LLM summary explaining why a partner is a good/poor fit based on historical interactions and strategy alignment.",
    ],
  },
  {
    title: "Phase 5 — Capital Raise Pipeline",
    notes: [
      "Kanban-style board tracking capital raise progress per deal.",
      "Stages: Identified → Contacted → Meeting Scheduled → Term Sheet → Committed → Closed.",
      "Each card represents a partner-deal pairing with: partner name, equity amount discussed, stage, last activity date, assigned POC.",
      "Drag-and-drop cards between stages to update status.",
      "Deal-level view: see all partners in the raise pipeline for a specific deal.",
      "Partner-level view: see all deals a partner is involved in across the pipeline.",
      "Summary metrics per deal: total equity targeted, total committed, number of partners at each stage.",
      "Activity log on each card: track calls, emails, meetings, and notes specific to that partner-deal relationship.",
      "Deadline/follow-up reminders: flag cards that haven't had activity in X days.",
    ],
  },
  {
    title: "Phase 6 — Notes & Tagging System",
    notes: [
      "Universal notes system attachable to deals, partners, and capital raise cards.",
      "Rich text editor for note content (bold, italic, lists, links).",
      "Tagging system: user-defined tags (e.g., 'follow-up', 'high-priority', 'legal-review') applicable across all entities.",
      "Tag management page: create, rename, delete, and color-code tags.",
      "Filter any table view by tags — show only deals/partners with specific tags.",
      "@ mentions: reference other deals or partners within a note to create cross-links.",
      "Note timeline: chronological view of all notes across the platform, filterable by entity type, author, or tag.",
      "Pinned notes: mark critical notes to appear at the top of any entity's detail page.",
    ],
  },
  {
    title: "Phase 7 — Dashboard & Export",
    notes: [
      "Executive dashboard with key metrics: active deals count, total pipeline value, deals by status breakdown, average AI score.",
      "Capital partners summary: total partners, breakdown by warmth, active raise pipelines.",
      "Charts: deal pipeline funnel, equity committed over time, deal flow by geography (map or bar chart).",
      "Recent activity feed: last 20 actions across deals, partners, and capital raises.",
      "Export functionality: export any table view to CSV/Excel with current filters and sort applied.",
      "PDF deal summary: one-page printable summary of a deal with all key metrics, AI score, and matched partners.",
      "Scheduled reports: configure weekly/monthly email digests of pipeline status (future enhancement).",
    ],
  },
  {
    title: "Phase 8 — Outlook Email Integration",
    notes: [
      "Microsoft Graph API integration for Outlook email sync.",
      "Connect user's Outlook account via OAuth2 authentication flow.",
      "Auto-capture: emails sent to/from partner contacts are automatically logged as interactions on the partner's timeline.",
      "Email matching: match incoming/outgoing emails to partners by email address lookup in partner_contacts table.",
      "Manual link: ability to manually associate any email with a deal or partner if auto-match doesn't catch it.",
      "Email templates: pre-built templates for common outreach (intro, follow-up, term sheet discussion) that auto-populate with deal/partner data.",
      "Send from platform: compose and send emails directly from deal or partner detail pages without switching to Outlook.",
      "Sync status indicator: show last sync time and any errors in connecting to Outlook.",
    ],
  },
];

type OpenItem = {
  phase: string;
  note: string;
};

const openItems: OpenItem[] = [
  {
    phase: "Phase 3 — Buy Box",
    note: "Need to flesh out the best way to structure the scoring engine further, and get APIs & AI integrated to facilitate connection of the deal scoring engine. Discuss with Eric on how to best think about defining this scoring engine, then implement accordingly.",
  },
];

export default function DevNotesPage() {
  const allSections = [platformWideNotes, ...phaseNotes];
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => Object.fromEntries(allSections.map((s) => [s.title, true]))
  );
  const [openItemsExpanded, setOpenItemsExpanded] = useState(true);

  const toggle = (title: string) =>
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));

  const renderSection = (section: NoteSection, isPlatform?: boolean) => (
    <Collapsible
      key={section.title}
      open={openSections[section.title] ?? true}
      onOpenChange={() => toggle(section.title)}
    >
      <div className={`border rounded-lg bg-card ${isPlatform ? "border-primary/30" : ""}`}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors rounded-t-lg">
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${
              openSections[section.title] ? "" : "-rotate-90"
            }`}
          />
          <span className="font-semibold text-sm">{section.title}</span>
          {isPlatform && (
            <span className="text-[10px] uppercase tracking-wider font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
              Global
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {section.notes.length} items
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="px-4 pb-4 space-y-2 border-t pt-3">
            {section.notes.map((note, i) => (
              <li
                key={i}
                className="text-sm text-muted-foreground leading-relaxed pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-muted-foreground/40"
              >
                {note}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Dev Notes</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Specifications and build instructions for each phase of the Ansonia platform.
        </p>
      </div>

      <div className="space-y-4">
        {renderSection(platformWideNotes, true)}
        
        <div className="pt-2">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Phase Notes</h2>
          <div className="space-y-4">
            {phaseNotes.map((section) => renderSection(section))}
          </div>
        </div>
      </div>

      {/* Open Items / Next Steps */}
      <div className="pt-4 border-t">
        <Collapsible open={openItemsExpanded} onOpenChange={setOpenItemsExpanded}>
          <div className="border rounded-lg bg-card border-yellow-500/30">
            <CollapsibleTrigger className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors rounded-t-lg">
              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform ${
                  openItemsExpanded ? "" : "-rotate-90"
                }`}
              />
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <span className="font-semibold text-sm">Open Items & Next Steps</span>
              <span className="text-[10px] uppercase tracking-wider font-medium text-yellow-600 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                {openItems.length} open
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="px-4 pb-4 space-y-3 border-t pt-3">
                {openItems.map((item, i) => (
                  <li key={i} className="text-sm leading-relaxed">
                    <span className="font-medium text-yellow-600 text-xs uppercase tracking-wide">{item.phase}</span>
                    <p className="text-muted-foreground mt-0.5">{item.note}</p>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>
    </div>
  );
}
