# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a monorepo containing an Asset and Inventory Management System (AIMS) — an asset/inventory/document platform that has grown a full double-entry accounting subsystem. It has **five deployables**:

- **api-server-production/**: NestJS backend API server with PostgreSQL/Prisma (Neon)
- **portal-production/**: Next.js frontend portal (also ships a Capacitor Android field app) — served on `app.ai-ms.io`
- **landing-production/**: Next.js marketing site for `ai-ms.io` (no auth, no MUI; copy in `app/_content/site.ts`); 301s legacy `/portal`, `/pay`, `/guest`, `/scan`, `/sign-in` links to `app.ai-ms.io`
- **email-ingest-worker/**: Cloudflare Email Worker — routes `docs+{orgId}@…` mail to the AIMS ingestion webhook
- **whatsapp-group-bridge/**: Node `whatsapp-web.js` bridge for group messages

**Branch topology:** `main` = production (auto-deploys: backend → Render, portal → Vercel `app.ai-ms.io`, landing → Vercel `ai-ms.io`). `elroy/dev` = staging/work branch (Vercel previews served at `aims-mocha.vercel.app`). The old `yx/dev` was renamed to `main` 2026-07-08; `master` is a stale pre-2026 branch — never target it.

**Deeper docs:** `docs-site/` (Mintlify) is the full documentation set. Root-level specs (`ACCOUNTING_ARCHITECTURE.md`, `EXTERNAL_API_AND_INGESTION_HANDOVER.md`, `EMAIL_INGESTION_PLAN.md`, `POSTING_QUEUE_AND_JSON_INGESTION_SPEC.md`, `WATER_SG_INTEGRATION.md`) cover individual subsystems. `manual/` holds the end-user manual source.

## AIMS Guide assistant — keep its knowledge in sync (EVERY feature you ship)

The in-app help bubble ("AIMS Guide", bottom-right of the portal — GLOBAL for
every org, deliberately not feature-flagged) answers "how do I…" questions, navigates users, and
plays spotlight walkthroughs. Its ONLY knowledge of the app is
`api-server-production/src/guide/app-knowledge.ts` — it does NOT read the code.

**Whenever you ship or change a user-facing feature, you MUST:**
1. Add/update the matching line in `app-knowledge.ts` (which screen, which
   button, what it does, flags/roles that gate it). If the feature is retired,
   remove its line.
2. If the feature deserves a walkthrough: stamp a `data-tour="…"` attribute on
   the key control, document the anchor token in `guide.service.ts`
   (KNOWLEDGE_FOOTER), and add a prebuilt guide in
   `portal-production/app/portal/components/GuideAssistant/guides.ts`.

Other invariants: legacy modules are blocklisted in `LEGACY_MODULES`
(duplicated in `guides.ts` AND `guide.service.ts` — keep in sync); the
assistant only sees screens the current user's org + role allow; guide
descriptions must distinguish create-from-scratch vs upload-existing-file.
Full context: memory note `guide-assistant.md`.

## Activity Log — every feature must be captured (EVERY feature you ship or modify)

AIMS has a global user-action log (guru, 2026-08: "capture all user actions").
Storage: `ActionLog` Prisma model. Writer: `ActionLogInterceptor`
(`api-server-production/src/action-log/`), registered as a global
`APP_INTERCEPTOR` — it auto-logs **every HTTP request** with a typed actor
(`USER` | `API_KEY` | `GUEST` | `SYSTEM` — non-human actors display as
**"System creation"**). Viewer: portal **/portal/audit → "Activity Log" tab**
(`enableActionLog` flag, default ON for all orgs; `audit:read` permission).

**Whenever you add or modify a feature, make sure its actions land in the
Activity Log correctly:**
1. **Plain HTTP endpoints** are covered automatically — but verify the row is
   *meaningful*, not just present:
   - New **POST-that-is-really-a-list** endpoint (house convention "POST / =
     list") → add it to `VIEW_POST_RE` in `action-log.interceptor.ts`, or it
     logs as a bogus CREATE.
   - New **workflow verb** in a path (confirm/void/approve/sign/…) → add it to
     `VERB_ACTIONS` so the action chip is semantic instead of a generic
     CREATE/UPDATE.
   - New **high-frequency background endpoint** (heartbeat, ping, poll) → add
     it to `SKIP_PATHS` / `SKIP_GET_PATHS`, or it floods the log.
2. **Non-HTTP work** (cron jobs, queue workers, webhook handlers that respond
   early and process async) is NOT seen by the interceptor → inject
   `ActionLogService` (global module, no import needed) and call
   `actionLog.system('<job-name>', ACTION, resource, { organizationId, resourceId, details })`
   — this stamps the "System creation" actor. Existing examples:
   `recurring-invoices.service.ts` cron, `submit.service.ts` worker.
3. **New auth surface / actor kind** (new token guard, new public route group,
   new integration) → extend `resolveActor()` in the interceptor so it doesn't
   fall through to a generic SYSTEM row.
4. **Renamed/moved routes** → check the skip lists and `VIEW_POST_RE` still
   match the new paths.

Do NOT confuse this with the legacy `AuditLog` table (document "History &
notes" + old audit page) — that stays as-is; per-document history still goes
through `logDocumentEvent`. Full context: memory note `user-action-log-study.md`.

## Development Commands

### Backend (api-server-production/)
```bash
# Development
npm run start:dev          # Start dev server with watch mode
npm run start:debug        # Start with debug mode
npm run start:staging      # Dev server against .env.staging

# Database — 3 separate Neon DBs: dev (.env), staging (.env.staging), prod (.env.production)
npm run db:push            # Push schema changes to DEV database
npm run db:push:staging    # Push schema to STAGING
npm run db:push:prod       # Push schema to PROD
npm run db:studio          # Prisma Studio (also :staging / :prod variants)
npm run seed               # Seed the database

# Testing & Quality
npm run test               # Run unit tests (also test:watch, test:cov)
npm run test:e2e           # Run end-to-end tests
npm run lint               # ESLint with auto-fix
npm run format             # Prettier formatting

# Production
npm run build              # ⚠ NOT a plain compile: runs `nest build && npx prisma db push`
                           #   — it MUTATES whatever DB DATABASE_URL points at.
                           #   Use `npx nest build` for a compile-only check.
npm run start:prod         # Start production server

# Admin / role scripts
npm run assign-superadmin    # Assign superadmin role
npm run assign-osirisadmin   # Assign osiris admin role (global admin@osiris.sg)
npm run debug-user-roles     # Debug user roles
npm run setup-database / setup-user
```

There are ~40 more one-off scripts in `package.json` (template seeders, nav
migrations, data backfills, `render-env:*` sync). Destructive ones follow a
`:dry` / `--dry-run` convention — **always run the dry variant first**.

### Frontend (portal-production/)
```bash
npm run dev               # Next.js dev server with Turbo
npm run build             # Build for production (safe — no DB side effects)
npm run start             # Start production server
npm run lint              # Next.js linting
```

### Root Level
The root package.json only contains Xero integration dependencies (`xero-node`).

## Architecture Overview

### Backend Architecture (NestJS)
- **Modular Structure**: ~65 feature modules under `src/`, each with controller/service/DTOs, registered in `app.module.ts`
- **Authentication**: Clerk via global `ClerkAuthGuard` (APP_GUARD) with custom decorators; exceptions below
- **Database**: PostgreSQL (Neon) with Prisma ORM — runtime connects through the **Neon serverless driver over WebSocket/443** (`PrismaService` + `@prisma/adapter-neon`); CLI/scripts use plain 5432. Multi-tenant: every model is scoped by `organizationId`
- **Schema scale**: ~73 models — beyond the core (Organization, Asset, Customer, Document, Inventory, Project, roles) there is a full GL (`ChartOfAccount`, `JournalEntry/Line`, `Bill`, `BankStatement*`, `FixedAsset`, `Budget`, `CostCenter`, `TaxRate`, `Recurring*Template`), integrations (`WhatsApp*`, `ApiKey`, `XeroSyncRun`, `EmailIngest*`), and AI (`DocumentEmbedding`, `AccountMemory`)
- **AI**: backend uses both `@anthropic-ai/sdk` (Guide assistant, document assistant, WhatsApp agent) and `openai` (embeddings)
- **API Documentation**: Swagger UI available at `/api` endpoint

### Frontend Architecture (Next.js)
- **App Router**: Next.js 14 app directory structure
- **State Management**: new code uses **TanStack React Query + local hooks**; Redux Toolkit + Saga survives only in ~16 legacy `containers/` (don't add new Redux)
- **UI Framework**: Material-UI v6 with custom theming; dark mode via `globals.css` vars — every UI change must work in both themes
- **Authentication**: Clerk (`middleware.ts`)
- **Organization Context**: multi-tenant org switching; admin "Viewing as org" sends `X-Active-Org-Id` from `sessionStorage("aims-admin-active-org")` — every new fetch helper must inject it
- **Mobile / field app**: Capacitor Android shell (`capacitor.config.ts`, `android/`) with NFC scanning + background geolocation, served by the `app/(field)/` route group

### Key Domain Concepts
- **Organizations**: Multi-tenant structure where all data is organization-scoped; per-org feature flags + `MODULE_CATALOG` module toggles
- **Assets**: Hierarchical asset management with parent-child relationships
- **Documents**: ALL document types (INVOICE, BILL, QUOTATION, PO, CN/DN…) live in the unified `Document` table — never create a per-type table
- **Accounting**: documents auto-post double-entry journals to the GL; Xero-style reports; posting queue for accountant review
- **Inventory**: Asset-based inventory tracking with QR codes (tracked by serial, `Inventory.sku`)
- **Projects**: Project → Deployment (RENTAL/SALE/SERVICE) → Assignments + Documents; recurring invoicing anchors on deployments
- **Users & Permissions**: Role-based access control; org membership needs BOTH `UserOrganization` AND `UserRole` rows

## Key Directories

### Backend Structure (`api-server-production/src/`)
- Core: `auth/` (Clerk guard/strategy/decorators), `common/` (Prisma, Xero, S3, PDF generator, audit, org-features), `organizations/`, `users/`, `assets/`, `inventory/`, `customers/`, `suppliers/`, `projects/`, `dashboard/`
- Documents: `documents/`, `documentTemplates/` (separate module), `document-numbering/`, `document-extraction/`, `deliveries/`, `orders/`
- Accounting: `accounting/`, `journal/`, `bills/`, `receipts/`, `payments/`, `bank-rec/`, `close/`, `budgets/`, `cost-centers/`, `fixed-assets/`, `statements/`, `posting-queue/`, `posting-preview/`, `recurring-invoices/`, `anomalies/`
- AI: `guide/`, `ask/`, `document-assistant/`, `account-memory/`
- External surface: `api-v1/` (API-key `/v1` API), `public-api/`, `public-delivery/`, `public-pay/`, `ingestion/` (JSON), `ingestion-email/`, `whatsapp/`, `xero-sync/`, `import/`
- `prisma/`: schema + seed. **Migrations are abandoned** — the workflow is `db:push`, not `prisma migrate`

### Frontend Structure (`portal-production/`)
- `app/portal/`: main portal — `accounting/` (26 pages), `sales/`, `masterfiles/`, `crm/` (incl. `whatsapp/`), `reports/`, `deliveries/`, `admin/`, `settings/`…
- Public route groups: `app/(field)/` (NFC field-tech flow), `app/pay/[token]/`, `app/guest/delivery/[token]/`, `app/scan/[sku]/`, `app/(submit)/`
- `containers/`: **legacy** Redux/saga features (incl. the 6.4k-line `DocumentTemplates` editor heart) — new code goes in a route folder under `app/portal/<area>/` with co-located `_components/`, `hooks/`
- `components/`: shared UI — `PageTable.tsx` (mandatory for all list pages), `Sidebar/DynamicSidebarContent.tsx` (drives nav), ReportShell kit, `GuideAssistant/`
- `form-components/`, `helpers/`

## Working with the Codebase

### Database Changes
1. Modify `api-server-production/prisma/schema.prisma`
2. Run `npm run db:push` (dev) — staging/prod need the `:staging`/`:prod` variants and hit **separate Neon DBs**; pushing schema to the wrong env 500s the app
3. Update DTOs and services accordingly
4. New `Organization` columns must ALSO be added to `ClerkAuthGuard`'s two hand-rolled selects, or non-admin users silently miss them

### Adding New Features
1. Backend: new module in `src/` (controller/service/DTOs), register in `app.module.ts`, grant `resource:action` permissions to superadmin + Admin roles in every org (else 403s)
2. Frontend: route folder under `app/portal/<area>/` using React Query (NOT a new Redux container)
3. Routes: `import { ROUTES } from "@/routes"` resolves to **`portal-production/routes.ts`** (repo root of the portal), NOT `app/portal/routes.ts` — the two have diverged; update the root one (and the sidebar via `DynamicSidebarContent.tsx` / `MODULE_CATALOG`)
4. New features go behind a per-org feature flag togglable in the admin panel; new modules also need appending to each org's restrictive `Role.allowedModules`
5. Update the Guide assistant knowledge (section above)

### Authentication & Authorization
- Clerk protects the portal API by default (global guard); **exceptions**: `@Public()` routes, `public-api/`/`public-delivery/`/`public-pay/` (own API-key guards), `api-v1/` (`api-v1-key.guard.ts`), ingestion webhook (`X-Ingest-Token`), WhatsApp webhook (HMAC `X-Hub-Signature-256`)
- Use `@Permissions()` decorator for endpoint-level permissions
- Organization context is automatically injected via guards; `admin@osiris.sg` is the global osirisadmin bypass

### Document Templates
- Located in `containers/DocumentTemplates/components/`
- Support dynamic field generation and customization
- PDF generation with signature support (backend: Puppeteer via `pdf-generator.service.ts`)

#### Cross-Org Shared Template Library
Document templates are a **cross-org shared pool**, not org-private:
- `DocumentTemplate` rows each have an owner `organizationId`, but the admin
  "Manage Templates" dialog (`app/portal/admin/organizations/[id]/page.tsx`)
  lists **every org's** templates of a type so an admin can activate any of them
  for the current org.
- `OrganizationActiveTemplate(organizationId, type, templateId)` (unique on all
  **three** columns) records the shared templates each org has activated —
  **multiple templates can be active per org+type**, with an `isPrimary` flag
  marking the one used for headless creation (at most one primary per org+type,
  enforced in the service, not the DB). Endpoints:
  `/variants/:id/activate|deactivate|rename|primary`.
- Resolution (`getDocumentTemplateByType`, the AI-upload path
  `documents.service.ts createFromExtraction`, and mirrors) walks a chain:
  primary selection → `isDefault` among selected → newest selected → org's own
  legacy `isActive` → cross-org seeded `isDefault` → any (so pre-existing orgs
  work without migration).
- **Propagation:** editing a shared template changes it for every org that
  activated it ("edit once → all orgs update"). It is NOT a clone model.
- The `GET /documentTemplates/variants/:type` endpoint is cross-org; only admin
  pages call it (no user-facing variant switcher), so it doesn't leak other orgs'
  templates to regular users.
- `CleanDocumentPreview` only differentiates designs by
  `tableColumnOrder`/`columnLabels`/`internalColumns` (read from inside its
  `data` prop) — not `styleConfig`/`formFields`/fonts. Seeded defaults live in
  `api-server-production/src/organizations/default-templates.ts`.
