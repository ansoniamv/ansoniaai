const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { city, state } = await req.json();
    if (!city || !state) throw new Error("city and state required");

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY missing");

    const slug = `${city}-${city}-${state}`.toLowerCase().replace(/\s+/g, "-");
    const target = `https://www.niche.com/k12/search/best-public-schools/t/${slug}/`;

    const fc = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: target,
        onlyMainContent: true,
        waitFor: 3000,
        formats: [
          "markdown",
          {
            type: "json",
            prompt:
              "Extract the top schools listed on this Niche city ranking page. For each: name, niche_grade (e.g. 'A+', 'A-'), grades_served (e.g. 'PK, K-5'), enrollment, rank_in_list, niche_url (absolute), and any 'Public/Private/Charter' label. Return { city, state, schools: [...] }.",
          },
        ],
      }),
    });

    const data = await fc.json();
    if (!fc.ok) {
      return new Response(
        JSON.stringify({ ok: false, status: fc.status, firecrawl_error: data }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Firecrawl v2 returns { success, data: { markdown, json, metadata, ... } }
    const payload = data.data ?? data;
    return new Response(
      JSON.stringify({
        ok: true,
        target,
        extracted: payload.json ?? null,
        metadata: payload.metadata ?? null,
        markdown_preview: typeof payload.markdown === "string" ? payload.markdown.slice(0, 2000) : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
