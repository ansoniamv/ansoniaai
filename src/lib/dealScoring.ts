// The buybox scorer lives with the edge functions so the server can score a new
// deal the moment its data lands (onboard-deal). The app imports the same file.
export * from "../../supabase/functions/_shared/dealScoring.ts";
