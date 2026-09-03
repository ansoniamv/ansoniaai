import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEAL_STATUSES } from "@/lib/dealStatus";

const schema = z.object({
  property_name: z.string().trim().min(1, "Required").max(200),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().max(2).optional().or(z.literal("")),
  zip: z.string().trim().max(10).optional().or(z.literal("")),
  latitude: z.string().optional().or(z.literal("")),
  longitude: z.string().optional().or(z.literal("")),
  unit_count: z.string().optional().or(z.literal("")),
  vintage_year: z.string().optional().or(z.literal("")),
  in_place_avg_rent: z.string().optional().or(z.literal("")),
  classic_units_remaining: z.string().optional().or(z.literal("")),
  total_renovated_units: z.string().optional().or(z.literal("")),
  asking_price: z.string().optional().or(z.literal("")),
  t12_noi: z.string().optional().or(z.literal("")),
  t12_opex: z.string().optional().or(z.literal("")),
  broker: z.string().trim().max(200).optional().or(z.literal("")),
  status: z.string(),
});

export type AddDealValues = z.infer<typeof schema>;

const STATUSES = DEAL_STATUSES;

const toNum = (v: string | undefined) => (v && v.trim() !== "" ? Number(v) : null);

export function toDealInsert(v: AddDealValues) {
  return {
    property_name: v.property_name.trim(),
    address: v.address?.trim() || null,
    city: v.city?.trim() || null,
    state: v.state?.trim().toUpperCase() || null,
    zip: v.zip?.trim() || null,
    latitude: toNum(v.latitude),
    longitude: toNum(v.longitude),
    unit_count: toNum(v.unit_count),
    vintage_year: toNum(v.vintage_year),
    in_place_avg_rent: toNum(v.in_place_avg_rent),
    classic_units_remaining: toNum(v.classic_units_remaining),
    total_renovated_units: toNum(v.total_renovated_units),
    asking_price: toNum(v.asking_price),
    t12_noi: toNum(v.t12_noi),
    t12_opex: toNum(v.t12_opex),
    broker: v.broker?.trim() || null,
    status: v.status,
    hellodata_status: "pending" as const,
  };
}

interface Props {
  onSubmit: (values: AddDealValues) => void;
  isLoading?: boolean;
}

export function AddDealForm({ onSubmit, isLoading }: Props) {
  const [values, setValues] = useState<AddDealValues>({
    property_name: "", address: "", city: "", state: "", zip: "",
    latitude: "", longitude: "", unit_count: "", vintage_year: "",
    in_place_avg_rent: "", classic_units_remaining: "", total_renovated_units: "",
    asking_price: "", t12_noi: "", t12_opex: "", broker: "",
    status: "New",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof AddDealValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const [k, msgs] of Object.entries(parsed.error.flatten().fieldErrors)) {
        if (msgs && msgs[0]) fe[k] = msgs[0];
      }
      setErrors(fe);
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  };

  const Field = ({ id, label, type = "text", placeholder, required }: {
    id: keyof AddDealValues; label: string; type?: string; placeholder?: string; required?: boolean;
  }) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        id={id}
        type={type}
        value={values[id]}
        onChange={set(id)}
        placeholder={placeholder}
        inputMode={type === "number" ? "decimal" : undefined}
      />
      {errors[id] && <p className="text-xs text-destructive">{errors[id]}</p>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Property</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field id="property_name" label="Property name" required />
          <Field id="broker" label="Broker" />
          <div className="md:col-span-2"><Field id="address" label="Street address" /></div>
          <Field id="city" label="City" />
          <Field id="state" label="State (2-letter)" placeholder="TX" />
          <Field id="zip" label="ZIP" />
          <div />
          <Field id="latitude" label="Latitude" type="number" />
          <Field id="longitude" label="Longitude" type="number" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Asset basics</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field id="unit_count" label="Unit count" type="number" />
          <Field id="vintage_year" label="Year built" type="number" placeholder="1990–2019" />
          <Field id="in_place_avg_rent" label="In-place avg rent ($)" type="number" />
          <Field id="classic_units_remaining" label="Classic units remaining" type="number" />
          <Field id="total_renovated_units" label="Total renovated units" type="number" />
          <div />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Deal economics</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field id="asking_price" label="Asking price ($)" type="number" />
          <Field id="t12_noi" label="T12 NOI ($)" type="number" />
          <Field id="t12_opex" label="T12 OpEx ($)" type="number" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Status</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5 max-w-xs">
            <Label className="text-xs font-medium">Pipeline status</Label>
            <Select value={values.status} onValueChange={(v) => setValues((p) => ({ ...p, status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving…" : "Add deal"}
        </Button>
      </div>
    </form>
  );
}
