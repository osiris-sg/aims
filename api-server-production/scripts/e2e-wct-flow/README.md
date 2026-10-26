# WCT end-to-end flow recording

Playwright scripts that drive the REAL portal (production by default) through
the whole WCT flow and record a video per stage, for showing the client:

| Stage | Who | What the video shows | Output |
| --- | --- | --- | --- |
| 00 | — | Signs in once (Clerk sign-in token), saves `out/auth.json` | — |
| 01 | Office | New WCT quotation → customer → Job Location / Subject → **Add Service → tick all → Add** → Save → Preview (WCT paper) → ⋮ Send for signature | `out/videos/01-quotation/*.webm` |
| 02 | Customer | Opens the link, reads the quotation, name + signature + T&C tick → Accept | `02-sign` |
| 03 | Office | Deliveries shows the auto-created **Draft** → Edit → date → Schedule → DO minted with the Quotation Number | `03-schedule` |
| 04 | Field tech | Guest delivery link: proof photo per line, one signature → run finalized | `04-complete` |
| 05 | Office | The auto-created invoice at the quoted amounts; General Ledger posting | `05-invoice` |

## Prerequisites (production)

1. Code on `main` (rounds 1–3) deployed: Render `aims-ahwy` + Vercel `app.ai-ms.io`.
2. WCT org + templates + services on PROD (guru runs with `!`, from `api-server-production/`):
   ```bash
   npx ts-node --transpile-only scripts/setup-wct-org.ts --env prod --apply
   npx ts-node --transpile-only scripts/setup-wct-templates.ts --env prod --apply
   npx ts-node --transpile-only scripts/setup-wct-services.ts --env prod --apply
   ```
   (`npm run db:push:prod` is NOT needed: Render's build already runs `prisma db push`.)
3. Where the scripts run, outbound access to: `app.ai-ms.io`, `aims-ahwy.onrender.com`,
   `clerk.ai-ms.io`, `api.clerk.com` (plus Clerk/Vercel asset CDNs — simplest is full network access).
4. Env: `CLERK_SECRET_KEY` (the PRODUCTION Clerk backend key — only used to mint a
   10-minute sign-in token for `admin@osiris.sg`; set it as an environment
   variable / secret, never paste it into chat).

## Run

```bash
cd api-server-production/scripts/e2e-wct-flow
node run-all.js            # or one stage: node 01-quotation.js
```

Outputs under `out/` (git-ignored): `auth.json`, `state.json` (ids handed
between stages), `videos/<stage>/*.webm`. Stitch with ffmpeg if one file is wanted:
`ffmpeg -f concat -safe 0 -i list.txt -c copy wct-flow.webm`.

Selectors lean on the editor's `data-tour` anchors (`editor-customer`,
`editor-add-service`, `service-picker-add-selected`, `editor-save`,
`editor-more-menu`, `page-create-button`). Stages 03/04 were written from the
code, not from a live run — expect to adjust a selector or two on first use.

Staging instead: `AIMS_PORTAL_URL=https://aims-mocha.vercel.app AIMS_API_URL=<aims-staging host>`.
Local dev: `AIMS_PORTAL_URL=http://localhost:3000 AIMS_API_URL=http://localhost:4040`.
