import { FathomConnectionCard } from "@/components/FathomConnectionCard";

/** Each user's Fathom connection. Open to every approved user (Connectors is admin-only). */
export default function FathomPage() {
  return (
    <div className="container mx-auto max-w-3xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Fathom</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your recorded calls so Atlas can answer questions about them.
        </p>
      </div>
      <FathomConnectionCard />
    </div>
  );
}
