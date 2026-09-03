import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { safeExternalUrl } from "@/lib/safeUrl";
import { Loader2, MapPin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDealEnrichment } from "@/hooks/useDealEnrichment";

type Rings = Record<string, Record<string, number | string | null>>;
const RADII = ["1mi", "3mi", "5mi"] as const;
type Radius = typeof RADII[number];

const num = (v: any) => (v == null || v === "" ? null : Number(v));
const fmtN = (v: any) => { const n = num(v); return n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString(); };
const fmt1 = (v: any) => { const n = num(v); return n == null || isNaN(n) ? "—" : n.toFixed(1); };
const fmtM = (v: any) => { const n = num(v); return n == null || isNaN(n) ? "—" : `$${Math.round(n).toLocaleString()}`; };
const fmtP = (v: any) => { const n = num(v); return n == null || isNaN(n) ? "—" : `${n.toFixed(2)}%`; };

function GrowthCell({ value }: { value: number | null }) {
  if (value == null || isNaN(value)) return <>—</>;
  const cls = value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-foreground";
  return <span className={cls}>{value.toFixed(2)}%</span>;
}

function Row({ label, vals, render = fmtN }: { label: string; vals: any[]; render?: (v: any) => any }) {
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2">{label}</td>
      {vals.map((v, i) => (
        <td key={i} className="px-3 py-2 text-right tabular-nums">{render(v)}</td>
      ))}
    </tr>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Metric</th>
            <th className="text-right px-3 py-2 font-medium">1 mi</th>
            <th className="text-right px-3 py-2 font-medium">3 mi</th>
            <th className="text-right px-3 py-2 font-medium">5 mi</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const RACE_VARS: { key: string; label: string; color: string }[] = [
  { key: "WHITE_CY", label: "White", color: "hsl(210 60% 55%)" },
  { key: "BLACK_CY", label: "Black", color: "hsl(30 70% 50%)" },
  { key: "ASIAN_CY", label: "Asian", color: "hsl(140 50% 45%)" },
  { key: "OTHRACE_CY", label: "Other", color: "hsl(45 60% 50%)" },
  { key: "RACE2UP_CY", label: "2+ Races", color: "hsl(320 40% 55%)" },
];

// Brief 2-sentence summaries of Esri Tapestry segments and LifeMode groups.
// Sourced from Esri's published Tapestry Segmentation reference.
const TAPESTRY_DESCRIPTIONS: Record<string, string> = {
  // Segments
  "metro fusion": "A young, diverse, urban renter market — many in their 20s and early 30s, working in service and entry-level professional jobs. Households are mostly singles and roommates living in mid-density apartments, with above-average mobility and modest incomes.",
  "dorms to diplomas": "College-town neighborhoods dominated by students living in dorms, group quarters, and rentals near campus. Incomes are low (most aren't yet in the workforce), but education levels and aspirations are high; lifestyles revolve around school, social life, and digital media.",
  "set to impress": "Younger, lower-middle-income renters in small, often older multi-unit buildings in metro suburbs. Households are a mix of singles, young couples, and shared rentals; budgets are tight but residents are style-conscious and brand-aware.",
  "old and newcomers": "A mix of long-time older residents and younger newcomers in established metro neighborhoods. Households skew small (singles and couples), incomes are moderate, and the housing stock blends owned and rented apartments and small homes.",
  "city strivers": "Urban, predominantly minority renter households in older multi-unit buildings, often single-parent or single-person. Incomes are below average and residents work hard to make ends meet, frequently in service, healthcare-support, and transportation jobs.",
  "social security set": "Older, lower-income city dwellers — many retired and living alone in rented apartments. Social Security is a primary income source; lifestyles are frugal, neighborhood-centered, and reliant on public transit.",
  "nextgen": "Young, diverse urban renters at the start of their careers, living in small apartments in larger metro markets. Incomes are still modest but growing, and residents are tech-savvy, socially active, and on the move.",
  "young and restless": "Educated 20-somethings concentrated in growing metro areas, mostly renting apartments alone or with roommates. Careers are in the launch phase; lifestyles are mobile, digital, and experience-driven.",
  "in style": "Professional couples and families in densely populated suburbs of larger metros. Incomes are above average, both spouses typically work, and households spend on home, technology, travel, and fitness.",
  "enterprising professionals": "Young, well-educated, mobile professionals in mid-to-large metro suburbs, frequently renting upscale apartments or starter homes. Dual-income households are common, with above-average incomes and heavy use of digital services.",
  "laptops and lattes": "Affluent, highly educated singles and couples in the urban cores of major metros. Most rent, work in professional/tech/creative fields, and lead active, environmentally and tech-conscious lifestyles.",
  "metro renters": "Young, well-educated singles renting apartments in the densest parts of large metros. Incomes are solid and rising; residents prioritize career, social life, fitness, and dining out over home ownership.",
  "barrios urbanos": "Hispanic-majority urban neighborhoods with younger families and multigenerational households. Incomes are below average and many residents are bilingual; cultural ties, family, and community are central to daily life.",
  "valley growers": "Small, agriculture-anchored Hispanic communities in the rural West. Households are large, often multigenerational, with modest incomes earned in farming, food processing, and related trades.",
  "fresh ambitions": "Young, ethnically diverse renters in dense urban neighborhoods, many foreign-born or first-generation. Incomes are below average; households work in service and manufacturing jobs and aspire to upward mobility.",
  "international marketplace": "Diverse, urban, foreign-born neighborhoods with a strong Hispanic and immigrant presence. Households tend to be larger and multigenerational, with modest incomes from service, construction, and manufacturing work.",
  // LifeMode groups (when ArcGIS returns the LifeMode roll-up)
  "moderate metros": "A LifeMode group of working-class urban and suburban neighborhoods with diverse, often younger populations and modest, below-average incomes. Households are a mix of renters and owners working in service, retail, and entry-level professional jobs.",
  "middle ground": "A LifeMode group of established suburban and small-city neighborhoods with middle-income households. Residents are a broad mix of ages and family types, balancing home ownership, careers, and family life.",
  "scholars and patriots": "A LifeMode group dominated by college students and military households. Populations are young and transient, incomes are limited, and lifestyles revolve around school or service rather than long-term roots.",
  "uptown individuals": "A LifeMode group of young, single, urban professionals living in the densest parts of large metros. Incomes are above average, education is high, and lifestyles emphasize career, dining, fitness, and cultural experiences.",
  "next wave": "A LifeMode group of urban, ethnically diverse, immigrant-rich neighborhoods. Households are typically younger and larger, with below-average incomes earned primarily in service, manufacturing, and construction jobs.",
  "affluent estates": "A LifeMode group of established wealth in suburban neighborhoods of larger metros. Married-couple families with older children dominate; incomes and home values are well above average.",
  "upscale avenues": "A LifeMode group of prosperous, married-couple households in established suburbs. Incomes are above average and residents invest heavily in home improvement, education, and family-oriented spending.",
  "gen xurban": "A LifeMode group of Gen X-led households in mature suburbs near larger metros. Incomes are solidly middle-class, lifestyles are family-centered, and residents balance careers with kids, schools, and home upkeep.",
  "ethnic enclaves": "A LifeMode group of long-established immigrant and ethnic neighborhoods, often anchored in larger metros. Households are family-oriented and multigenerational, with incomes earned in a mix of service, trade, and small-business work.",
  "cozy country living": "A LifeMode group of small towns and rural areas with older, settled homeowners. Incomes are modest, ties to community and church are strong, and lifestyles are slower-paced and traditional.",
  "sprouting explorers": "A LifeMode group of younger households in small cities and emerging suburbs. Incomes are still moderate but growing, with a mix of renters and first-time buyers raising young families.",
  "senior styles": "A LifeMode group of older households across a range of incomes and locations, from urban high-rises to small towns. Lifestyles are shaped by retirement, health, and a preference for stability and routine.",
  "rustic outposts": "A LifeMode group of remote rural and small-town areas with older, lower-income residents. Economies lean on agriculture, manufacturing, and natural resources; lifestyles are self-reliant and community-rooted.",
  "midtown singles": "A LifeMode group of single, often younger urban renters with modest incomes. Households are small, mobility is high, and residents lean on city amenities and public transit.",
  "hometown": "A LifeMode group of long-time residents in older, working-class neighborhoods of small cities. Incomes are below average, ties to family and place are strong, and lifestyles are practical and value-conscious.",
  "american quilt": "A LifeMode group of small-town and rural America with a wide mix of household types and middle-to-modest incomes. Residents value community, family, and traditional values, and many own their homes.",
};


function RaceBar({ ring, attrs }: { ring: Radius; attrs: any }) {
  const total = num(attrs?.TOTPOP) ?? num(attrs?.TOTPOP_CY) ?? 0;
  const segs = RACE_VARS.map(v => ({ ...v, count: num(attrs?.[v.key]) ?? 0 }));
  const segTotal = segs.reduce((a, b) => a + b.count, 0)
    || num(attrs?.RACEBASECY)
    || total
    || 1;
  const hispCount = num(attrs?.HISPPOP_CY) ?? 0;
  const hispPct = total > 0 ? (hispCount / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{ring} ring</span>
        <span className="text-xs text-muted-foreground">Total pop: {fmtN(total)}</span>
      </div>
      <div className="flex h-6 w-full rounded overflow-hidden border border-border">
        {segs.map(s => {
          const pct = (s.count / segTotal) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={s.key}
              style={{ width: `${pct}%`, backgroundColor: s.color }}
              title={`${s.label}: ${fmtN(s.count)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-xs">
        {segs.map(s => {
          const pct = (s.count / segTotal) * 100;
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
              <span className="truncate text-muted-foreground">{s.label}:</span>
              <span className="tabular-nums">{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
      <div className="text-xs text-muted-foreground mt-2 italic">
        Hispanic / Latino ethnicity (any race): {fmtN(hispCount)} ({hispPct.toFixed(1)}%)
      </div>
    </div>
  );
}

type NicheStatus = "ok" | "no_grade_on_page" | "no_page_found" | "no_api_key" | "scrape_failed";

type SchoolPick = {
  name: string;
  level: string;
  grade_low: string | null;
  grade_high: string | null;
  enrollment: number | null;
  distance_mi: number | null;
  niche_grade?: string | null;
  niche_url?: string | null;
  niche_status?: NicheStatus | null;
} | null;
type SchoolsData = {
  district: {
    leaid: string;
    name: string;
    state: string | null;
    niche_grade: string | null;
    niche_url: string | null;
    niche_status?: NicheStatus | null;
  } | null;
  elementary: SchoolPick;
  middle: SchoolPick;
  high: SchoolPick;
  city_niche_url?: string | null;
  city_label?: string | null;
  niche_status?: NicheStatus | null;
  fetched_at: string;
} | null;

const NICHE_REASON: Record<string, string> = {
  no_grade_on_page: "Niche has no overall grade for this school",
  no_page_found: "No matching Niche page found",
  no_api_key: "Grade lookup unavailable (Firecrawl key not configured)",
  scrape_failed: "Grade lookup failed — try refreshing",
};

function gradeBandClass(grade: string) {
  const band = grade[0]?.toUpperCase();
  if (band === "A") return "bg-green-600/15 text-green-600 dark:text-green-400";
  if (band === "B") return "bg-primary/10 text-primary";
  if (band === "C") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-destructive/10 text-destructive";
}

function NicheBadge({
  grade,
  status,
  prefix,
}: {
  grade?: string | null;
  status?: NicheStatus | null;
  prefix?: string;
}) {
  if (grade) {
    return (
      <span className={`text-sm font-mono px-2 py-0.5 rounded shrink-0 ${gradeBandClass(grade)}`}>
        {prefix ? `${prefix} ` : ""}{grade}
      </span>
    );
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs font-mono px-2 py-0.5 rounded shrink-0 bg-muted text-muted-foreground cursor-help">
            Grade n/a
          </span>
        </TooltipTrigger>
        <TooltipContent>{NICHE_REASON[status ?? ""] ?? "Grade lookup unavailable"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}


export function DemographicsPanel({ dealId, address }: { dealId: string; address: string | null }) {
  const { data: enrichment, isLoading } = useDealEnrichment(dealId);
  const [running, setRunning] = useState(false);
  const [schoolsRunning, setSchoolsRunning] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const queryClient = useQueryClient();

  const run = async (force = false) => {
    if (!address) {
      toast.error("Need a property address to pull demographics.");
      return;
    }
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("esri-enrich", {
        body: { deal_id: dealId, address, force },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success((data as any)?.cached ? "Loaded cached demographics" : "Pulled demographics from ArcGIS");
      queryClient.invalidateQueries({ queryKey: ["deal_enrichment", dealId] });
    } catch (e) {
      toast.error("Demographic enrichment failed: " + (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const runSchools = async (force = false) => {
    setSchoolsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("schools-enrich", {
        body: { deal_id: dealId, force },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success((data as any)?.cached ? "Loaded cached schools" : "Pulled schools from NCES");
      queryClient.invalidateQueries({ queryKey: ["deal_enrichment", dealId] });
    } catch (e) {
      toast.error("Schools lookup failed: " + (e as Error).message);
    } finally {
      setSchoolsRunning(false);
    }
  };

  // Auto-trigger on first open if no enrichment exists
  useEffect(() => {
    if (!isLoading && !enrichment && address && !running) {
      run(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, enrichment, address]);

  const rings = (enrichment?.rings as Rings | undefined) ?? null;
  const schools = ((enrichment as any)?.schools as SchoolsData) ?? null;
  const get = (r: Radius, k: string) => rings?.[r]?.[k];
  const growth = (cy: any, fy: any) => {
    const c = num(cy), f = num(fy);
    if (c == null || f == null || c === 0) return null;
    return ((f - c) / c) * 100;
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Demographics (1 / 3 / 5 mile)</span>
          <div className="flex items-center gap-3">
            {enrichment?.updated_at && (
              <span className="text-xs font-normal text-muted-foreground">
                Synced {new Date(enrichment.updated_at).toLocaleString()}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => (enrichment ? setConfirmRefresh(true) : run(true))}
              disabled={running || !address}
            >
              {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
              {enrichment ? "Refresh" : "Enrich with Demographics"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!rings && (running || isLoading) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Pulling demographics from ArcGIS…
          </div>
        )}
        {!rings && !running && !isLoading && (
          <p className="text-sm text-muted-foreground">No demographic data yet. Click "Enrich with Demographics" to pull from ArcGIS.</p>
        )}

        {rings && (
          <Tabs defaultValue="population" className="w-full">
            <TabsList className="grid grid-cols-8 w-full">
              <TabsTrigger value="population">Population</TabsTrigger>
              <TabsTrigger value="income">Income</TabsTrigger>
              <TabsTrigger value="race">Race</TabsTrigger>
              <TabsTrigger value="education">Education</TabsTrigger>
              <TabsTrigger value="schools">Schools</TabsTrigger>
              <TabsTrigger value="housing">Housing</TabsTrigger>
              <TabsTrigger value="tapestry">Tapestry</TabsTrigger>
              <TabsTrigger value="crime">Crime</TabsTrigger>
            </TabsList>

            <TabsContent value="population" className="mt-4">
              <Table>
                <Row label="Total Population (Current)" vals={RADII.map(r => get(r, "TOTPOP_CY") ?? get(r, "TOTPOP"))} render={fmtN} />
                <Row label="Total Population (5yr Forecast)" vals={RADII.map(r => get(r, "TOTPOP_FY"))} render={fmtN} />
                <tr className="border-t border-border">
                  <td className="px-3 py-2">5yr Projected Growth</td>
                  {RADII.map(r => (
                    <td key={r} className="px-3 py-2 text-right tabular-nums">
                      <GrowthCell value={growth(get(r, "TOTPOP_CY"), get(r, "TOTPOP_FY"))} />
                    </td>
                  ))}
                </tr>
                <Row label="Group Quarters Population" vals={RADII.map(r => get(r, "GQPOP_CY") ?? get(r, "GQPOP"))} render={fmtN} />
                <Row label="Daytime Population" vals={RADII.map(r => get(r, "DPOP_CY"))} render={fmtN} />
                <Row label="Median Age" vals={RADII.map(r => get(r, "MEDAGE_CY"))} render={fmt1} />
                <Row label="Population 25-34" vals={RADII.map(r => {
                  const keys = ["POP25_CY","POP26_CY","POP27_CY","POP28_CY","POP29_CY","POP30_CY","POP31_CY","POP32_CY","POP33_CY","POP34_CY"];
                  const sum = keys.reduce((a,k)=>a+(num(get(r,k))??0),0);
                  return sum || null;
                })} render={fmtN} />
                <Row label="Population 35-44" vals={RADII.map(r => {
                  const keys = ["POP35_CY","POP36_CY","POP37_CY","POP38_CY","POP39_CY","POP40_CY","POP41_CY","POP42_CY","POP43_CY","POP44_CY"];
                  const sum = keys.reduce((a,k)=>a+(num(get(r,k))??0),0);
                  return sum || null;
                })} render={fmtN} />
              </Table>
              <p className="text-xs text-muted-foreground mt-2">Source: Esri / ArcGIS</p>
            </TabsContent>

            <TabsContent value="income" className="mt-4">
              <Table>
                <Row label="Median Household Income" vals={RADII.map(r => get(r, "MEDHINC_CY"))} render={fmtM} />
                <Row label="Median HH Income (5yr)" vals={RADII.map(r => get(r, "MEDHINC_FY"))} render={fmtM} />
                <tr className="border-t border-border">
                  <td className="px-3 py-2">5yr Income Growth</td>
                  {RADII.map(r => (
                    <td key={r} className="px-3 py-2 text-right tabular-nums">
                      <GrowthCell value={growth(get(r, "MEDHINC_CY"), get(r, "MEDHINC_FY"))} />
                    </td>
                  ))}
                </tr>
                <Row label="Average HH Income" vals={RADII.map(r => get(r, "AVGHINC_CY"))} render={fmtM} />
                <Row label="Per Capita Income" vals={RADII.map(r => get(r, "PCI_CY"))} render={fmtM} />
              </Table>
              <p className="text-xs text-muted-foreground mt-2">Source: Esri / ArcGIS</p>
            </TabsContent>

            <TabsContent value="race" className="mt-4 space-y-6">
              {RADII.map(r => (
                <RaceBar key={r} ring={r} attrs={rings[r]} />
              ))}
              <p className="text-xs text-muted-foreground mt-2">Source: Esri / ArcGIS</p>
            </TabsContent>

            <TabsContent value="education" className="mt-4">
              <Table>
                <Row label="No Schooling Completed" vals={RADII.map(r => get(r, "EDUCATTN1_CY") ?? get(r, "NOHS_CY"))} render={fmtN} />
                <Row label="Some College, No Degree" vals={RADII.map(r => get(r, "ASSCDEG_CY") ?? get(r, "SMCOLL_CY"))} render={fmtN} />
                <Row label="Bachelor's Degree" vals={RADII.map(r => get(r, "BACHDEG_CY"))} render={fmtN} />
                <Row label="Graduate / Professional Degree" vals={RADII.map(r => get(r, "GRADDEG_CY"))} render={fmtN} />
                <tr className="border-t border-border">
                  <td className="px-3 py-2">Bachelor's or Higher %</td>
                  {RADII.map(r => {
                    const b = num(get(r, "BACHDEG_CY")) ?? 0;
                    const g = num(get(r, "GRADDEG_CY")) ?? 0;
                    const tot = num(get(r, "EDUCBASECY")) ?? num(get(r, "POP25UP_CY"));
                    const pct = tot ? ((b + g) / tot) * 100 : null;
                    return <td key={r} className="px-3 py-2 text-right tabular-nums">{pct == null ? "—" : `${pct.toFixed(1)}%`}</td>;
                  })}
                </tr>
              </Table>
              <p className="text-xs text-muted-foreground mt-2">Source: Esri / ArcGIS</p>
            </TabsContent>

            <TabsContent value="schools" className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="text-xs text-muted-foreground flex-1">
                  District boundary from NCES (point-in-polygon). Schools are the nearest comprehensive elementary, middle,
                  and high in the assigned district — a strong proxy for assigned schools, though magnet/choice zones may apply.
                </div>
                <Button variant="outline" size="sm" onClick={() => runSchools(true)} disabled={schoolsRunning}>
                  {schoolsRunning ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
                  {schools ? "Refresh" : "Look up schools"}
                </Button>
              </div>

              {!schools && !schoolsRunning && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No school data yet. Click "Look up schools" to query NCES.
                </p>
              )}
              {schoolsRunning && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Querying NCES + Niche…
                </div>
              )}

              {schools && (
                <>
                  {schools.niche_status === "no_api_key" && (
                    <p className="text-xs text-muted-foreground">
                      Niche grades unavailable — Firecrawl API key not configured.
                    </p>
                  )}
                  {schools.district && (
                    <div className="border border-border rounded-md p-4 bg-muted/20">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">School District</p>
                      <div className="flex items-center justify-between">
                        <p className="text-base font-semibold">{schools.district.name}</p>
                        <NicheBadge
                          grade={schools.district.niche_grade}
                          status={schools.district.niche_status ?? schools.niche_status}
                          prefix="Niche:"
                        />
                      </div>
                      {safeExternalUrl(schools.district.niche_url) && (
                        <a
                          href={safeExternalUrl(schools.district.niche_url)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          {schools.district.niche_grade ? "View on Niche →" : "Look up on Niche →"}
                        </a>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(["elementary", "middle", "high"] as const).map((lvl) => {
                      const s = schools[lvl];
                      return (
                        <div key={lvl} className="border border-border rounded-md p-4">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{lvl}</p>
                          {!s && <p className="text-sm text-muted-foreground">—</p>}
                          {s && (
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-base font-semibold leading-tight">{s.name}</p>
                                <NicheBadge grade={s.niche_grade} status={s.niche_status ?? schools.niche_status} />
                              </div>

                              <p className="text-xs text-muted-foreground mt-1">
                                Grades {s.grade_low ?? "?"}–{s.grade_high ?? "?"} · {fmtN(s.enrollment)} students
                              </p>
                              <p className="text-xs text-muted-foreground">{s.distance_mi} mi from property</p>
                              {safeExternalUrl(s.niche_url) && (
                                <a href={safeExternalUrl(s.niche_url)!} target="_blank" rel="noopener noreferrer"
                                   className="text-xs text-primary hover:underline">
                                  {s.niche_grade ? "View on Niche →" : "Look up on Niche →"}
                                </a>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {safeExternalUrl(schools.city_niche_url) && (
                    <div className="border border-border rounded-md p-3 bg-muted/10 flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Browse all public schools{schools.city_label ? ` in ${schools.city_label}` : ""} on Niche
                      </p>
                      <a href={safeExternalUrl(schools.city_niche_url)!} target="_blank" rel="noopener noreferrer"
                         className="text-xs text-primary hover:underline">Open Niche search →</a>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Source: NCES School Districts &amp; School Characteristics (current year). Niche grades scraped best-effort; links always resolve to Niche's free search results.
                  </p>
                </>
              )}
            </TabsContent>

            <TabsContent value="housing" className="mt-4">
              <Table>
                <Row label="Owner-Occupied Units" vals={RADII.map(r => get(r, "OWNER_CY"))} render={fmtN} />
                <Row label="Renter-Occupied Units" vals={RADII.map(r => get(r, "RENTER_CY"))} render={fmtN} />
                <tr className="border-t border-border">
                  <td className="px-3 py-2">Renter Rate %</td>
                  {RADII.map(r => {
                    const o = num(get(r, "OWNER_CY")) ?? 0;
                    const re = num(get(r, "RENTER_CY")) ?? 0;
                    const t = o + re;
                    return <td key={r} className="px-3 py-2 text-right tabular-nums">{t ? `${((re/t)*100).toFixed(1)}%` : "—"}</td>;
                  })}
                </tr>
                <Row label="Median Home Value" vals={RADII.map(r => get(r, "MEDVAL_CY"))} render={fmtM} />
                <Row label="Median Home Value (5yr)" vals={RADII.map(r => get(r, "MEDVAL_FY"))} render={fmtM} />
                <Row label="Median Gross Rent" vals={RADII.map(r => get(r, "MEDGRENT_CY") ?? get(r, "MEDRENT_CY"))} render={fmtM} />
                <Row label="Vacant Housing Units" vals={RADII.map(r => get(r, "VACANT_CY"))} render={fmtN} />
                <tr className="border-t border-border">
                  <td className="px-3 py-2">Vacancy Rate %</td>
                  {RADII.map(r => {
                    const v = num(get(r, "VACANT_CY")) ?? 0;
                    const tot = num(get(r, "TOTHU_CY")) ?? ((num(get(r, "OWNER_CY"))??0)+(num(get(r, "RENTER_CY"))??0)+v);
                    return <td key={r} className="px-3 py-2 text-right tabular-nums">{tot ? `${((v/tot)*100).toFixed(1)}%` : "—"}</td>;
                  })}
                </tr>
              </Table>
              <p className="text-xs text-muted-foreground mt-2">Source: Esri / ArcGIS</p>
            </TabsContent>

            <TabsContent value="tapestry" className="mt-4 space-y-4">
              <div className="text-xs text-muted-foreground bg-muted/30 border border-border rounded-md p-3 leading-relaxed">
                <p className="mb-1">
                  <strong className="text-foreground">About Tapestry Segmentation:</strong> Esri's ArcGIS Tapestry classifies U.S.
                  neighborhoods into distinct segments based on shared demographic, socioeconomic, and lifestyle characteristics
                  (age, income, household type, spending habits, and consumer behavior). Segments are rolled up into broader
                  <em> LifeMode</em> groups that share key demographic traits. The dominant segment shown below describes the
                  prevailing community profile within each radius — useful for understanding resident lifestyle, demand drivers,
                  and marketing/positioning fit.
                </p>
                <a
                  href="https://doc.arcgis.com/en/esri-demographics/latest/esri-demographics/tapestry-segmentation.htm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Learn more about Tapestry Segmentation →
                </a>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {RADII.map(r => {
                  const name = (get(r, "TOP1NAME") ?? get(r, "THHSNAME") ?? get(r, "TSEGNAME") ?? get(r, "TSEGNAM") ?? "") as string;
                  const desc = TAPESTRY_DESCRIPTIONS[name.toLowerCase().trim()];
                  return (
                    <div key={r} className="border border-border rounded-md p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{r} ring</p>
                      <p className="text-base font-semibold">{name || "—"}</p>
                      <p className="text-xs text-muted-foreground mt-1">Code: {get(r, "TOP1CODE") ?? get(r, "THHSCODE") ?? get(r, "TSEGCODE") ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">Households: {fmtN(get(r, "TOP1VALUE"))}</p>
                      <p className="text-xs text-muted-foreground">Share: {fmtP(get(r, "TOP1PRC"))}</p>
                      {desc && (
                        <p className="text-xs text-foreground/80 mt-3 leading-relaxed border-t border-border pt-2">{desc}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Source: Esri / ArcGIS (Tapestry Segmentation)</p>
            </TabsContent>

            <TabsContent value="crime" className="mt-4">
              <Table>
                <Row label="Total Crime Index (100 = US avg)" vals={RADII.map(r => get(r, "CRMCYTOTC"))} render={fmt1} />
                <Row label="Personal Crime Index" vals={RADII.map(r => get(r, "CRMCYPERC") ?? get(r, "CRMCYVIOL"))} render={fmt1} />
                <Row label="Property Crime Index" vals={RADII.map(r => get(r, "CRMCYPROC") ?? get(r, "CRMCYPROP"))} render={fmt1} />
              </Table>
              <p className="text-xs text-muted-foreground mt-2">Index of 100 equals the US national average. Lower values indicate lower crime risk.</p>
              <p className="text-xs text-muted-foreground mt-1">Source: Esri / ArcGIS (Crime Indexes)</p>
            </TabsContent>
          </Tabs>
        )}

        {enrichment?.matched_address && (
          <p className="text-xs text-muted-foreground mt-4">Matched address: {enrichment.matched_address}</p>
        )}
      </CardContent>

      <AlertDialog open={confirmRefresh} onOpenChange={setConfirmRefresh}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refresh demographic data?</AlertDialogTitle>
            <AlertDialogDescription>
              This pulls fresh demographic data from Esri and costs roughly $5 in ArcGIS
              credits. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRefresh(false);
                run(true);
              }}
            >
              Refresh
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
