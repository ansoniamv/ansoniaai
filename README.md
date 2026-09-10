# Atlas AI

**Deal flow to capital flow, in one system.**

The acquisitions operating system for boutique multifamily private equity. Inbound
flow is scored against your buybox on arrival, tracked through IC, and matched to
the capital partners who actually want it.

An Ansonia Properties company.

## The four pillars

1. **Capture & screen** — the shared acquisitions mailbox is ingested and parsed
   automatically; every deal is scored against the buybox and tiered on arrival.
2. **Pipeline management** — stage, status, owner, next action and decision
   history, with the reason for every pass attached to the record.
3. **Capital partner intelligence** — each engaged firm as a living record: check
   size, geography, product type, structure preference, relationship warmth, last
   touch, and what they have already seen.
4. **Deal-to-partner matching** — a deal clears IC and Atlas returns a ranked call
   list. Outreach is drafted; a person approves and sends. Nothing auto-fires.

## Naming

- **Atlas AI** is the platform.
- **Atlas** is the assistant inside it — the intelligence the product is named
  after. It proposes changes; a human approves them. Surfaced as **Suggestions**
  and **Ask Atlas**.
- **Acquisitions Inbox** (deal flow) and **Outlook Inbox** are separate surfaces
  and are deliberately not called Atlas.

## Stack

Vite · React · TypeScript · Tailwind · shadcn/ui · Supabase (Postgres, Auth, Edge
Functions) · Playwright + Vitest.

AI runs on Claude Opus 5 via `supabase/functions/_shared/anthropic.ts`, which is
the single place the model is chosen.

## Local development

```bash
npm install
npm run dev      # vite dev server
npm run build    # production build
npx playwright test
```

Environment variables live in `.env` (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`). Server-side secrets
are Supabase edge-function secrets and never `VITE_`-prefixed — see
[SECURITY.md](SECURITY.md).

## Brand

Two colours only: `#002752` (navy) and `#6AA3D8` (sky), defined as tokens in
`src/index.css`. Asset placement rules are in
[public/brand/README.md](public/brand/README.md).

## Further reading

- [SECURITY.md](SECURITY.md) — security posture, deployment checklist, open items
- [MIGRATION.md](MIGRATION.md) — the Supabase project migration runbook
