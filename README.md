# Deal Pipeline Pro

Acquisitions platform for Ansonia Properties: a broker-email inbox that is
gated, scored and summarised automatically, plus capital-partner tracking and
client-facing pipeline tearsheets.

## Stack

- **Frontend** — React + Vite + TypeScript, deployed on Vercel. Pushing `main`
  builds and ships the frontend.
- **Backend** — Supabase (Postgres + RLS) with Deno edge functions under
  `supabase/functions`. **Edge functions are not deployed by pushing `main`** —
  each one needs an explicit `supabase functions deploy <name>`.
- **AI** — Anthropic (Claude) direct, through `supabase/functions/_shared/ai.ts`.
  There is no fallback provider.
- **Mail** — Microsoft Graph app-only, through `_shared/graphToken.ts` and
  `_shared/graphMail.ts`.

## Local development

```sh
npm install
npm run dev
```

`npm run build` produces the production bundle; `npm run lint` and
`npx vitest run` are the checks CI does not yet run for you.

## Deploying

```sh
# frontend
git push origin main            # Vercel builds from main

# one edge function
npx supabase functions deploy <name> --project-ref <ref>

# migrations
npx supabase db push --project-ref <ref>
```

A half-deploy reads as success: if a change touches both a migration and a
function, order matters. Code that reads a new column must ship after the
migration that adds it; code that stops reading a dropped column must ship
before the migration that drops it.
