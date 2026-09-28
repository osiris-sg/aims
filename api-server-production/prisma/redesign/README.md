# Schema redesign: every org gets its own schema (DRY RUN)

Nothing in this folder is used by the app, and nothing here has been run against any database.
`prisma/schema.prisma` is still the live schema.

## Idea

- Every org has its **own Postgres schema** (`org_biofuel`, `org_ciel`, …) with its **own copy** of every module it uses,
  described by its **own Prisma file** (`orgs/<org>.prisma`). Nothing business-related is shared between orgs.
- Each org file starts as a copy of the modules the org needs, then belongs to that org. CIEL's `Project`, Biofuel's
  `Project` and Cappitech's `Asset` already differ.
- Only identity and routing stay global, in `platform` (`platform.prisma`, 18 tables). These can't live inside an org, because they are
  needed **before** the org is known: login and org membership, osirisadmin, API keys, WhatsApp webhooks (routed by phone number),
  public links (routed by token), the shared template library and the cross-org activity log.
- Legacy tables (Bill, Transaction, CustomerBalance, ImportInvoice, PassTrackerEntry) stay in `public` as an archive and are not copied.

## Modules (`modules.json`)

| Module | Tables |
|---|---|
| base (12) | Role, UserRole, Permission (each org its own roles), Customer, Supplier, CustomField(+Value), UserDashboardLayout, Notification, AuditLog, EmailIngestConfig/Log |
| accounting (17) | ChartOfAccount, JournalEntry(+Line), AccountingSetting, TaxRate, CostCenter, Budget, FixedAsset, DepreciationEntry, RecurringJournalTemplate, AccountMemory, BankStatementImport/Line/Match, XeroConnection, XeroAccountMapping, XeroSyncRun |
| stock (4) | Asset, Category, Inventory, QuantityAdjustment |
| documents (16) | Document, DocumentLine (new), DocumentItem, numbering, share/sign links, embeddings, SubmitJob, Order, RevenueItem, PriceHistory, AssetTemplateTag, TimelineItem, Payment, BillPayment, RecurringInvoiceTemplate |
| projects (1) | Project (each org's own shape) |
| contacts (6) | SiteOffice, ContactDetail, CustomerContact, ProjectContact, CustomerInfoRequest/Contact (site contacts + customer-info links) |
| rental (2) | ProjectDeployment, Assignment |
| field (6) | Delivery, DeliveryItem, DeliveryShareLink, MaintenanceServiceReport, DeliveryLocationPing, MaintenanceSchedule |
| interior (11) | Lead, LeadAttachment, ProjectCost, ProjectMilestone, ProjectQuestStep, ProjectScheduleItem, ProjectShareLink, QuestMediaRequest, SupplierRebate, Team, WorkSection |
| comms (9) | WhatsApp messages/QnA/agent/suggestions/scheduled/contacts/appointments, AdAccountConnection, AdInsight |

## Orgs

| Org file | Schema | Modules | Tables | Own shape |
|---|---|---|---|---|
| biofuel | org_biofuel | base, accounting, stock, documents, projects, contacts, rental, field, comms | 73 | Project with site office, PO no., deployments |
| ciel | org_ciel | base, accounting, documents, projects, interior, comms | 66 | Project with designer, stage, commission, rebate; RevenueItem with work-library fields |
| cappitech | org_cappitech | base, accounting, stock, documents | 49 | Asset with capacityKw, points, accessories |
| osiris | org_osiris | base, accounting, stock, documents, projects, field, comms | 65 | Asset/Inventory with water-sg fields |
| yourworld, u2can, platformorg | org_… | base, accounting | 29 | – |

## Files

| Path | What |
|---|---|
| `platform.prisma` | Global identity/routing. New: `User`, `OrgTenant` (org → schema + org file), `PublicToken` (token → org) |
| `orgs/<org>.prisma` | That org's complete schema. All 8 files pass `prisma validate` |
| `sql/00_preflight.sql` | READ-ONLY. Data an org has in a module or column its own schema won't get, org-name patterns, orgs without a plan, rows with no org |
| `sql/01_org_preview.sql` | READ-ONLY. Which org lands in which schema |
| `sql/<org>/1_create.sql` | Create the schema, enums, tables and indexes (from `prisma migrate diff --from-empty`) |
| `sql/<org>/2_copy.sql` | Copy that org's rows from `public` into its schema. Children found through their parents. `public` is only read |
| `sql/<org>/3_foreign_keys.sql` | Add all FKs after the copy. Fails and rolls back if anything copied points at data that wasn't |
| `sql/<org>/9_rollback.sql` | `DROP SCHEMA org_x CASCADE`. `public` was never touched |
| `sql/80_platform_move.sql` | Move the 15 existing global tables to `platform` (metadata only) + rollback |
| `sql/81_seed_org_registry.sql` | Fill `platform.OrgTenant` |

## Run order, per env (dev first)

1. `00` + `01` (read-only). Resolve every row that needs attention.
2. Per org: `1_create` → `2_copy` → `3_foreign_keys`. Repeatable at will on dev: `9_rollback` wipes the org schema.
3. Cutover window (writes paused, because the copy is point-in-time): re-run step 2 fresh, `80` platform move, push
   `platform.prisma`, `81` registry, deploy the org-aware build.
4. Later: archive or drop the old `public` tables.

## App changes

- `PrismaService` becomes org-aware: request → org → `OrgTenant` → a cached client for that org's file, created with
  `new PrismaNeon({ connectionString }, { schema: 'org_ciel' })` (the adapter supports this). A second client serves `platform`.
- To avoid touching ~2,000 `this.prisma.*` calls in 82 files, `this.prisma` can resolve to the current org's client per request
  (request-scoped provider or AsyncLocalStorage). Crons, queue workers and webhooks set the org explicitly, and so do
  the ~640 ad-hoc scripts that use Prisma.
- Typing: org clients differ. Shared code types against the common modules; org-specific code imports its org's client.
- Raw SQL: schema-qualify or rely on the client's schema.
- Deploy: `db push` runs once per org file (loop over `OrgTenant`), plus once for `platform`.

## Changing things later

- **Change one org**: edit `orgs/<org>.prisma`, push only that org's schema. Other orgs are untouched.
- **Change for everyone** (a fix in documents): the same edit in every org file that has the module, then a push per org.
  Keep the module sources in `modules.json` and regenerate, so a shared fix is one edit.
- **New org**: copy the closest org file (e.g. `biofuel.prisma` → `neworg.prisma`), create `org_neworg`, add an `OrgTenant` row.
