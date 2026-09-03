import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { DealForm, type DealFormValues } from "@/components/DealForm";
import { useDeal, useUpdateDeal } from "@/hooks/useDeals";

export default function EditDeal() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: deal, isLoading } = useDeal(id);
  const updateDeal = useUpdateDeal();

  if (isLoading) return <div className="max-w-3xl mx-auto"><Skeleton className="h-48 w-full" /></div>;
  if (!deal) return <p className="text-center text-muted-foreground py-12">Deal not found.</p>;

  const handleSubmit = (values: DealFormValues) => {
    const payload = {
      id: deal.id,
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
      marketed: deal.marketed,
      ai_score: deal.ai_score,
      ai_score_summary: deal.ai_score_summary,
      hellodata_id: values.hellodata_id || deal.hellodata_id || null,
    };

    updateDeal.mutate(payload, {
      onSuccess: () => {
        toast.success("Deal updated");
        navigate(`/deals/${deal.id}`);
      },
      onError: (err) => toast.error("Failed to update: " + err.message),
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Edit Deal</h1>
      <DealForm
        defaultValues={{
          ...deal,
          unit_count: deal.unit_count ?? "",
          asking_price: deal.asking_price ?? "",
          vintage_year: deal.vintage_year ?? "",
          estimated_equity: deal.estimated_equity ?? "",
          value_add_potential: deal.value_add_potential ?? "",
          broker: deal.broker ?? "",
          city: deal.city ?? "",
          state: deal.state ?? "",
          zip: (deal as any).zip ?? "",
          msa: (deal as any).msa ?? "",
          management_company: (deal as any).management_company ?? "",
          property_address: (deal as any).property_address ?? "",
          area_median_income: deal.area_median_income ?? "",
          annual_population_growth: deal.annual_population_growth ?? "",
          in_place_avg_rent: (deal as any).in_place_avg_rent ?? "",
          notes: deal.notes ?? "",
        } as any}
        onSubmit={handleSubmit}
        isLoading={updateDeal.isPending}
        submitLabel="Update Deal"
      />
    </div>
  );
}
