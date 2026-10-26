Prompt for a FRESH Claude Code session (cloud, with network access + CLERK_SECRET_KEY set),
on branch `main` of osiris-sg/aims — paste as the first message:

---
Record the WCT end-to-end flow video on PRODUCTION. Read `WCT_HANDOVER.md`
first, then `api-server-production/scripts/e2e-wct-flow/README.md`.

Facts: rounds 1–3 are on `main` (commits cf89d96, 828091e, 9abd7ec, 8985606)
and deployed. The WCT org id is 5c700000-0000-4000-8000-5c7000000001. Sign in
as admin@osiris.sg via the Clerk sign-in token (00-auth.js; CLERK_SECRET_KEY is
in the environment). Portal https://app.ai-ms.io, API https://aims-ahwy.onrender.com.

Steps:
1. Confirm the WCT org, its three templates, its flags (enableConfirmQuotation,
   enableQuotationESign, enableQuotationToDelivery) and its 14 services exist on
   prod (GET /revenue-items with X-Active-Org-Id). If anything is missing, STOP
   and tell guru which setup script to run — do not run the prod scripts yourself.
2. Run the stages one at a time (node 00-auth.js … 04-complete.js), fixing
   selectors as the real UI dictates. Keep every fix in the scripts.
3. Deliver the videos (one per stage, or stitched) with a one-line caption each,
   and list anything in the flow that did not behave as the handover describes.
Use the WCT test customer "Yoshinoya (Suntec City)"; label all test documents
clearly so guru can void/delete them afterwards.
---
