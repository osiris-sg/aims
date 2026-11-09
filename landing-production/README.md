# AIMS landing site (ai-ms.io)

Marketing site for AIMS. Next.js 14 App Router, no auth, no MUI. Plain CSS in
`app/globals.css` (tokens at the top: cream ground `#f6f3ec`, white paper, ink `#1c1030`
rules, light and dark). IBM Plex Sans and IBM Plex Mono via `next/font/google`. The look is
paper on a desk, deliberately not the AI-SaaS template: no gradients, glows, icon tiles or
pill buttons, mono for numbers and references, no "AI" in headlines. The portal itself is a separate Vercel project on **app.ai-ms.io**.

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
