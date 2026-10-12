import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The few columns the map actually plots.
 *
 * The map used useDeals(), which selects 136 columns — including
 * hellodata_payload, a JSON blob totalling 4.5 MB across 97 deals with one row
 * at 872 kB. The whole response is about 9 MB, and the map reads eleven fields
 * from it. On a slow connection that is a page which sits on "Loading deals…"
 * long enough to look broken, for data it never touches.
 *
 * Deliberately a separate hook rather than a narrower useDeals: the list and
 * detail views legitimately need the wide row, and quietly trimming their query
 * to suit the map would break them in ways no test covers.
 */
const MAP_COLUMNS = [
  "id",
  "property_name",
  "address",
  "property_address",
  "city",
  "state",
  "status",
  "unit_count",
  "vintage_year",
  "latitude",
  "longitude",
  "esri_enrichment_stale",
].join(",");

export type MapDeal = {
  id: string;
  property_name: string | null;
  address: string | null;
  property_address: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
  unit_count: number | null;
  vintage_year: number | null;
  latitude: number | null;
  longitude: number | null;
  esri_enrichment_stale: boolean | null;
};

export function useMapDeals() {
  return useQuery({
    queryKey: ["map_deals"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select(MAP_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as MapDeal[];
    },
  });
}
