import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { DEAL_STATUSES } from "@/lib/dealStatus";

type ValueAddLevel = Database["public"]["Enums"]["value_add_level"];

const dealStatuses = DEAL_STATUSES;
const valueAddLevels: ValueAddLevel[] = ["High", "Medium", "Low"];

const dealSchema = z.object({
  property_name: z.string().min(1, "Property name is required").max(255),
  broker: z.string().max(255).optional().or(z.literal("")),
  status: z.enum(DEAL_STATUSES),

  property_address: z.string().max(500).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(100).optional().or(z.literal("")),
  zip: z.string().max(20).optional().or(z.literal("")),
  msa: z.string().max(255).optional().or(z.literal("")),
  management_company: z.string().max(255).optional().or(z.literal("")),
  unit_count: z.coerce.number().int().positive().optional().or(z.literal("")),
  asking_price: z.coerce.number().positive().optional().or(z.literal("")),
  affordable: z.boolean(),
  vintage_year: z.coerce.number().int().min(1800).max(2100).optional().or(z.literal("")),
  value_add_potential: z.enum(["High", "Medium", "Low"]).optional().or(z.literal("")),
  estimated_equity: z.coerce.number().positive().optional().or(z.literal("")),
  area_median_income: z.string().max(255).optional().or(z.literal("")),
  annual_population_growth: z.string().max(255).optional().or(z.literal("")),
  in_place_avg_rent: z.coerce.number().positive().optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
  hellodata_id: z.string().optional().or(z.literal("")),
});

export type DealFormValues = z.infer<typeof dealSchema>;

interface DealFormProps {
  defaultValues?: Partial<DealFormValues>;
  onSubmit: (values: DealFormValues) => void;
  isLoading?: boolean;
  submitLabel?: string;
}

interface HelloDataResult {
  id: string;
  building_name: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  year_built: number | null;
  number_units: number | null;
}

export function DealForm({ defaultValues, onSubmit, isLoading, submitLabel = "Create Deal" }: DealFormProps) {
  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealSchema),
    defaultValues: {
      property_name: "",
      broker: "",
      status: "New",
      property_address: "",
      city: "",
      state: "",
      zip: "",
      msa: "",
      management_company: "",
      unit_count: "",
      asking_price: "",
      affordable: false,
      vintage_year: "",
      value_add_potential: "",
      estimated_equity: "",
      area_median_income: "",
      annual_population_growth: "",
      in_place_avg_rent: "",
      notes: "",
      ...defaultValues,
    },
  });

  // Auto-calculate estimated equity as 35% of asking price whenever price changes
  const askingPrice = form.watch("asking_price");
  useEffect(() => {
    if (askingPrice && Number(askingPrice) > 0) {
      form.setValue("estimated_equity", parseFloat((Number(askingPrice) * 0.35).toFixed(1)));
    }
  }, [askingPrice, form]);

  // HelloData lookup state
  const propertyName = form.watch("property_name");
  const [results, setResults] = useState<HelloDataResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [fillingDetail, setFillingDetail] = useState(false);
  const [preview, setPreview] = useState<null | {
    in_place_avg_rent: number | null;
    building_quality_score: number | null;
    management_company: string | null;
    review_avg_rating: number | null;
    review_count: number | null;
  }>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const justSelectedRef = useRef(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    const q = (propertyName ?? "").trim();
    if (q.length < 3) {
      setResults([]);
      setShowResults(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();           // cancel any prior in-flight request
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      try {
        // hellodata-search reads `q` from the URL query string, which
        // supabase.functions.invoke can't send cleanly — so we call it via fetch.
        const { data: sessionData } = await supabase.auth.getSession();
        const token =
          sessionData.session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hellodata-search?q=${encodeURIComponent(q)}`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Search failed");
        setResults(json.results || []);
        setShowResults(true);
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // silent: superseded by a newer keystroke
        toast.error("HelloData lookup failed: " + (err as Error).message);
      } finally {
        if (abortRef.current === controller) setSearching(false); // only clear if this run is still active
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [propertyName]);

  const selectResult = async (r: HelloDataResult) => {
    justSelectedRef.current = true;
    // Immediate fill from search-result basics
    form.setValue("property_name", r.building_name || r.street_address || "", { shouldValidate: true });
    if (r.street_address) form.setValue("property_address", r.street_address);
    if (r.city) form.setValue("city", r.city);
    if (r.state) form.setValue("state", r.state);
    if (r.zip_code) form.setValue("zip", r.zip_code);
    if (r.number_units) form.setValue("unit_count", r.number_units);
    if (r.year_built) form.setValue("vintage_year", r.year_built);
    form.setValue("hellodata_id", r.id);
    setShowResults(false);
    setResults([]);
    setPreview(null);

    // Deep fill via hellodata-detail — non-blocking on failure
    setFillingDetail(true);
    try {
      const { data, error } = await supabase.functions.invoke("hellodata-detail", {
        body: { hellodata_id: r.id },
      });
      if (error) throw error;
      const f = (data as any)?.fields ?? {};
      const setIfPresent = (key: any, val: any) => {
        if (val !== null && val !== undefined && val !== "") form.setValue(key, val);
      };
      setIfPresent("property_name", f.property_name);
      setIfPresent("property_address", f.property_address ?? f.street_address);
      setIfPresent("city", f.city);
      setIfPresent("state", f.state);
      setIfPresent("zip", f.zip);
      setIfPresent("msa", f.msa);
      setIfPresent("management_company", f.management_company);
      setIfPresent("unit_count", f.unit_count);
      setIfPresent("vintage_year", f.vintage_year);
      setPreview({
        in_place_avg_rent: f.in_place_avg_rent ?? null,
        building_quality_score: f.building_quality_score ?? null,
        management_company: f.management_company ?? null,
        review_avg_rating: f.review_avg_rating ?? null,
        review_count: f.review_count ?? null,
      });
      toast.success("Filled from HelloData");
    } catch (err) {
      toast.error("HelloData detail failed — basic fields filled. " + (err as Error).message);
    } finally {
      setFillingDetail(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Property Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField control={form.control} name="property_name" render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Property Name * <span className="text-xs text-muted-foreground font-normal">(start typing to search HelloData)</span></FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input placeholder="e.g. Whispering Trails or 111 W Wacker" autoComplete="off" {...field} />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {searching || fillingDetail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </div>
                    {showResults && results.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg max-h-80 overflow-auto">
                        {results.slice(0, 8).map((r) => (
                          <button
                            type="button"
                            key={r.id}
                            onClick={() => selectResult(r)}
                            className="w-full text-left px-3 py-2 hover:bg-accent border-b last:border-b-0 text-sm"
                          >
                            <div className="font-medium">{r.building_name || r.street_address || "Unnamed property"}</div>
                            <div className="text-xs text-muted-foreground">
                              {[r.street_address, r.city, r.state, r.zip_code].filter(Boolean).join(", ")}
                              {r.number_units ? ` · ${r.number_units} units` : ""}
                              {r.year_built ? ` · built ${r.year_built}` : ""}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {showResults && !searching && results.length === 0 && propertyName && propertyName.length >= 3 && (
                      <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg p-3 text-sm text-muted-foreground">
                        No HelloData matches — type to enter manually.
                      </div>
                    )}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="property_address" render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Street Address</FormLabel>
                <FormControl><Input placeholder="e.g. 123 Main St" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="broker" render={({ field }) => (
              <FormItem>
                <FormLabel>Broker</FormLabel>
                <FormControl><Input placeholder="e.g. Newmark" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {dealStatuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="city" render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl><Input placeholder="e.g. Chicago" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="state" render={({ field }) => (
              <FormItem>
                <FormLabel>State</FormLabel>
                <FormControl><Input placeholder="e.g. IL" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="zip" render={({ field }) => (
              <FormItem>
                <FormLabel>ZIP</FormLabel>
                <FormControl><Input placeholder="e.g. 60601" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="msa" render={({ field }) => (
              <FormItem>
                <FormLabel>MSA</FormLabel>
                <FormControl><Input placeholder="e.g. Chicago-Naperville-Elgin" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="management_company" render={({ field }) => (
              <FormItem>
                <FormLabel>Management Company</FormLabel>
                <FormControl><Input placeholder="e.g. Greystar" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="unit_count" render={({ field }) => (
              <FormItem>
                <FormLabel>Unit Count</FormLabel>
                <FormControl><Input type="number" placeholder="e.g. 120" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="asking_price" render={({ field }) => (
              <FormItem>
                <FormLabel>Asking Price ($M)</FormLabel>
                <FormControl><Input type="number" step="any" placeholder="e.g. 25.5" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="vintage_year" render={({ field }) => (
              <FormItem>
                <FormLabel>Year Built</FormLabel>
                <FormControl><Input type="number" placeholder="e.g. 1986" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="estimated_equity" render={({ field }) => (
              <FormItem>
                <FormLabel>Est. Equity ($M)</FormLabel>
                <FormControl><Input type="number" placeholder="Auto: 35% of asking price" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="value_add_potential" render={({ field }) => (
              <FormItem>
                <FormLabel>Value-Add Potential</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {valueAddLevels.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="affordable" render={({ field }) => (
              <FormItem className="flex items-center gap-3 space-y-0 pt-6">
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <FormLabel>Affordable Housing</FormLabel>
              </FormItem>
            )} />
          </CardContent>
        </Card>

        {preview && (
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-normal">
                Pulled from HelloData <span className="text-xs">(persists on create)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">In-place avg rent</div>
                <div className="font-medium tabular-nums">
                  {preview.in_place_avg_rent != null ? `$${preview.in_place_avg_rent.toLocaleString()}` : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Building quality</div>
                <div className="font-medium tabular-nums">
                  {preview.building_quality_score != null ? `${preview.building_quality_score}/100` : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Manager</div>
                <div className="font-medium truncate">{preview.management_company ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Reviews</div>
                <div className="font-medium tabular-nums">
                  {preview.review_avg_rating != null
                    ? `${preview.review_avg_rating.toFixed(1)}★${preview.review_count ? ` (${preview.review_count})` : ""}`
                    : "—"}
                </div>
              </div>
            </CardContent>
          </Card>
        )}


        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Market Data</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField control={form.control} name="area_median_income" render={({ field }) => (
              <FormItem>
                <FormLabel>Avg HH Income (1, 3, 5 mi)</FormLabel>
                <FormControl><Input placeholder="e.g. $133, $138, $145" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="annual_population_growth" render={({ field }) => (
              <FormItem>
                <FormLabel>Annual Pop Growth (1, 3, 5 mi)</FormLabel>
                <FormControl><Input placeholder="e.g. -0.1, -0.1, -0.1%" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="in_place_avg_rent" render={({ field }) => (
              <FormItem>
                <FormLabel>In-Place Avg Rent ($)</FormLabel>
                <FormControl><Input type="number" step="any" placeholder="e.g. 1450" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <RichTextEditor
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    placeholder="Additional notes..."
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Saving..." : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
