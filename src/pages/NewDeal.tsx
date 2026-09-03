import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { DealForm, type DealFormValues } from "@/components/DealForm";
import { useCreateDeal } from "@/hooks/useDeals";

export default function NewDeal() {
  const navigate = useNavigate();
  const createDeal = useCreateDeal();

  const handleSubmit = (values: DealFormValues) => {
    const payload = {
      property_name: values.property_name,
      broker: values.broker || null,
      status: values.status as any,
      property_address: values.property_address || null,
      city: values.city || null,
      state: values.state || null,
      zip: values.zip || null,
      msa: values.msa || null,
      management_company: values.management_company || null,
      unit_count: values.unit_count ? Number(values.unit_count) : null,
      asking_price: values.asking_price ? Number(values.asking_price) : null,
      affordable: values.affordable,
      vintage_year: values.vintage_year ? Number(values.vintage_year) : null,
      value_add_potential: (values.value_add_potential as any) || null,
      estimated_equity: values.estimated_equity ? Number(values.estimated_equity) : null,
      area_median_income: values.area_median_income || null,
      annual_population_growth: values.annual_population_growth || null,
      in_place_avg_rent: values.in_place_avg_rent ? Number(values.in_place_avg_rent) : null,
      notes: values.notes || null,
      hellodata_id: values.hellodata_id || null,
      hellodata_status: "pending" as const,
    };

    createDeal.mutate(payload as any, {
      onSuccess: (deal) => {
        // HelloData enrichment fires automatically via the deals AFTER INSERT trigger.
        toast.success("Deal added — enriching in background");
        navigate(`/deals/${deal.id}`);
      },
      onError: (error) => {
        toast.error("Failed to add deal: " + error.message);
      },
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-2">
      <div>
        <h1 className="font-display text-2xl tracking-tight">Add deal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Start typing a property name to search HelloData. Selecting a match auto-fills address, units, vintage, MSA, and manager.
        </p>
      </div>
      <DealForm onSubmit={handleSubmit} isLoading={createDeal.isPending} submitLabel="Add deal" />
    </div>
  );
}
