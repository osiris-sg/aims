# AIMS landing site (ai-ms.io)

Marketing site for AIMS. Next.js 14 App Router, no auth, no MUI. Plain CSS in
`app/globals.css` (brand tokens at the top: white and soft-grey surfaces, deep purple
`#431078` / `#8523BD` accents, light and dark). Manrope (headings) and DM Sans (body) via
`next/font/google`. The portal itself is a separate Vercel project on **app.ai-ms.io**.

```bash
npm install
npm run dev      # http://localhost:3001
npm run build
```

Copy is in `app/_content/site.ts`; sections are the components under `app/_components/`.
Home page order: Hero, Marquee, UseCases ("AIMS in action" walkthrough), Modules (module
explorer with the links between modules), Agent (steps + flow diagram), Platform, LogoStrip, Cta.
Logos and photos live in `app/_assets/` and are imported, not served from `/public`, so they
load under the `/landing-static` asset prefix on the legal pages the portal proxies.

## Domains

| Host | Project |
|---|---|
| `ai-ms.io`, `www.ai-ms.io` | this app (`landing-production/`) |
| `app.ai-ms.io` | `portal-production/` |

Legacy links on www (`/portal`, `/pay/:token`, `/guest/...`, `/scan/:sku`, `/sign-in`) 301 to
the same path on `NEXT_PUBLIC_APP_URL` — see `next.config.mjs`.
