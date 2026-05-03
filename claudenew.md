# claudenew.md

Working doc for the AIMS monorepo. The repo also has a `CLAUDE.md` at root which is treated as read-only reference; this file extends it with the deeper investigation results requested for the diagnosis flow. Today's date: 2026-04-30.

## 1. Project Overview

AIMS (Asset & Inventory Management System) is a multi-tenant NestJS + Next.js monorepo for tracking physical inventory, generating sales documents (quotation / sales order / delivery order / invoice / credit + debit notes), and integrating with Xero. Every record is scoped to an `Organization`, and most write paths assume an org context resolved from the Clerk JWT via `ClerkAuthGuard`. Customers can have multiple `SiteOffice`s; `Project`s belong to an organization and link to a site office (and through it, transitively to a customer); inventory items belong to assets and are assigned to projects via `Assignment` rows.

The repo contains a one-off Xero historical-import flow under `src/import/` and `app/portal/settings/import-invoices/`. It reads pre-extracted invoices from a JSON seed file into `ImportInvoice` rows, lets a human review/edit each in a portal screen, and on Confirm runs a 5-step "translation" sequence that creates a SiteOffice (if new), a Project (if missing), Assets, and a Document with related DocumentItem / Inventory / Assignment rows. This import flow is the focus of the previous-session carry-forward in §11.

## 2. Tech Stack

### api-server-production
- Language: TypeScript (`^5.1.3`), Node 20 (`@types/node ^20.3.1`)
- Framework: NestJS `^10.0.0` (Express platform via `@nestjs/platform-express`)
- DB: PostgreSQL via Prisma `^6.4.1` (`@prisma/client` `^6.4.1`)
- Auth: Clerk (`@clerk/backend ^1.24.0`, `@clerk/clerk-sdk-node ^4.13.23`) wired through `passport-custom` strategy
- Validation: `class-validator ^0.14.1` + `class-transformer ^0.5.1` via global `ValidationPipe` (`src/main.ts:53`)
- Swagger: `@nestjs/swagger ^7.4.2`, mounted at `/api`
- Other libs of note: `xero-node ^13.0.0`, `puppeteer ^24.24.0` (PDF gen), `pdf-parse ^2.2.2`, `pdf-to-png-converter ^3.10.0`, `openai ^6.2.0`, `resend ^6.4.2` (email), `@aws-sdk/client-s3 ^3.779.0`, `qrcode ^1.5.4`, `morgan` (request log), `moment`

### portal-production
- Language: TypeScript (`^5`)
- Framework: Next.js `14.2.15` (App Router, Turbo dev)
- State: Redux Toolkit `^2.5.1` + redux-saga `^1.3.0` + react-redux `^9.2.0`; also `@tanstack/react-query ^5.76.1` in places
- UI: MUI `^6.4.2` (`@mui/material`, `@mui/icons-material`, `@mui/x-date-pickers`)
- Auth: `@clerk/nextjs 5.2.4`
- Forms: `react-hook-form ^7.54.2`, `yup ^1.6.1`, `zod ^3.25.7`, `@hookform/resolvers ^3.10.0`
- Other: `axios ^1.7.9`, `react-toastify`, `react-signature-canvas`, `react-to-print`, `xlsx`, `dayjs`, `moment`

### Root
- Single dependency: `xero-node ^13.0.0` (`package.json` only contains this; everything else is per-app).

## 3. Repository Layout

```
aims/
├── CLAUDE.md                     # read-only project reference
├── ACCOUNTING_MODULE_SETUP.md    # standalone docs (not authoritative on current code)
├── ACCOUNTING_SETUP_COMPLETE.md  # standalone docs
├── MODULAR_SYSTEM_README.md      # standalone docs
├── TERMINAL_SETUP.md             # docs on the helper terminal scripts
├── package.json                  # root only declares xero-node
├── open-terminals.sh             # spawns Mac terminals for both apps
├── setup-terminals.sh            # one-time setup for terminal helpers
├── scripts/
│   └── open-terminals.js         # cross-platform terminal opener (helper)
├── api-server-production/        # NestJS backend (primary focus)
│   ├── src/                      # all feature modules
│   ├── prisma/                   # schema.prisma + migrations + seed.ts
│   ├── scripts/                  # one-off TS/PY admin & migration scripts
│   ├── config/configuration.ts   # ConfigModule loader
│   ├── helpers/                  # CustomExceptionFilter + CustomResponseInterceptor
│   ├── docs/                     # PDF_GENERATION_SETUP.md
│   ├── test/                     # e2e Jest setup
│   ├── nest-cli.json
│   ├── tsconfig.json / tsconfig.build.json
│   ├── XERO_INTEGRATION.md
│   └── package.json
└── portal-production/            # Next.js frontend (lower priority)
    ├── app/                      # App Router pages, including app/portal/...
    ├── containers/               # Feature containers (Redux slices/sagas + UI)
    ├── components/               # shared UI components
    ├── form-components/          # generic form widgets
    ├── helpers/                  # request.ts (axios + RequestService)
    ├── hooks/                    # cross-feature hooks (useAssetsOverview, etc.)
    ├── contexts/, themes/, root-saga/, store.ts, routes.ts (top-level config)
    ├── middleware.ts             # Clerk middleware - protects all routes except /sign-in
    ├── next.config.mjs           # redirects, image domains, env passthrough
    └── package.json
```

## 4. api-server-production Deep Dive

### Entry point
- `src/main.ts` — bootstraps Nest, registers CORS, `morgan('dev')` request log, global `ValidationPipe` with `transform: true` and `enableImplicitConversion: true`, global `CustomExceptionFilter`, global `CustomResponseInterceptor`. Listens on `process.env.PORT || 4040` (`main.ts:61`). Swagger UI registered at path `/api` via `AppModule.registerSwagger` (`app.module.ts:83-94`).

### Modules registered in `AppModule` (`src/app.module.ts:37-68`)
Order matches the imports array. Each is a feature module with its own `*.controller.ts` + `*.service.ts` + (mostly) `dto/` folder.

| Module | Folder | Purpose |
|---|---|---|
| Assets | `src/assets/` | Asset CRUD + hierarchy (parent/child) + quantity adjustment for untracked products |
| Categories | `src/categories/` | Asset categories per organization |
| Auth | `src/auth/` | Clerk passport strategy + `ClerkAuthGuard` (registered globally via `APP_GUARD`) + `Permissions` decorator + `UserOrganization` param decorator |
| Inventories | `src/inventories/` | Inventory item CRUD scoped to org; QR code generation lives here per `qrcode` dep |
| Customers | `src/customers/` | Customer + SiteOffice + ContactDetail CRUD; assigns salesman from `UserOrganization` |
| Suppliers | `src/suppliers/` | Supplier CRUD |
| DocumentTemplates | `src/documentTemplates/` | Template variants (`TI`, `TI2`, `QO1`, etc.) per org per type, plus `templateFieldDefinitions.ts` |
| Uploads | `src/uploads/` | S3 upload endpoints |
| Documents | `src/documents/` | Sales/purchase documents (INVOICE, QUOTATION, DELIVERY_ORDER, etc.); creates DocumentItem + TimelineItem; PDF generation via `PdfGeneratorService`; email via `EmailService`/Resend |
| TimelineItems | `src/timeline-items/` | Audit-style timeline entries linked to Document or Inventory |
| Roles | `src/roles/` | Role CRUD per org |
| Permissions | `src/permissions/` | Global permission catalog |
| Users | `src/users/` | Application user records + role/org assignments |
| Projects | `src/projects/` | Project CRUD + `Assignment` between Project and Inventory |
| Organizations | `src/organizations/` | Organization CRUD; logo/stamp uploads; tax rate; bank details |
| Admin | `src/admin/` | Admin-only views (audit logs, cross-org dashboards) |
| Dashboard | `src/dashboard/` | Aggregated dashboard stats |
| DocumentExtraction | `src/document-extraction/` | OpenAI-powered PDF/image extraction → structured fields |
| Configuration | `src/configuration/` | Per-org module enable/disable, custom fields, UI config |
| PriceHistory | `src/price-history/` | Records unit-price history from confirmed invoices |
| Payments | `src/payments/` | Payment recording against Documents |
| Transactions | `src/transactions/` | Unified ledger (`TransactionType` enum) |
| Statements | `src/statements/` | Statement-of-account generation |
| Email | `src/email/` | `email.service.ts` wrapping Resend |
| Import | `src/import/` | **Xero historical-invoice import flow.** Used only for Biofuel; ORGANIZATION_ID hardcoded — see §10 / §11. |

Common (not registered in AppModule directly — its providers are wired by individual modules): `src/common/prisma.module.ts` exporting `PrismaService`, `xero.controller.ts` / `xero.service.ts` for OAuth callback, `audit.service.ts` + `audit.interceptor.ts` (interceptor exists but is not globally registered in `app.module.ts`; modules that want auditing wire it themselves), `services/s3.service.ts`, `services/pdf-generator.service.ts`, `interceptors/custom-fields.interceptor.ts` and `decorators/with-custom-fields.decorator.ts`.

### Request lifecycle (traced through `POST /import/create-project`)
1. `main.ts:48-62` — Express request enters Nest. `morgan('dev')` logs the line.
2. `ValidationPipe` (global, `main.ts:53-58`) is set up — but `ImportController.createProject` (`src/import/import.controller.ts:175-184`) takes a plain `@Body() body: { name; customerId; siteOfficeId?; ... }` with no DTO, so the pipe has nothing to validate. (Contrast with `ProjectsController.createProject` at `src/projects/projects.controller.ts:41` which uses `CreateProjectDto`.)
3. `ClerkAuthGuard` runs as `APP_GUARD` (`src/app.module.ts:74-77`). It calls `super.canActivate` which delegates to `passport-custom` Strategy `ClerkStrategy.validate` (`src/auth/clerk.strategy.ts:19-39`): pulls Bearer token, calls `verifyToken` from `@clerk/backend`, then `clerkClient.users.getUser(sub)`, attaches user to `req.user`.
4. Back in `ClerkAuthGuard.canActivate` (`src/auth/clerk-auth.guard.ts:17-171`): runs two parallel Prisma queries — `userRole.findMany` for roles+permissions, `userOrganization.findFirst` for org. Attaches `request.userOrganization` and `request.isOsirisAdmin`. Reads `@Permissions()` metadata; if absent, allows. The `import` controller has `@UseGuards(ClerkAuthGuard)` but no `@Permissions()`, so any authenticated user passes.
5. `ImportController.createProject` (`src/import/import.controller.ts:175-184`) calls `ImportService.createProject(body)` and wraps thrown errors into `HttpException(error.message, 500)`.
6. `ImportService.createProject` (`src/import/import.service.ts:348-365`) writes to Postgres via `prisma.project.create`. **Note:** it ignores `req.userOrganization` entirely and uses the file-level `ORGANIZATION_ID` constant ("Biofuel") at `import.service.ts:6`.
7. The returned object falls through `CustomResponseInterceptor` (`helpers/custom-sucess.filter.ts:11-29`) which wraps it as `{ success: true, data, message: "Action Succeeded" }`.
8. Errors fall through `CustomExceptionFilter` (`helpers/custom-exception.filter.ts:4-24`) which renders `{ success: false, message, data: {} }` with status `exception.status || 400`.

### Prisma models (full list, relations summarized) — `prisma/schema.prisma`
- **Organization** (`schema.prisma:10-45`) — root tenant. Has many of almost everything. Holds `taxRate`, `bankDetails`, `customDocumentTypes`, `defaultStamp`, `stockDeductionTrigger` (legacy).
- **Asset** (`47-78`) — `name`, `skuKey`, `categoryId`, `parentAssetId`, `uom`, `isTracked`, `quantity` (only for untracked), `minQuantity`, `price`, `deletedAt` (soft delete). Unique `(skuKey, organizationId, deletedAt)`. Relations: `Category`, `Organization`, self (parent/sub), `AssetTemplateTag`, `Inventory[]`, `PriceHistory[]`, `QuantityAdjustment[]`.
- **Category** (`80-86`) — per-org asset category.
- **Inventory** (`88-103`) — physical instance of an Asset. `assetId`, `sku` (serial), `category` (string snapshot), `status` (`InventoryStatus` enum), `location`, `quantity`. Relations: `Asset`, `Organization`, `Assignment[]`, `TimelineItem[]`.
- **Customer** (`105-129`) — `customerCode`, `name`, `email`, `phone`, `address`, `gstRegNo`, `salesmanId` (-> `UserOrganization`). Has many `SiteOffice`, `PriceHistory`, `Payment`, `Transaction`, one `CustomerBalance`. Composite unique `(id, organizationId)` (used for FK from `CustomerBalance`).
- **Supplier** (`131-147`) — mirror of Customer minus salesman/site offices.
- **DocumentTemplate** (`149-173`) — `type` ("INVOICE", "QUOTATION", "DELIVERY_ORDER", etc.), `templateVariant` ("TI", "QO1", "Default"), `config`, `layoutConfig`, `styleConfig`, `mockData`, `isActive`, `isDefault`. Tagged via `AssetTemplateTag`.
- **AssetTemplateTag** (`175-184`) — many-to-many between Asset and DocumentTemplate.
- **TimelineItem** (`186-196`) — `message`, `pdfUrl`, optional `inventoryId` or `documentId`.
- **Document** (`198-233`) — `type`, `documentTemplateId`, `name` (doc number), `status` (`DocumentStatus` enum), `config` JSON (the entire form payload), `projectId`, `baseDocumentId` + `revisionNumber` (revisions). Unique `(name, organizationId, documentTemplateId)`. Relations: `Organization`, `Project`, `TimelineItem[]`, `PriceHistory[]`, `Payment[]`, `Transaction[]`, `DocumentItem[]`, self-relation for revisions.
- **DocumentItem** (`236-258`) — junction table. `documentId`, `itemId` (asset OR inventory), `itemType` (`ItemType` enum: INVENTORY/ASSET), `sku`, `description`, `quantity`, `unitPrice`, `discount`, `amount`, `uom`, `lineNumber`. `onDelete: Cascade` from Document. Unique `(documentId, itemId, lineNumber)`.
- **Role** (`265-278`) — per-org. `allowedModules: String[]`. Many permissions (m2m).
- **Permission** (`280-289`) — global. `name`, `resource`, `action`.
- **UserRole** (`291-305`) — links Clerk userId to Role within an organization. `expiresAt`, `isActive`, `assignedAt`, `assignedBy`.
- **UserOrganization** (`307-323`) — Clerk userId → Organization membership. `salesmanCode`, `isActive`, `joinedAt`, `lastActiveAt`, `settings`. Has many Customers (as salesman).
- **Project** (`325-340`) — `name`, `description`, `startDate`, `endDate`, `status` (`ProjectStatus`: pending/ongoing/completed), `siteOfficeId`. **No `customerId` column.** Relations: `Assignment[]`, `Document[]`, `Organization`, `SiteOffice`.
- **Assignment** (`342-353`) — `projectId`, `inventoryId` (nullable), `startDate`, `endDate`. Unique `(projectId, inventoryId)`.
- **SiteOffice** (`355-365`) — belongs to a Customer (REQUIRED `customerId`). Has `address`, many `ContactDetail`, many `Project` (relation name `"SiteOfficeProjects"`).
- **ContactDetail** (`367-376`) — name/email/phone for a SiteOffice.
- **AuditLog** (`378-406`) — global audit log table; many indexes.
- **XeroConnection** (`440-451`) — one per organization. `tenantId`, `accessToken`, `refreshToken`, expiry timestamps. `onDelete: Cascade`.
- **OrganizationModule** (`453-469`) — per-org module enable flags + custom labels/icons/sort.
- **CustomField** (`471-495`) — per-org per entityType (Asset/Customer/Document/Inventory/Project). Type, options, validation, sort order, visibility flags.
- **CustomFieldValue** (`497-510`) — actual stored values. Cascade-deletes with CustomField.
- **OrganizationUIConfig** (`512-529`) — per-org theme, navigation, dashboard layout, terminology, dateFormat, currency, language, features, branding.
- **PriceHistory** (`531-559`) — `assetId`, `unitPrice`, `quantity`, `totalAmount`, `documentId`, `documentNumber`, `documentDate`, optional `customerId`, `organizationId`.
- **Payment** (`561-588`) — `customerId`, `documentId`, `amount`, `paymentDate`, `paymentMethod`, `reference`, `createdBy`. Has many Transaction.
- **Transaction** (`591-618`) — unified ledger row. `transactionType` (`TransactionType`: INVOICE/PAYMENT/CREDIT_NOTE/DEBIT_NOTE/ADJUSTMENT/OPENING_BALANCE), `debit`, `credit`, `balance`, `documentId?`, `paymentId?`.
- **CustomerBalance** (`621-637`) — `openingBalance`, `currentBalance`, `lastTransactionDate`. Composite FK `(customerId, organizationId)` to Customer.
- **QuantityAdjustment** (`649-669`) — for untracked products. `previousQty`, `newQty`, `adjustmentType` (`AdjustmentType`: ADD/SUBTRACT/SET), `adjustedBy`, `adjustedAt`, `reason`.
- **ImportInvoice** (`678-712`) — staging table for Xero historical import. `invoiceNumber`, `date: String?`, `customer`, `customerMatched`, `status`, `source`, `gross`, `balance`, AI-extracted fields (`projectName`, `projectLocation`, `siteOfficeName`, `siteOfficeAddress`, `doDate`, `doNumber`, `contactName`, `contactPhone`), `lineItems: Json`, `reviewStatus` (default "pending"), `skipReason`, `confirmedAt`. Unique `(invoiceNumber, organizationId)`.

Enums: `ItemType`, `ProjectStatus`, `InventoryStatus`, `DocumentStatus` (draft / confirmed / pending_delivery / delivered_not_installed / delivered_installed / pending_payment / paid / pending_return / returned), `AuditStatus`, `TransactionType`, `AdjustmentType`.

### Auth + organization-scoping pattern
- `ClerkAuthGuard` is global via `APP_GUARD` in `src/app.module.ts:74-77`. Every request runs through it unless the handler/class is decorated with `@Public()` (`src/decorators/public.decorator.ts`).
- The guard attaches `request.userOrganization` (the org object) and `request.isOsirisAdmin` (boolean).
- Two retrieval mechanisms appear in controllers:
  - `@UserOrganization() userOrganization: any` param decorator (`src/auth/decorators/user-organization.decorator.ts`) — used in `assets.controller.ts`.
  - `@Req() req: RequestWithOrganization` then `req.userOrganization?.id` — used in `customers.controller.ts`, `projects.controller.ts`, `documents.controller.ts`, etc. Most controllers throw `new Error('User is not assigned to any organization')` on missing org (which becomes a 400 via `CustomExceptionFilter`).
- Permissions are checked inside the guard against `@Permissions(...)` metadata. Format `resource:action` (e.g. `assets:read`). Wildcard `*` for either. OsirisAdmin role bypasses everything.

### Background jobs / queues
None observed. No BullMQ, no Bull, no @nestjs/schedule, no cron, no queue dependency in `package.json`. All write paths are synchronous within a request.

### External integrations
- **Clerk** — `@clerk/backend`, `@clerk/clerk-sdk-node`. Token verification + user lookup; secret key set once on module init.
- **Xero** — `xero-node`. OAuth flow handled by `src/common/xero.controller.ts` + `xero.service.ts`. Tokens stored in `XeroConnection` model. Used to push invoices and pull contacts. Historical import flow uses pre-extracted JSON, not the live Xero API.
- **AWS S3** — `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`. `S3Service` in `src/common/services/s3.service.ts` for upload/download/presign. Region via `AWS_REGION`, bucket via `RESOURCE_BUCKET`.
- **OpenAI** — `openai ^6.2.0`. Used in `src/document-extraction/` for extracting fields from uploaded PDFs/images.
- **Resend** — `resend ^6.4.2`. `EmailService` in `src/email/email.service.ts` (used by `DocumentsController` to send invoice emails).
- **Puppeteer** — `puppeteer ^24.24.0`. `PdfGeneratorService` in `src/common/services/pdf-generator.service.ts` for HTML → PDF document rendering.

### Error handling
- `helpers/custom-exception.filter.ts:4-24` — global filter. Returns `{ success: false, message, data: {} }` with `exception.status || 400`. **Does not preserve Nest exception statuses correctly for non-`HttpException` errors** — a thrown `Error` becomes 400 with the raw message, not 500.
- Per-controller pattern is to wrap service calls in try/catch and rethrow as `HttpException(message, status)` (e.g. `ImportController` re-throws everything as `HttpException(message, 500)` per `import.controller.ts:14-16` etc.).

### Logging
- `morgan('dev')` for request lines (`main.ts:52`).
- Verbose `console.log` inside `ClerkAuthGuard` (auth timing, "User is osiris-admin", permission resource/action). No structured logger; no Winston/Pino.

### Testing setup
- Jest config inline in `package.json` (`api-server-production/package.json:120-136`): `rootDir: src`, `testRegex: .*\\.spec\\.ts$`, ts-jest transformer. There are **no `*.spec.ts` files** committed under `src/` for the import flow (or anywhere else that I located). The only test file is `test/app.e2e-spec.ts` plus the e2e Jest config `test/jest-e2e.json`.

## 5. Common Commands

Run from inside the named folder. The root `package.json` has no scripts (root only carries `xero-node` for some scripts that import it).

### `api-server-production/`
| Purpose | Command |
|---|---|
| Install | `npm install` |
| Dev (watch) | `npm run start:dev` |
| Dev against staging DB | `npm run start:staging` (uses `dotenv -e .env.staging`) |
| Debug watch | `npm run start:debug` |
| Build | `npm run build` |
| Start prod | `npm run start:prod` (`node dist/src/main`) |
| Format | `npm run format` (Prettier on `src/**/*.ts test/**/*.ts`) |
| Lint+fix | `npm run lint` (ESLint) |
| Unit tests | `npm run test` |
| Test watch | `npm run test:watch` |
| Coverage | `npm run test:cov` |
| Test debug | `npm run test:debug` |
| E2E tests | `npm run test:e2e` |
| Prisma push (local) | `npm run db:push` |
| Prisma push (staging) | `npm run db:push:staging` |
| Prisma push (prod) | `npm run db:push:prod` |
| Prisma sync alias | `npm run db:sync` (same as `db:push`) |
| Refresh staging branch | `npm run db:refresh-staging` (Neon API; needs `NEON_API_KEY`/`NEON_PROJECT_ID`) |
| Prisma Studio | `npm run db:studio` (`:staging`, `:prod` variants exist) |
| Seed | `npm run seed` (runs `ts-node prisma/seed.ts`) |
| Assign super admin | `npm run assign-superadmin` |
| Assign Osiris admin | `npm run assign-osirisadmin` |
| Debug user roles | `npm run debug-user-roles` |
| Setup database | `npm run setup-database` |
| Setup user | `npm run setup-user` |
| Migrate Sales nav | `npm run migrate-sales-nav` (also `:dry`) |
| Migrate Inventory nav | `npm run migrate-inventory-nav` (also `:dry`) |
| Add SO templates | `npm run add-so-templates` (`:dry`) |
| Add PO templates | `npm run add-po-templates` (`:dry`) |
| Add PR templates | `npm run add-pr-templates` (`:dry`) |
| Add SAI templates | `npm run add-sai-templates` (`:dry`) |
| Add SAO templates | `npm run add-sao-templates` (`:dry`) |
| Migrate document items | `npm run migrate-document-items` (`:dry`) |
| Populate template fields | `npm run populate-template-fields` |
| Biofuel split contact | `npm run biofuel-split-contact` |

Prisma `generate` is invoked by Prisma's own postinstall — there is no explicit script for it; running `npm install` triggers it.

### `portal-production/`
| Purpose | Command |
|---|---|
| Install | `npm install` |
| Dev | `npm run dev` (Next dev with Turbo) |
| Build | `npm run build` |
| Start prod | `npm run start` |
| Lint | `npm run lint` |

### Single test
There is no `--testPathPattern` script wired in. Use Jest directly from `api-server-production/`:
```
npx jest src/path/to/file.spec.ts
# or by name pattern
npx jest -t "name fragment"
```

## 6. Environment Variables

Only variables actually referenced in code are listed. Source columns reference current files.

### api-server-production
| Var | Required? | Purpose | Used at | Example |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string for Prisma | `prisma/schema.prisma:7` | `postgresql://user:password@localhost:5432/aims` |
| `PORT` | No (default 4040) | HTTP port | `src/main.ts:61`, `config/configuration.ts:2` | `4040` |
| `NODE_ENV` | No | toggles dev-only audit logging | `src/common/audit.service.ts:52` | `development` |
| `DATABASE_HOST` | No | exported through `configuration.ts` (currently unused inside code) | `config/configuration.ts:4` | (unused) |
| `AWS_REGION` | Yes for S3 | S3 region | `config/configuration.ts:7`, `test-aws.js:7,15` | `ap-southeast-1` |
| `RESOURCE_BUCKET` | Yes for S3 | S3 bucket | `config/configuration.ts:8`, `test-aws.js:16,25` | `aims-osiris` |
| `AWS_ACCESS_KEY_ID` | Yes for S3 | AWS credential | `config/configuration.ts:9`, `test-aws.js` | — |
| `AWS_SECRET_ACCESS_KEY` | Yes for S3 | AWS credential | `config/configuration.ts:10`, `test-aws.js` | — |
| `DASHBOARD_URL` | No | exported through configuration; used as a config reference | `config/configuration.ts:12` | — |
| `CLERK_PUBLISHABLE_KEY` | Yes | Clerk frontend key (mirrored) | `config/configuration.ts:13` | — |
| `CLERK_SECRET_KEY` | Yes | Clerk backend secret; verifies tokens | `config/configuration.ts:14`, `src/auth/clerk.strategy.ts:28`, `src/auth/auth.module.ts:18-20`, `src/customers/customers.service.ts:13` | — |
| `APP_URL` | No (default `http://localhost:3000`) | Used in Xero OAuth redirect chain | `config/configuration.ts:15`, `src/common/xero.controller.ts:52,63,70,73` | `https://aims.osiris.so` |
| `XERO_CLIENT_ID` | Yes for Xero | OAuth client | `config/configuration.ts:17` | — |
| `XERO_CLIENT_SECRET` | Yes for Xero | OAuth secret | `config/configuration.ts:18` | — |
| `XERO_REDIRECT_URI` | Yes for Xero | Callback URL registered with Xero | `config/configuration.ts:19` | `http://localhost:4040/xero/callback` |
| `XERO_SCOPES` | No | Default in code | `config/configuration.ts:20` | `accounting.transactions accounting.contacts accounting.settings offline_access` |
| `NEON_API_KEY` | Only for staging refresh | For Neon CLI in `refresh-staging-db.mjs` | `scripts/refresh-staging-db.mjs:19` | — |
| `NEON_PROJECT_ID` | Only for staging refresh | Neon project to branch | `scripts/refresh-staging-db.mjs:20` | — |

`.env.example` also lists `CLERK_WEBHOOK_SECRET`, `AWS_S3_BUCKET`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — these are documented as required for full functionality, but I did not see them referenced via `process.env.*` in the TS sources I scanned (they may be read from `ConfigService` inside services I did not open, e.g. `email.service.ts`, `document-extraction.service.ts`).

### portal-production
| Var | Required? | Purpose | Used at | Example |
|---|---|---|---|---|
| `NEXT_PUBLIC_BACKEND_API_URL` | Yes | Base URL for backend; concatenated by `request.ts` | `helpers/request.ts:65` and many fetch sites | `http://localhost:4040` |
| `NEXT_PUBLIC_RESOURCE_URL` | Yes | S3 base URL for asset/inventory images | many components, e.g. `containers/ViewAsset/index.tsx:41`, `app/portal/inventory/[sku]/page.tsx:246` | `https://aims-osiris.s3.ap-southeast-1.amazonaws.com/` |
| `NEXT_PUBLIC_API_URL` | No (only some pages) | Alternate backend URL referenced by document-extraction page and statement-of-account page | `app/portal/document-extraction/page.tsx:148`, `app/portal/reports/statement-of-account/page.tsx:133` | `http://localhost:4040` |
| `CLERK_SECRET_KEY` | Yes | Clerk server key; explicitly passed through `next.config.mjs:7` so server components can read it | `next.config.mjs:7` | — |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk frontend key | read by `@clerk/nextjs` automatically | — |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | No | Clerk sign-in URL | docs only; consumed by Clerk SDK |  |

## 7. Code Conventions

Sampled from `assets`, `customers`, `documents`, and `import` modules.

### DTO and validation
- `class-validator` decorators on DTO classes, validated by the global `ValidationPipe` (`main.ts:53`). Examples: `@IsString @IsNotEmpty`, `@IsUUID`, `@IsBoolean`, `@IsInt @Min(0)`, `@ValidateIf`, `@IsIn(UOM_OPTIONS)` (see `src/assets/dto/create-asset.dto.ts`). Nested DTOs use `@ValidateNested({ each: true })` + `@Type(() => Foo)` (`src/projects/dto/create-project.dto.ts:46-49`).
- Custom union shapes with no DTO are common in newer code (e.g. `import.controller.ts:88-89` and `:175-178` use plain inline TypeScript types) — these get NO runtime validation, so the global `ValidationPipe` does nothing for them.

### Controller shape
- `@Controller('resource')` + `@UseGuards(ClerkAuthGuard)` at class level. Permissions per method via `@Permissions('resource:action')`.
- Most controllers manually pull `req.userOrganization?.id` and throw on missing, using `interface RequestWithOrganization extends Request {...}` declared at the top of the file (`customers.controller.ts:14-19`, `projects.controller.ts:10-15`, `documents.controller.ts:14-20`). `assets.controller.ts` instead uses the `@UserOrganization()` param decorator — both styles coexist.
- Catch blocks wrap service errors as `HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR)` in newer modules (`import`, `projects/createProject`).

### Service layer
- Services depend on `PrismaService` (constructor-injected). Direct Prisma calls; no repository pattern.
- Soft delete via `deletedAt` on `Asset` only (filter `where: { deletedAt: null }`). Other models hard-delete.

### Response shape
Global response wrapping by `CustomResponseInterceptor`:
```
{ "success": true, "data": <handler return value>, "message": "Action Succeeded" }
```
Errors via `CustomExceptionFilter`:
```
{ "success": false, "message": <error.message>, "data": {} }   // status from exception.status || 400
```

### Naming
- Controllers/services/modules: `feature.controller.ts`, `feature.service.ts`, `feature.module.ts`. DTOs in `dto/` (kebab-case file names like `create-asset.dto.ts`).
- camelCase for code, PascalCase for classes/types, `skuKey` is the canonical asset code, `customerCode`, `salesmanCode`, `supplierCode` are auto-generated short codes.
- One outlier folder spelling: `documentTemplates/` (camelCase folder, in contrast to other features).

### Where new endpoints typically go
1. Add DTO under `src/<feature>/dto/`.
2. Add method to `<feature>.controller.ts` with `@Permissions(...)` and DTO body.
3. Add corresponding method to `<feature>.service.ts`.
4. Add a permission row (if new) and assign to roles via the relevant ts-node script under `api-server-production/scripts/`.
5. On the portal side, expose a corresponding hook (`app/portal/<feature>/hooks/use*.tsx`) or saga, calling `request({ path, method }, body, token)` from `helpers/request.ts`.

## 8. Key Business Workflows

### 8.1 ImportInvoice → Project + Document + Inventory + Assignment (the Confirm-button sequence)
Triggered by clicking "Confirm Invoice" in `portal-production/app/portal/settings/import-invoices/components/ImportInvoices.tsx:1002`. Handler: `handleConfirm` at `ImportInvoices.tsx:269-367`.

Steps as ordered in `handleConfirm`:
1. **createSiteOffice (if `formState.isNewSiteOffice`)** — `ImportInvoices.tsx:275-285` calls `createSiteOffice` (hook in `useImportData.ts`) → `POST /import/create-site-office` → `ImportService.createSiteOffice` (`import.service.ts:342-346`). Writes `name`, `address`, `customerId`. **No `organizationId` written** (SiteOffice doesn't have one — it's reachable via `customer.organizationId`).
2. **createProject (if `!formState.projectId && formState.projectLocation && formState.customerId`)** — `ImportInvoices.tsx:288-301` calls `createProject` → `POST /import/create-project` → `ImportService.createProject` (`import.service.ts:348-365`). Writes `name`, `organizationId` (hardcoded Biofuel from `import.service.ts:6`), optional `siteOfficeId`, optional `startDate`/`endDate`, hardcoded `status: 'ongoing'`. **`customerId` is silently dropped** (Project schema has no `customerId`).
3. **Auto-create assets** — `ImportInvoices.tsx:303-325`. For each line item that is not a service AND has no `selectedAssetId` AND has both `selectedAssetName` and `selectedSku`, calls `createAsset` → `POST /import/create-asset` → `ImportService.createAsset` (`import.service.ts:256-300`). If `categoryId` missing but `categoryName` present, finds-or-creates a Category. Hardcodes org. Returns the new asset and the line item is patched in-place.
4. **importSingleInvoice** — `ImportInvoices.tsx:328-342` calls `importSingleInvoice` → `POST /import/import-single` → `ImportService.importSingleInvoice` (`import.service.ts:369-553`). Subflow:
   - Idempotency check: `prisma.document.findFirst({ where: { organizationId, name: invoiceNumber } })` (`:385-390`). If exists, returns `{ success: false, message: 'Invoice already exists', documentId }` (HTTP 200 still — the controller doesn't translate this). Frontend handles this softly at `ImportInvoices.tsx:344-348`.
   - Find Customer by case-insensitive name match within org (`:393-398`). Throws if not found.
   - Find a DocumentTemplate where `type IN ('INVOICE','TI')` for the org (`:401-406`). Throws if none.
   - Build `configItems[]` from each line: derives `amount = qty * unitPrice`, `gross = li.gross || amount`, `taxAmount = li.tax || gross - amount`, `taxRatePercent = round((taxAmount/amount)*100, 2)`. Stores per-item `tax` as a string percentage (`:419,430`).
   - Build the document `config` JSON: `customerId`, `customer`, `date: new Date(body.date).toISOString()`, `items`, `projectId`, `projectLocation`, `siteOfficeId`, `documentInfo: { gstPercent, currency: 'SGD' }`, plus Xero metadata (`:443-460`). `gstPercent` is read from the first item with tax > 0, defaulting to 9.
   - `prisma.document.create` with `name = invoiceNumber`, `type = template.type`, `documentTemplateId = template.id`, `organizationId` (hardcoded), `status` mapped via `STATUS_MAP` (`:8-12`: Paid/Approved → 'confirmed', Draft → 'draft', anything else → 'draft'), `config` (JSON), `projectId`.
   - For each item with `inventoryItemId`: create a `DocumentItem` with `itemType: 'ASSET'`, `lineNumber: i+1` (`:483-497`).
   - For each serial in `item.serialNumbers`: find existing Inventory by `(sku, organizationId)`; if absent, look up the asset (with category) and create Inventory with `assetId`, `sku = serial`, `category = asset.category.name || 'General'`, `status: 'rental'`, `organizationId`, `location = body.projectLocation` (`:500-530`).
   - For each created/found inventory id: if `body.projectId`, create an `Assignment` (idempotent on `(projectId, inventoryId)`) with start/end dates if provided (`:534-550`).
   - Returns `{ success: true, documentId, invoiceNumber }`.
5. **confirmInvoice** — `ImportInvoices.tsx:351-355` calls `confirmInvoice` → `POST /import/confirm` → `ImportService.confirmInvoice` (`import.service.ts:188-204`). Updates `ImportInvoice.reviewStatus = 'confirmed'`, persists the edited `lineItems`, persists `projectLocation`, sets `confirmedAt = now()`.

The 5 steps are NOT wrapped in `prisma.$transaction`. A failure midway leaves a partial state (e.g. project + asset created, document not).

### 8.2 Asset → Inventory → QR
- Asset is created via `POST /assets/create` (`assets.controller.ts:60`, DTO `create-asset.dto.ts`). When `isTracked = true`, individual Inventory rows are created later (per-serial); when `false`, the Asset itself carries `quantity` and gets adjusted via `QuantityAdjustment`.
- Inventory rows are created either through the standard inventories controller, or via the import flow above. Each Inventory has its own `sku` (the serial number) plus a snapshot of `category` and a `status` (`InventoryStatus`).
- QR codes are generated using the `qrcode` library; the actual generation hook lives in `inventories.service.ts` (not opened in detail this pass — see Open Questions §12).

### 8.3 Document generation (PDF + email)
- Document creation via `POST /documents/with-timeline` or `POST /documents/basic` in `documents.controller.ts`. Body persists to `Document.config` JSON plus rows in `DocumentItem` (junction).
- PDF rendering via `PdfGeneratorService` (`src/common/services/pdf-generator.service.ts`) using Puppeteer. Output uploaded to S3 by `S3Service`.
- Email via `EmailService` wrapping Resend (`src/email/email.service.ts`), invoked from `DocumentsController`.
- Templates use a per-org `DocumentTemplate` with `type`, `templateVariant`, `config`, `layoutConfig`, `styleConfig`. Frontend renders templates in `containers/DocumentTemplates/components/` (e.g. `DeliveryOrderTemplate.tsx`, `MaintenanceServiceReportTemplate.tsx`).

### 8.4 Organization-scoping resolution per request
1. Request hits `ClerkAuthGuard.canActivate` (`clerk-auth.guard.ts:17`).
2. Guard calls Passport's `ClerkStrategy.validate` (`clerk.strategy.ts:19-39`) → verifies token via `verifyToken` and loads user via `clerkClient.users.getUser(sub)` → returned user attached to `req.user`.
3. Guard then runs two parallel queries (`clerk-auth.guard.ts:41-89`): `userRole.findMany({ userId, isActive: true })` with role+permissions selected; `userOrganization.findFirst({ userId, isActive: true })` returning the organization minimum fields.
4. Sets `request.userOrganization` (the org object) and `request.isOsirisAdmin`. Throws `ForbiddenException` if the user has no org (and is not OsirisAdmin).
5. Controllers either use `@UserOrganization()` param decorator or read `req.userOrganization?.id` directly.

### 8.5 Permission resolution from JWT
- `@Permissions('resource:action')` sets metadata under key `PERMISSIONS_KEY` (`src/auth/decorators/permissions.decorator.ts`).
- Inside `ClerkAuthGuard.canActivate` (`clerk-auth.guard.ts:117-170`):
  - If no permissions metadata → just authenticated suffices.
  - OsirisAdmin (`role.name === 'osirisadmin'`) bypasses all permission checks.
  - For everyone else: filter `userRoles` to those matching the current `userOrganization.id` (`:140-142`). For each role, check `requiredPermissions.every(req => role.permissions.some(p => (p.resource === req.resource || p.resource === '*') && (p.action === req.action || p.action === '*')))`. First role with all required permissions allows; otherwise `ForbiddenException('User does not have sufficient permissions')`.

## 9. Workflow Tips for Claude Code

### Adding a new endpoint (backend)
1. Define DTO under `src/<feature>/dto/<verb>-<noun>.dto.ts` using `class-validator`.
2. Add the method to `src/<feature>/<feature>.controller.ts`. Apply `@Permissions('<feature>:<verb>')`. Pull org via `@UserOrganization()` (preferred) or `@Req() req: RequestWithOrganization`.
3. Implement in `src/<feature>/<feature>.service.ts`, taking `organizationId: string` as the second arg and scoping every Prisma call by it.
4. If a new permission is needed, add a row to the global `Permission` table (script under `scripts/add-*.ts` is the prevailing pattern).
5. Test via `npm run test` (Jest). For frontend integration, use the request helper.

### Adding a new model + migration
1. Edit `prisma/schema.prisma`. Use `@db.Uuid` and `@default(uuid())` for new id columns to match neighbour models.
2. Add the relation field on `Organization` if scoped per-tenant.
3. Apply: `npm run db:push` against local. For staging/prod use `npm run db:push:staging` / `npm run db:push:prod`. **Note:** this repo currently uses `db push` rather than `migrate dev` even though there is a `prisma/migrations/` folder — see §10.
4. Update DTOs and services. Regenerate `@prisma/client` by running `npm install` (postinstall) or `npx prisma generate`.

### Adding a new background job
There is no job runner currently. If one is genuinely needed:
- Add `@nestjs/schedule` or `bullmq` as a dep, register it in `AppModule`.
- Otherwise, document any one-off batch as a `scripts/<name>.ts` and add a corresponding `npm run <name>` entry.

### Running a single test
```
cd api-server-production
npx jest src/<feature>/<file>.spec.ts
# or
npx jest -t "describe or it name fragment"
# e2e
npm run test:e2e
```

## 10. Gotchas

- **`db:push` instead of migrations.** All `db:*` scripts use `prisma db push` rather than `prisma migrate dev`/`deploy`. The `prisma/migrations/` folder is present but no script applies it; schema changes are pushed directly. CLAUDE.md says the same — do not run `prisma migrate dev` without checking with the user.
- **Hardcoded ORGANIZATION_ID in import flow.** `src/import/import.service.ts:6` pins every read/write to Biofuel (`'52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'`). The frontend mirrors this with a hard guard `if (organization.name !== "Biofuel Industries Pte Ltd") return <Alert>This page is only available for Biofuel Industries.</Alert>` (`ImportInvoices.tsx:206-212`).
- **`Project` has no `customerId` column.** Customer linkage is indirect: `Project.siteOfficeId` → `SiteOffice.customerId`. A `customerId` argument passed to `ImportService.createProject` is silently dropped (`import.service.ts:348-365`). Code that "looks up the customer for a project" must do `project.siteOffice.customer`.
- **Project matching by substring.** `buildFormState` in `ImportInvoices.tsx:102-104` matches `projects.find(p => p.name.toLowerCase().includes(invoice.project_location.toLowerCase()))`. New invoices for "Site A" will silently attach to "Site A — Phase 2".
- **Variable naming mismatch.** `ImportInvoices.tsx:113` sets `formState.projectLocation = inv.project_name || invoice.project_location`. This value is used as `Project.name` server-side in `createProject`.
- **Soft delete only on Asset.** `Asset.deletedAt` exists; everything else is hard-deleted.
- **Multi-tenant scoping risk.** Most controllers correctly scope by `organizationId` from `req.userOrganization`. The `import` module bypasses this entirely — anyone authenticated and able to reach `/import/*` writes Biofuel rows regardless of their own org. The page-level guard in the portal is the only protection.
- **Idempotency mismatch in confirm sequence.** `importSingleInvoice` checks for an existing Document by `(organizationId, name)` before creating. `createProject` does NOT — re-clicking Confirm after a partial failure creates a duplicate Project. Inventory and Assignment writes ARE idempotent (`findFirst` on `(sku, organizationId)`, `findUnique` on `(projectId, inventoryId)`).
- **Invoice/DO date strings.** `ImportInvoice.date` and `ImportInvoice.doDate` are `String?` (not `DateTime`). They are parsed by `new Date(body.date).toISOString()` (`import.service.ts:446`) without validation. Bad inputs become `Invalid Date`.
- **Project fields never populated on import.** `import.service.ts:355-364` writes `name`, `organizationId`, `siteOfficeId`, `startDate`, `endDate`, `status: 'ongoing'`. `description`, and (intentionally) `customerId` are never set; `endDate` only fires if the user filled the optional UI field.
- **`CLERK_SECRET_KEY` is mutated at module init.** `src/auth/auth.module.ts:18-20` writes `process.env.CLERK_SECRET_KEY = secretKey` so the singleton `clerkClient` from `@clerk/clerk-sdk-node` uses it. If you ever import `clerkClient` before `AuthModule` initializes, you'll hit an unauthenticated client.
- **Mixed parameter style for org context.** Some controllers use `@UserOrganization() userOrganization: any`, others use `@Req() req: RequestWithOrganization`. Both work; pick whichever matches the surrounding file.
- **No tests for the import flow** (and effectively none anywhere in `src/`).
- **Some env vars in `.env.example` aren't grepped from code.** `CLERK_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `AWS_S3_BUCKET` aren't accessed via raw `process.env` in TS sources but are likely read via `ConfigService` inside services I didn't open.
- **Deprecated path still in use:** the portal redirects `/portal/invoices` → `/portal/sales/invoices` and `/portal/documents` → `/portal/sales/quotations` (`next.config.mjs:11-23`). Existing URLs still hit the new pages; new code should use the `/sales/...` paths.

## 11. Carry-forward: ImportInvoice → Project diagnosis (from previous session)

> The "translation" triggered by the Confirm button in `portal-production/app/portal/settings/import-invoices/components/ImportInvoices.tsx` (handleConfirm, ~line 269) is a 5-step approval sequence:
>
> 1. createSiteOffice (if new)
> 2. createProject — POST `/import/create-project` → `ImportService.createProject` (api-server-production/src/import/import.service.ts ~lines 348–365)
> 3. createAssets
> 4. importSingleInvoice — POST `/import/import-single` → `ImportService.importSingleInvoice` (~lines 369–553) — creates Document, DocumentItem, Inventory, Assignment from `ImportInvoice.lineItems`
> 5. confirmInvoice — flips `ImportInvoice.reviewStatus` to "confirmed"
>
> **Suspicious findings already identified in createProject path:**
>
> - `ImportInvoices.tsx ~line 113`: `formState.projectLocation = inv.project_name || invoice.project_location` — this value becomes `Project.name` server-side. Variable name doesn't match its content.
> - `import.service.ts ~line 6`: hardcoded `ORGANIZATION_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'` (Biofuel). Used for every write, ignores the caller's tenant.
> - `ImportInvoices.tsx ~lines 102–104`: existing-project matcher uses `name.toLowerCase().includes(...)` — substring match attaches new invoices to the wrong existing project (e.g. "Site A" → "Site A — Phase 2").
>
> **Other context from previous analysis:**
>
> - `Project` has no `customerId` column. Customer linkage flows indirectly: `Project.siteOfficeId` → `SiteOffice.customerId`. The `customerId` passed to `createProject` is silently dropped server-side.
> - `ImportInvoice.date` and `ImportInvoice.doDate` are `String?`, parsed by `new Date(...)` with no validation.
> - The 5-step approval is NOT wrapped in a Prisma transaction. `createProject` has no idempotency guard. Other writes (Document, Inventory, Assignment) do.
> - `Project.endDate` is never populated. `Project.description` is never set. `Project.status` is hardcoded to 'ongoing'.
> - No tests exist for any import flow.
>
> **Pending — not yet analyzed:**
>
> Step 4 (`importSingleInvoice`, lines 369–553) was never given the same depth analysis. Field-mapping tables for ImportInvoice → Document, lineItems[] → DocumentItem / Inventory / Assignment are still TODO. The user reports "errors in translation of data throughout tables" plural, suggesting bugs likely also live in this step.

### Verification (against current code on this machine)

| Carry-forward claim | Status | Evidence |
|---|---|---|
| `ImportInvoices.tsx` `handleConfirm` ~line 269 | Confirmed | `ImportInvoices.tsx:269` declares `const handleConfirm = async () => {`. |
| Step ordering: createSiteOffice → createProject → createAssets → importSingleInvoice → confirmInvoice | Confirmed | `ImportInvoices.tsx:273-356` matches. Site office at 275-285, project at 288-301, asset auto-create loop at 303-325, importSingleInvoice at 328-342, confirmInvoice at 351-355. |
| `import.service.ts` `createProject` ~lines 348-365 | Confirmed | `import.service.ts:348` `async createProject(body: ...)`; method body ends `:365`. |
| `import.service.ts` `importSingleInvoice` ~lines 369-553 | Confirmed | `import.service.ts:369` `async importSingleInvoice(body: ...)`; closing brace at `:553`. |
| `import.service.ts:6`: `const ORGANIZATION_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel` | Confirmed | Exact line match. |
| `ImportInvoices.tsx:113`: `projectLocation: inv.project_name \|\| invoice.project_location` | Confirmed | `ImportInvoices.tsx:113` `projectLocation: inv.project_name || invoice.project_location || "",`. (Trailing `|| ""` was not in the carry-forward note but doesn't change the substance.) |
| `ImportInvoices.tsx:102-104`: substring-match on project name | Confirmed | `:102-104` `const matchedProject = invoice.project_location ? projects.find((p) => p.name.toLowerCase().includes(invoice.project_location!.toLowerCase())) : undefined;`. |
| `Project` has no `customerId` column | Confirmed | `prisma/schema.prisma:325-340` declares `Project` with `siteOfficeId` only; no `customerId` field. |
| `customerId` passed to `createProject` is silently dropped | Confirmed | `import.service.ts:348-365` accepts `customerId` in the body type but never uses it inside `prisma.project.create({...})`. |
| `Project.siteOfficeId → SiteOffice.customerId` is the customer link | Confirmed | `prisma/schema.prisma:355-365`: `SiteOffice.customerId String @db.Uuid`, `customer Customer @relation(...)`. |
| `ImportInvoice.date` and `ImportInvoice.doDate` are `String?` | Confirmed | `prisma/schema.prisma:682` `date String?`, `:694` `doDate String?`. |
| `new Date(...)` parsing without validation | Confirmed | `import.service.ts:446` `date: new Date(body.date).toISOString()`. No try/guard. Same applies to `:360` `new Date(body.startDate)` and `:361` `new Date(body.endDate)` in createProject (only after `!== ''` check). |
| 5-step approval is NOT wrapped in a Prisma transaction | Confirmed | No `prisma.$transaction(...)` call appears anywhere in `import.service.ts` or in `handleConfirm`. Each call is a separate HTTP request from the portal. |
| `createProject` has no idempotency guard | Confirmed | `import.service.ts:348-365` always calls `prisma.project.create`; no `findFirst` or upsert. |
| Document write IS idempotent | Confirmed | `import.service.ts:385-390` checks for existing Document by `(organizationId, name=invoiceNumber)` and returns early on duplicate. |
| Inventory write IS idempotent (per serial) | Confirmed | `import.service.ts:504-510` `findFirst({ sku: serial, organizationId })`; reuses existing or creates. |
| Assignment write IS idempotent | Confirmed | `import.service.ts:536-548` `findUnique({ projectId_inventoryId: ... })`; only creates when absent. |
| `Project.endDate` never populated | Partially correct | `import.service.ts:361` writes `endDate` if `body.endDate && body.endDate !== ''`. The frontend (`ImportInvoices.tsx:341`) does pass `formState.endDate || undefined`, and the Edit-form (`:691-702`) lets users fill it. So it's only "never populated" when the user leaves the End Date field blank — which is the default for the import UI (initial `formState.endDate = ""` per `:119`). The carry-forward is right in spirit; the precise wording should be "End Date is empty by default and only saved if the user fills it." |
| `Project.description` never set | Confirmed | `import.service.ts:355-364` never writes `description`. |
| `Project.status` hardcoded to 'ongoing' | Confirmed | `import.service.ts:362` `status: 'ongoing'`. (Schema default is `pending` per `:334`.) |
| No tests exist for any import flow | Confirmed | No `*.spec.ts` files anywhere in `src/import/`. |

**Net: zero drift from the previous session's findings.** Same line numbers, same code on this machine. The only nuance is the `endDate` claim — it's technically writable, just empty in practice. Step 4 (`importSingleInvoice`) field-mapping audit remains TODO.

## 12. Open Questions

1. **`importSingleInvoice` field mapping is unaudited.** The carry-forward flagged "errors in translation of data throughout tables (plural)" but only `createProject` was deeply analyzed. Worth doing for `importSingleInvoice`:
   - Tax-rate derivation (`import.service.ts:419`): `Math.round((taxAmount/amount)*100*100)/100`. Stores as a string. Is `string` what the document template expects, or should it be a number?
   - `gstPercent` is taken from the first item with tax > 0 (`:440-441`). What happens with mixed-tax invoices?
   - `documentInfo.currency` is hardcoded `'SGD'`. Confirm Biofuel-only assumption is intended.
   - `Inventory.status` is hardcoded `'rental'` (`:522`) — for "sold" invoices this seems wrong. Should it depend on `xeroStatus` / `STATUS_MAP`?
   - `Inventory.location` is set to `body.projectLocation` (a Project name string per the §11 confusion), not the SiteOffice address.
   - Credit notes (`source === 'Receivable Credit Note'`) flow through the same code as invoices. Are they meant to subtract inventory or no-op? Currently they create Documents indistinguishable from invoices except for the `xeroStatus` field in `config`.
2. **Permissions on `/import/*`.** No `@Permissions(...)` on any `ImportController` method. Guard requires only authentication. Is the portal-level org guard (`organization.name === 'Biofuel...'`) the only intended gate? If so, the backend is currently writable by any authenticated user with knowledge of the URL.
3. **Prisma migration discipline.** `prisma/migrations/` exists but `db:push` is the only deploy path. Are committed migrations actually source-of-truth, or stale? (CLAUDE.md uses `db:push` only.)
4. **Audit interceptor.** `AuditInterceptor` exists (`src/common/audit.interceptor.ts`) but isn't registered in `AppModule`. Where is it applied? Per-module? Has it been silently disabled?
5. **`AssetUom` widening in the portal.** Portal `ImportInvoices.tsx:927` allows uoms (`PAIR`, `LOT`, `MTH`, `DAY`, `HR`, `TRIP`, `LOAD`) that are NOT in the backend's `UOM_OPTIONS` allow-list (`create-asset.dto.ts:4-35`). Asset creation via `/assets/create` would 400 on those values, but the import flow uses `/import/create-asset` (`import.service.ts:256-300`) which has no `@IsIn` check and accepts anything — divergent behavior between paths. Is that intentional?
6. **Shape of `lineItems` JSON in `ImportInvoice`.** No DTO/Zod schema; the frontend and backend reach into `(li as any).serialNumbers`, `(li as any).serial_numbers`, `(li as any).serial_number`. Three different shapes are tolerated. What's canonical?
7. **`AWS_S3_BUCKET` vs `RESOURCE_BUCKET`.** `.env.example` documents both `RESOURCE_BUCKET` (used in `configuration.ts`) and `AWS_S3_BUCKET` (not seen referenced in TS). Which is current?
8. **Carry-forward feedback request.** Should I now do the §11 / §12 step-4 deep dive (importSingleInvoice field mapping) as the next investigation, or do you want to take that yourself?

## 13. Schema change — asset-based assignments (Phase 2 applied 2026-04-30)

The `Assignment` model now supports two modes: a tracked-inventory unit (existing) or an asset+quantity reference (new, for rentals where the source data has no serials).

### New shape (`api-server-production/prisma/schema.prisma`)

```prisma
model Assignment {
  id          String     @id @default(uuid()) @db.Uuid
  projectId   String     @db.Uuid

  // Mode A: tracked inventory unit (existing)
  inventoryId String?    @db.Uuid

  // Mode B: asset + quantity (new, for rentals without serials)
  assetId     String?    @db.Uuid
  quantity    Int?

  // Source invoice (idempotency on asset-mode + audit trail)
  documentId  String?    @db.Uuid

  startDate   DateTime?  @db.Timestamptz(6)
  endDate     DateTime?  @db.Timestamptz(6)
  createdAt   DateTime   @default(now())

  inventory   Inventory? @relation(fields: [inventoryId], references: [id])
  asset       Asset?     @relation(fields: [assetId], references: [id])
  document    Document?  @relation(fields: [documentId], references: [id])
  project     Project    @relation(fields: [projectId], references: [id])

  @@unique([projectId, inventoryId])
  @@unique([projectId, assetId, documentId])
  @@index([assetId])
  @@index([documentId])
}
```

Back-relations added: `Asset.assignments Assignment[]` and `Document.assignments Assignment[]`.

### The two modes

- **Mode A (inventory):** one Assignment per serial-numbered Inventory unit. `inventoryId` set, `assetId/quantity = null`. Idempotent on `(projectId, inventoryId)`.
- **Mode B (asset):** one Assignment per (asset × source document). `assetId` and `quantity ≥ 1` set, `inventoryId = null`. Idempotent on `(projectId, assetId, documentId)`.

`documentId` is set on every newly-created Assignment (both modes) so each row points at the source invoice for audit + idempotency. Postgres NULL-not-equal-NULL semantics let inventory-mode rows (where `assetId IS NULL` and `documentId IS NULL`) coexist freely under the new composite unique without colliding.

### XOR invariant + enforcement

Exactly one of (`inventoryId`, `assetId`) must be set; if `assetId` is set, `quantity` must be ≥ 1. Enforced at runtime by `validateAssignmentMode(...)` at the top of `api-server-production/src/import/import.service.ts`. Called immediately before each `prisma.assignment.create` in `importSingleInvoice`.

### Ghost-field bug fixes in `projects.service.ts`

The pre-existing service code referenced an `Assignment.documentId` column that did not exist on the schema, plus two `document: undefined` ghosts:
- `:140` — `documentId: assignment.documentId` removed (TODO comment kept for the manual project flow update).
- `:182` — `document: undefined` deleted from the nested-create in `createProject`.
- `:244` — `document: undefined` deleted from the nested-create in `updateProject`.

These would have thrown a Prisma "Unknown arg" error if exercised; bundled into this same change.

### `importSingleInvoice` rewrite (`api-server-production/src/import/import.service.ts:369-580`)

The pre-loop `createdInventoryIds[]` aggregator and the post-loop assignment pass are gone. Each `configItems[i]` with `inventoryItemId` now branches inside its own iteration:

1. Always create one `DocumentItem`.
2. Resolve `serialNumbers[]` to Inventory ids (idempotent on `(sku, organizationId)`).
3. If at least one Inventory id was produced → **Mode A**: per-inventory `findUnique({ projectId_inventoryId })`, then `validateAssignmentMode({ inventoryId })`, then create with `documentId`.
4. Else if `item.quantity > 0` and `body.projectId` is set → **Mode B**: `findUnique({ projectId_assetId_documentId })`, then `validateAssignmentMode({ assetId, quantity })`, then create.

`startDate`/`endDate` come from `body.startDate`/`body.endDate` and are computed once before the loop.

### Backend reads widened (`api-server-production/src/projects/projects.service.ts`)

All four sites that include `assignments` now pull both relations + the source document:
- `:46` (`getProjects`)
- `:90-97` (`getProjectById`)
- `:187` (`createProject` return)
- `:250` (`updateProject` return)

Each include now reads:
```ts
assignments: {
  include: {
    inventory: { select: { sku: true, status: true } },
    asset: { select: { id: true, name: true, skuKey: true, uom: true } },
    document: { select: { id: true, name: true } },
  },
}
```

### Frontend changes (`portal-production/app/portal/projects/[id]/page.tsx`)

- Project header `Start Date` / `End Date`: now show `"Not set"` when null/undefined instead of `01/01/1970`.
- Assignments table:
  - Item SKU: `a.inventory?.sku ?? a.asset?.skuKey ?? "—"` (was `a.inventory.sku`, which crashed on asset-mode rows).
  - **New** Qty column: `a.inventory ? 1 : (a.quantity ?? "—")`.
  - **New** Source column: `a.document?.name ?? "—"`.
  - Start/End cells: parse with `new Date(...)` only when truthy.
  - Status: `a.inventory?.status ?? "Asset"` (real `InventoryStatus` like `"rental"` for inventory-mode rows; `"Asset"` literal for asset-mode rows).

### What was NOT changed

Per scope decision: `AdditionalDetails.tsx`, `LastStep.tsx`, `useCreateProject.ts`, `useUpdateProject.ts`, `useAddProjectFormHandler.ts`, and `documents.service.ts:491-526` were not touched. The manual project-creation form still produces inventory-mode-only assignments. `documents.service.ts` still requires `inventoryItemId` on every line.

## 14. Backfill of confirmed/skipped ImportInvoices (Phase 2.5 applied 2026-04-30)

After the schema change landed, the `Assignment`/`DocumentItem`/`TimelineItem`/`PriceHistory`/`Document`/`Inventory`/`Project` rows were wiped (all data was import-flow byproduct on this test DB), then every `confirmed` + `skipped` `ImportInvoice` was re-translated through the fixed `ImportService.importSingleInvoice`.

### Scripts created (`api-server-production/scripts/`)

| Script | Purpose |
|---|---|
| `check-and-clean.ts` | Read-only DB sanity check. Prints masked DATABASE_URL host + table counts. Refuses if URL contains `prod`/`production`. |
| `cleanup-import-tables.ts` | Wipes import-flow tables in FK-respecting order (`Assignment` → `DocumentItem` → `TimelineItem` → `PriceHistory` → `Document` → `Inventory` → `Project`). Refuses on prod URLs. Idempotent — re-running on empty tables reports "0 deleted". |
| `backfill-imports.ts` | Re-translates every `confirmed` + `skipped` ImportInvoice through the fixed `importSingleInvoice`. Read-only on `ImportInvoice`. Refuses on prod URLs. |
| `_count-deps.ts`, `_check-imp-dupes.ts`, `_check-dupe-docs.ts` | Disposable diagnostics used during the run; can be deleted. |

### Backfill summary (run on `ep-steep-truth-a18pvr39-pooler.ap-southeast-1.aws.neon.tech/AIMS_DB`)

| Metric | Value |
|---|---|
| Total ImportInvoices processed | 1793 (1792 confirmed + 1 skipped) |
| Successfully translated | 1765 |
| Idempotent skips | 28 |
| Failed | 0 |
| New Projects created during backfill | 194 |
| New Assets created during backfill | 18 |
| Final Document count | 1793 |
| Final Project count | 196 |
| Final Assignment count | 1671 |
| &nbsp;&nbsp;inventory-mode | 545 |
| &nbsp;&nbsp;asset-mode (new) | 1126 |

**On the 28 idempotent skips:** all 28 were the very first invoices in date-asc order. Cause: an earlier 30-second probe run had partially populated the DB before being killed — those ~28 rows survived into the full run, where `importSingleInvoice`'s pre-existing duplicate check (`Document.findFirst by name`) correctly detected them and returned `success:false` instead of double-creating. Final Document count (1793) confirms every invoice has exactly one Document.

**Asset-mode majority:** 1126 of 1671 assignments (~67%) are asset-mode — invoices whose line items had no serial numbers. These are exactly the rentals that, under the old code, produced zero Assignment rows. They now correctly tie back to their source Document.

### Re-running the backfill

If schema or import-service logic changes again and you need to re-translate:

```
cd api-server-production
npx ts-node scripts/cleanup-import-tables.ts
npm run db:push -- --accept-data-loss
npx ts-node -r tsconfig-paths/register scripts/backfill-imports.ts > /tmp/backfill.log 2>&1
```

The `tsconfig-paths/register` flag is required because `import.service.ts` uses baseUrl-relative imports like `'src/common/prisma.service'` that ts-node alone can't resolve.

### Failures

None. Skip-reason breakdown:
- `idempotent (already imported)`: 28 (cause above)

### Open caveats from this run

- `siteOfficeId` is null on all 1793 backfilled documents and 194 backfilled projects. The customer/site-office relationship rebuild is Phase 3 and has not been started.
- Customer name lookup is case-insensitive but exact-string only; if any ImportInvoice has a customer name with a typo or extra whitespace not in the Customer table, those would have been skipped with reason `customer not found` — none occurred in this run.
- Tax-rate handling, GST percent derivation, hardcoded `'SGD'` currency, and hardcoded `Inventory.status = 'rental'` from §12 are still TODO; backfill ran the same logic Confirm-button does.

## 15. Portal build state — pre-existing TypeScript error

`npm run build` in `portal-production/` currently fails on a TypeScript error unrelated to this work:

```
./form-components/FormAutocomplete.tsx:196:14
Type error: No overload matches this call.
  Type 'string | Promise<string>' is not assignable to type 'string | TrustedHTML'.
```

`form-components/FormAutocomplete.tsx:202` calls `markdownToHtml(value || "")` and passes the result into `dangerouslySetInnerHTML.__html`. The `marked` package (`^16.0.0` in `portal-production/package.json`) returns `string | Promise<string>` from its default export, which TypeScript no longer narrows to `string`.

This file was not modified in Phase 2 / 2.5 (`git status` shows `app/portal/projects/[id]/page.tsx` as the only changed file in `portal-production/`). The error is pre-existing. `next dev` continues to work because Next.js dev mode is more permissive about TS errors. Recommended fix is to either:
- Cast the result: `dangerouslySetInnerHTML={{ __html: markdownToHtml(value || "") as unknown as string }}`, or
- Use `marked.parse(value, { async: false })` which has a synchronous overload returning `string`.

This should be addressed independently — flagging here so it isn't lost.

## 16. Phase 4: deployments as parent containers (applied 2026-05-03)

A `ProjectDeployment` is now a named parent container ("Deployment 1", "Deployment 2", …) that can hold one or more DOs and their derived invoices. The previous shape was effectively 1:1 with a single source DO.

### Schema change

`api-server-production/prisma/schema.prisma` — `ProjectDeployment`:
- Added `deploymentNumber Int?` (nullable so the additive push doesn't break existing rows).
- Added composite `@@unique([projectId, deploymentNumber])`.
- `description` retained but demoted from "displayed name" to "free-form notes" (comment updated in schema).
- `sourceDocumentId` retained as the originating DO for audit. Additional DOs attach via `Document.projectDeploymentId` (column already existed from the prior pull — no new column needed for multi-DO).

The existing back-relation `invoices Document[] @relation("DeploymentInvoices")` on `ProjectDeployment` now carries BOTH DO Documents and invoice Documents. Service-layer partitioning by `type` is the only thing that prevents miscategorization.

### Two-bucket allowlist (verified type strings)

`api-server-production/src/projects/projects.service.ts` adds two `Set`s and a classifier:

```ts
const DEPLOYMENT_DO_TYPES = new Set(['DO', 'DELIVERY_ORDER']);
const DEPLOYMENT_INVOICE_TYPES = new Set([
  'INVOICE', 'TI', 'TI2',
  'CN', 'CREDIT_NOTE',
  'DN', 'DEBIT_NOTE',
]);
```

`TI2` is treated as an invoice variant in `documents.service.ts:265` and `inventories.service.ts:379` — verified in source. Anything outside both sets (e.g. `RDO`, `QO`, `SO`, `PO`, `PR`, `SAI`, `SAO`) hits a `console.warn` and falls into the `documents` bucket as a default. The same allowlist powers `listDeployments`'s `_count.invoices` filter so the count is invoice-only.

### Naming

`Deployment N` is computed by the API (helper `deploymentName(n)` at the top of the service) and surfaced as `name` on `getProjectById`'s deployments and on `listDeployments` rows. Frontend just reads `deployment.name` — no string composition in the UI.

### Auto-numbering on create (race-safe)

`createDeployment` wraps the create in a `count + create` flow with a P2002 retry (max 3 attempts). The unique constraint `(projectId, deploymentNumber)` is the correctness backstop:

```ts
for (let attempt = 0; attempt < 3; attempt++) {
  const taken = await this.prisma.projectDeployment.count({ where: { projectId } });
  try {
    return await this.prisma.projectDeployment.create({
      data: { ...baseData, deploymentNumber: taken + 1 },
    });
  } catch (err) {
    // catch P2002 on (projectId, deploymentNumber) and retry
  }
}
```

### New endpoint

`POST /projects/deployments/:deploymentId/attach-document`, `@Permissions('projects:update')`, body `{ documentId: string }`. Service `attachDocumentToDeployment(deploymentId, documentId, organizationId)`:
- Validates deployment + document belong to the org.
- Refuses (`409`) if the document already points at a different deployment.
- Updates `Document.projectDeploymentId = deploymentId`. If the document had no `projectId`, inherits the deployment's `projectId` so it doesn't dangle.
- Returns the deployment in the same partitioned shape `getProjectById` produces (just the single deployment).

### `getProjectById` reshape

Per-deployment payload now exposes:
```
{ id, deploymentNumber, name, type, status, description, monthlyRate, currency,
  deployedDate, offHiredDate, notes, sourceDocument,
  documents,    // DO Documents — partitioned from the back-relation
  invoices,     // INVOICE Documents — partitioned from the back-relation
  assignments,
  totalBilled, totalPaid, outstanding, invoiceCount, lastInvoiceDate, lastInvoiceName }
```

`documentItems` (with `sku`, `description`, `quantity`, `unitPrice`, `uom`, `lineNumber`, `itemId`, `itemType`) ride on each DO so the UI can render line items without a second round-trip. Rollups (`totalBilled` etc.) only count `invoices` — DOs don't contribute since they aren't billed.

### Frontend (`portal-production/app/portal/projects/[id]/page.tsx`)

- `Deployment` interface widened with `deploymentNumber`, `name`, `documents[]`. New `DocumentItemRow` and `DeploymentDocument` interfaces.
- `DeploymentCard` title shows `deployment.name` (e.g. "Deployment 3"); `description` becomes a small subtitle.
- New "Add DO" button on each deployment card opens `AttachDocumentDialog`.
- Expanded body now has two sections:
  1. **Delivery Orders** (above) — one card per DO with a nested line-items table.
  2. **Invoices** (below) — the previous monthly invoice rollup table.
- `NewDeploymentDialog`: required-description guard removed, label is "Description (optional notes)", helper text reads "Number is auto-assigned (Deployment 1, 2, 3, …).". Toast on success says "Deployment created (Deployment N)".
- `AttachDocumentDialog`: candidates are filtered client-side from `project.allInvoices` to `type IN ('DO','DELIVERY_ORDER') && !projectDeploymentId`. On success → `fetchProject()` refresh.

### One-time numbering pass

`api-server-production/scripts/number-existing-deployments.ts` (new) was run after the schema push. Numbers existing deployments per project in `createdAt asc, id asc` order. Idempotent. Refuses on prod URLs. Output:

```
projects scanned          : 219
projects already complete : 0
projects updated          : 154
deployments numbered      : 280
```

154 of 219 projects had at least one deployment. The largest was project `CR102` with 8 deployments.

`npm run number-existing-deployments` was added as an npm script for re-running.

### Bundled bug fix: `projects:update` permission seed

**This is not a Phase 4 feature — it's a fix for a pull-introduced bug.** The four deployment endpoints added in the prior pull (`POST /projects/:id/deployments`, `POST /projects/deployments/:id/update`, `POST /projects/deployments/:id/off-hire`, plus the new `POST /projects/deployments/:id/attach-document` from Phase 4) all use `@Permissions('projects:update')`. That permission was never seeded.

**Pre-fix behavior:** every one of those endpoints returned 403 for any user except OsirisAdmin (who bypasses all permission checks per `clerk-auth.guard.ts:128-131`). Anyone else attempting to create or modify a deployment hit `ForbiddenException('User does not have sufficient permissions')`.

**Fix:** `prisma/seed.ts` now upserts `projects:update` and connects it to all four roles that already had `projects:add-assignments`:
- `osirisadmin`
- `superadmin` (update path)
- `superadmin` (create path)
- the third role block at line 1225

`npm run seed` is `upsert`-based and idempotent — re-running it on existing rows is safe.

### Files modified or created

- `api-server-production/prisma/schema.prisma`
- `api-server-production/prisma/seed.ts` — `projects:update` permission added and wired
- `api-server-production/src/projects/projects.service.ts`
- `api-server-production/src/projects/projects.controller.ts`
- `api-server-production/scripts/number-existing-deployments.ts` (new)
- `api-server-production/package.json` — `number-existing-deployments` script
- `portal-production/app/portal/projects/[id]/page.tsx`

### Rollout sequence used

1. `npm run db:push -- --accept-data-loss` (additive: nullable column + unique).
2. `npx prisma generate` (had to re-run manually after killing the api-server dev process holding the engine DLL).
3. `npm run seed` (idempotent upsert of the new permission + role wiring).
4. `npx ts-node scripts/number-existing-deployments.ts`.
5. `npm run build` (api-server) — clean.
6. `npm run build` (portal) — fails on the §15 pre-existing `FormAutocomplete.tsx` error only; Phase 4 code itself compiles.

## 17. Phase 5: service flag on DocumentItem + 4-tab project view (applied 2026-05-04)

Tracks whether each DocumentItem is a service line (labor, delivery, installation, discount) vs a product line, so the project view can keep services out of "Active on Site" and surface them under "Sales & Services" instead.

### Schema change

`api-server-production/prisma/schema.prisma` — `DocumentItem`:
- Added `isService Boolean @default(false)`. Nullable-safe via the default.
- No new constraints or indexes (premature for current query patterns).

### Propagation through the import flow (Option 1)

Phase 5 picked **Option 1** for service-line representation in `DocumentItem`: keep the existing `if (!item.inventoryItemId) continue;` skip in `importSingleInvoice` (`src/import/import.service.ts:498`). Service-only lines (no asset) still skip DocumentItem creation entirely. The `isService` column carries the flag for product rows AND for service rows that DO end up in DocumentItem via the asset path (see "Why isService is non-empty" below).

Three code sites were updated to propagate the flag, all reading from the camelCase `isService` key (verified in audit — no `is_service` snake_case variant exists anywhere in the codebase):

- `src/import/import.service.ts:425-452` — `configItems.push({ ..., isService: !!li.isService })`.
- `src/import/import.service.ts:501-515` — `documentItem.create({ data: { ..., isService: !!item.isService } })`.
- `src/documents/documents.service.ts:79-92` — `syncDocumentItems`'s pushed `documentItemsData` includes `isService: !!item.isService`.
- `scripts/migrate-document-items.ts:84-96` — same one-line addition for parity.

### `getProjectById` derivation

`src/projects/projects.service.ts`:
- The `documentItems` select on each deployment's linked Documents (both the main `getProjectById` include and the `attachDocumentToDeployment` refresh include) now pulls `isService: true`.
- The per-deployment mapper computes a derived `isServiceOnly: boolean`: true when every linked DocumentItem (across DOs and invoices) has `isService === true`. Empty-items defaults to false (don't hide a deployment because we don't know).
- `isServiceOnly` is added to the per-deployment return object.

### Frontend tab restructure (4 tabs)

`portal-production/app/portal/projects/[id]/page.tsx`:

| Tab | Filter |
|---|---|
| Active on Site | `status === "ACTIVE" && !isServiceOnly` |
| Past Deployments | `status !== "ACTIVE"` (covers OFF_HIRED / COMPLETED / CANCELLED) |
| Sales & Services | `serviceOnlyDeployments` (subheading) + `standaloneDocs` (subheading) — both lists, separately labeled |
| All Invoices | unchanged — flat list of every linked Document |

Previously a single "Active on Site" tab rendered both ACTIVE and non-ACTIVE deployments inline (the latter under a "Past deployments" subheader). Now Past has its own tab; off-hired deployments no longer clutter the active view.

A new "Type" column was added to the DO line-items table inside `DeploymentCard`. Cell value: a chip reading `Service` or `Product`, with service rows rendered at 0.7 opacity for visual de-emphasis.

The `Deployment` and `DocumentItemRow` interfaces were widened to include `isServiceOnly: boolean` and `isService: boolean` respectively.

### Backfill outcome

`api-server-production/scripts/backfill-isservice-on-documentitems.ts` (new, `npm run backfill-isservice-on-documentitems`):

| Metric | Value |
|---|---:|
| Scanned | 3351 |
| Matched via `lineNumber - 1` index | 3351 (100%) |
| Matched via sku/desc fallback | 0 |
| Orphans (no matching ImportInvoice) | 0 |
| Mismatches | 0 |
| Services found | 726 |
| Products (kept false) | 2625 |
| **Net flips (false → true)** | **726** |
| Errors | 0 |

A follow-up read-only diagnostic verified the 726 flips correlate with service-y SKUs and categories:

| Bucket | Count | % of flips |
|---|---:|---:|
| SKU starts with `SVC-` | 699 | 96.3% |
| Asset.category = `"Service"` (case-insensitive exact) | 630 | 86.8% |
| Both SKU prefix AND Service category | 622 | 85.7% |
| Neither heuristic | 19 | 2.6% |

The 19 "neither" rows were sampled and inspected — every row was a legitimate service line under a non-obvious shape (DISCOUNT adjustments, TIPPERLORRY overtime, "Installation Service" category that the strict equality check missed, supply-and-install services on equipment SKUs, rental-period billing pro-rate lines). None were misflagged products.

### Why `DocumentItem.isService=true` is non-empty

The Phase 5 audit assumed services don't reach DocumentItem because of the `!inventoryItemId` skip in `importSingleInvoice`. **That assumption was incomplete.** During Phase 2.5's backfill (`scripts/backfill-imports.ts:208`), `findOrCreateAsset` ran unconditionally for every non-metadata line — including service lines. Lines like `SVC-LABOUR`, `SVC-DELIVERY`, etc. got an Asset row created or matched (with category `"Service"`) and were passed into `importSingleInvoice` with `selectedAssetId` populated. The `!inventoryItemId` skip never fired (because `inventoryItemId` was the SVC asset's id, not null), so a DocumentItem WAS created with `itemType: 'ASSET'` pointing at the SVC asset.

So Phase 5's column has real population: 726 of 3351 DocumentItems are service lines tied to SVC-prefixed Assets. The Option 1 decision still holds going forward (new imports won't create DocumentItems for service lines because the post-Phase-5 frontend gate at `ImportInvoices.tsx:311` skips asset auto-creation for services), but historical data from Phase 2.5 has the population this column was designed to mark.

### Source flag verified reliable

A second diagnostic compared `ImportInvoice.lineItems[i].isService` against five independent service-detection signals (SKU prefix, no-resolved-asset, Asset.isTracked, service-y category name, description phrases). Cross-tabbed using the four meaningful signals (signal C — `Asset.isTracked` — was dropped after surfacing as too noisy because Phase 2.5's backfill creates ALL new assets with `isTracked: false` by default, so it fires on 84% of all lines):

| | signals=SERVICE | signals=PRODUCT |
|---|---:|---:|
| isService = true | 731 | 3 |
| isService = false / missing | 636 | 1990 |

The Y bucket (flag-says-yes, signals-say-no) is essentially zero — the source flag has no false positives. The 636 "untagged" rows turned out to be specific-asset rentals: lines like `"Rental of 1 unit APF-90 / S/No: 2022APF1"` with named equipment and serial numbers in the description. Under the user's definition (a service line is "generic, non-tracked, no specific asset identity"), these are correctly products — they're recurring billing for specific physical units, not generic services. The flag draws the right line.

Conclusion: `ImportInvoice.lineItems[i].isService` is a reliable source of truth for the user's service definition. No re-derivation needed.

### Files modified or created

- `api-server-production/prisma/schema.prisma`
- `api-server-production/src/import/import.service.ts`
- `api-server-production/src/documents/documents.service.ts`
- `api-server-production/src/projects/projects.service.ts`
- `api-server-production/scripts/migrate-document-items.ts` — parity update
- `api-server-production/scripts/backfill-isservice-on-documentitems.ts` (new)
- `api-server-production/package.json` — `backfill-isservice-on-documentitems` script
- `portal-production/app/portal/projects/[id]/page.tsx`

### Rollout sequence used

1. `npm run db:push -- --accept-data-loss` (additive: nullable column with default).
2. Prisma client regenerated automatically during db:push (api-server dev process was stopped first to avoid the §16 EPERM issue).
3. `npm run seed` — clean.
4. `npx ts-node scripts/backfill-isservice-on-documentitems.ts` — 726 net flips.
5. `npm run build` (api-server) — clean.
6. `npm run build` (portal) — fails on the §15 pre-existing `FormAutocomplete.tsx` error only; Phase 5 code itself compiles.

### Known unresolved

- `scripts/import-tool/server.js:560-563` — alternate Node import path with its own `prisma.documentItem.createMany` call, NOT updated for `isService`. Left untouched per scope decision. If this path is still used in any environment, DocumentItems it creates will get `isService = false` regardless of the source line item. Verify whether this script is still active before relying on it for new imports.
- Standalone documents (`project.documents` not bound to a deployment) don't have `documentItems` pulled in `getProjectById`, so the Sales & Services tab can't compute service-status on them. They're shown as a flat table under the "Standalone Documents" subheading. If standalone docs need a service indicator later, widen the include.
- Existing 1126 asset-mode Assignments don't carry service info. They're created only when `inventoryItemId` is present, which excludes service-only lines, so this is correct by construction.
