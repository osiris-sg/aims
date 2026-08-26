# AIMS landing site (ai-ms.io)

Static marketing page for AIMS. Next.js 14 App Router, no auth, no MUI — plain CSS in
`app/globals.css`, Geist via the `geist` package. The portal itself is a separate Vercel
project on **app.ai-ms.io**.

```bash
npm install
npm run dev      # http://localhost:3001
npm run build
```

Copy is in `app/_content/site.ts`; sections are the components under `app/_components/`.

## Domains

| Host | Project |
|---|---|
| `ai-ms.io`, `www.ai-ms.io` | this app (`landing-production/`) |
| `app.ai-ms.io` | `portal-production/` |

Legacy links on www (`/portal`, `/pay/:token`, `/guest/...`, `/scan/:sku`, `/sign-in`) 301 to
the same path on `NEXT_PUBLIC_APP_URL` — see `next.config.mjs`.
