# AIMS landing site (ai-ms.io)

Marketing site for AIMS. Next.js 14 App Router, no auth, no MUI. Plain CSS in
`app/globals.css`, tokens at the top from **Brand Kit Guidelines R01**: cream `#fcf8f3` pages,
navy `#040324` text, deep purple `#370054` buttons and dark bands (purple→navy diagonal with a
lime bar), teal `#297e89` and lime `#c3d833` accents, grey `#8b8c90`. DM Sans via
`next/font/google`; IBM Plex Mono only inside the sample documents. Pill buttons, soft rounded
cards, thin lime rules. Light only. The structure is still paper on a desk, not the AI-SaaS
template: no icon tiles, no "AI" in headlines, no helper text under things. The portal itself is a separate Vercel project on **app.ai-ms.io**.

```bash
npm install
npm run dev      # http://localhost:3001
npm run build
```

Copy is in `app/_content/site.ts`; sections are the components under `app/_components/`.
Home page order: Hero (`Desk.tsx`: a step rail and a pile of papers that advances on its own until touched; papers in `Papers.tsx`, data in `DESK` / `DESK_STEPS`),
Trail (the same job as a ledger, three jobs in `TRAILS`), Modules (index + links between
modules), Agent (three plain rows beside the chat mock), Trades (who it is for, `TRADES`),
Platform (list + one portal still, `public/screens/dashboard.png`, no video), LogoStrip, Cta. Logos live in `app/_assets/` and are imported, not served from
`/public`, so they load under the `/landing-static` asset prefix on the legal pages the portal
proxies. Product screenshots in `public/screens/` are taken from the AIMS Demo org on
www.ai-ms.io/portal (the role-home UI), never from a client org.

## Domains

| Host | Project |
|---|---|
| `ai-ms.io`, `www.ai-ms.io` | this app (`landing-production/`) |
| `app.ai-ms.io` | `portal-production/` |

Legacy links on www (`/portal`, `/pay/:token`, `/guest/...`, `/scan/:sku`, `/sign-in`) 301 to
the same path on `NEXT_PUBLIC_APP_URL` — see `next.config.mjs`.
