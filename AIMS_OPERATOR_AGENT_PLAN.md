# AIMS Operator Agent — Build Handoff Spec (v2, build-ready)

**Status:** planning complete, implementation not started.
**Audience:** the agent/dev who will build this. Everything below was verified against the codebase on 2026-08-11 — every signature, line number, and data shape is real, not inferred. Paths are relative to `api-server-production/` unless noted.

**Read §13 "Traps" before writing any code.** Most of the ways this build can silently produce broken documents are listed there.

---

## 1. What we're building

A **chat-native agent that IS AIMS**: staff text natural-language commands to a bot and it **executes real actions in the AIMS backend**, replying with a PDF preview where relevant.

> "create a quotation for Beta Industries, 2 fan coil units and 8 hours install" → resolves customer + items + prices → builds a draft quotation → sends the PDF preview + Confirm button → on Confirm, finalizes (and for invoices, the GL auto-posts).

**This is NOT the existing WhatsApp PA agent** (`src/whatsapp/whatsapp-agent.service.ts`), which only drafts trained Q&A text replies to a business's *customers* and executes nothing. The Operator acts for the *org's own staff* and performs real writes.

The tool catalog is meant to grow to **the whole AIMS surface** (customers, quotations, orders, invoices, DOs, POs, credit notes, payments, receipts, reports, balances, document linking). §7's first slice is only the harness proof; after that, each new capability = wrap one more existing service method.

## 2. Locked product decisions

| Decision | Value |
|---|---|
| Channel strategy | **Telegram first**, WhatsApp adapter after. Core must be channel-agnostic. |
| Number/account model | **One shared bot**, multi-tenant by sender identity. (Per-org branded numbers = later upsell.) |
| Identity | Sender → linked AIMS (Clerk) user → their org → their role permissions. Unlinked sender gets nothing. |
| Org isolation | Inherited from AIMS's existing multi-tenancy — every service takes an explicit `organizationId`. Do not invent a new isolation mechanism. |
| Financial safety | **Confirm-before-commit.** Drafts/lookups run freely; confirm/post/pay/send/delete require explicit in-channel confirmation. |

**Why Telegram first:** bot token from @BotFather, no 24h window, no template approval, no Meta review, no ban risk, native file send, and inline keyboards make the Confirm button trivial. The hard 90% (brain, tools, identity, confirm flow) is channel-independent.

## 3. Architecture

```
Telegram webhook ──▶ ChannelAdapter ──▶ OperatorService (Claude tool-use loop)
                     (thin: parse/send)        │
                                               ├─▶ OperatorAuthService   (sender → clerkUser → org + permissions)
                                               ├─▶ OperatorToolsService  (wrappers over existing AIMS services)
                                               └─▶ OperatorSession       (pending draft / awaiting-confirm state)
```

Runs **inside the NestJS backend** as `src/operator/`, driven by a public webhook. Stateless per request — **no persistent process, no VPS** (unlike the whatsapp-web.js group bridge). Deploys with the normal API to Render.

**Channel-agnostic core is mandatory.** All Telegram/WhatsApp specifics live in adapters:

```ts
export interface InboundMessage {
  channel: 'telegram' | 'whatsapp';
  channelUserId: string;   // Telegram numeric id (as string) | WhatsApp phone digits
  chatId: string;          // where to reply
  text: string;
  callbackData?: string;   // Telegram inline-button payload (e.g. 'confirm:<draftId>')
}

export interface ChannelAdapter {
  readonly channel: 'telegram' | 'whatsapp';
  parse(body: any): InboundMessage | null;
  sendText(chatId: string, text: string): Promise<void>;
  sendDocument(chatId: string, url: string, filename: string, caption?: string): Promise<void>;
  sendButtons(chatId: string, text: string, buttons: Array<{ label: string; data: string }>): Promise<void>;
}
```

`OperatorService` only ever talks to `ChannelAdapter`. WhatsApp later = a second implementation.

---

## 4. Module wiring (verified — copy this exactly)

**File layout**
```
src/operator/
  operator.module.ts
  operator.controller.ts        // POST /operator/telegram/webhook  (@Public, token-verified)
  operator.service.ts           // the Claude tool-use loop
  operator-auth.service.ts      // identity + permission resolution
  operator-tools.service.ts     // tool definitions + execution
  adapters/telegram.adapter.ts
  adapters/whatsapp.adapter.ts  // phase 6
```

**PrismaService is NOT global.** `src/common/prisma.module.ts` exists but has no `@Global()` and is only imported by `AuthModule`. The repo convention is each module listing `PrismaService` in its own `providers:` (see `customers.module.ts:8`, `journal.module.ts:11`, `whatsapp.module.ts:13`, `api-v1.module.ts:20`). Follow it.

**Cross-module reuse:** import the owning *module*, inject the service by class. Verified exports:

| Module | Exports | Note |
|---|---|---|
| `DocumentsModule` (`documents.module.ts:20`) | `DocumentsService` | heavy (13 deps) but fine |
| `CustomersModule` (`customers.module.ts:9`) | `CustomersService` | |
| `JournalModule` (`journal.module.ts:12`) | `JournalService`, `JournalAutoPostService` | |
| `CommonModule` (`common.module.ts:24`) | `PrismaService`, `S3Service`, `PdfGeneratorService`, `AuditService`, `XeroService`, … | import for audit/PDF/S3 |
| `WhatsAppModule` (`whatsapp.module.ts:14`) | `WhatsAppService` only | ⚠️ `WhatsAppAgentService` is NOT exported — add it to `exports:` if phase 6 needs it |
| `AssetsModule` / `InventoriesModule` / `PaymentsModule` / `ReceiptsModule` / `StatementsModule` | **verify `exports:` before importing** — add the service to `exports:` if missing |

Closest structural template for the new module: `src/api-v1/api-v1.module.ts:17-21`.

**Register it:** add `OperatorModule` to the `imports:` array in `src/app.module.ts` (L69–130). No auto-discovery.

**Config** — `config/configuration.ts` is a single default-export object; add a sibling block to `WHATSAPP` (L26–34):
```ts
TELEGRAM: {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
},
```
Read with dotted paths: `this.configService.get<string>('TELEGRAM.BOT_TOKEN')`. `ConfigModule` is `isGlobal: true` — inject `ConfigService`, no module import. There is **no Joi validation**, so guard at use-site (`if (!token) throw`).

**Outbound HTTP:** the repo uses **native `fetch`** everywhere (no axios/HttpModule, no Telegram SDK in `package.json`). Call the Telegram Bot API with `fetch`:
`POST https://api.telegram.org/bot<TOKEN>/sendMessage|sendDocument`.

**Webhook endpoint** — `@Public()` lives at **`src/decorators/public.decorator.ts`** (NOT `src/auth/decorators/`, which only holds `permissions.decorator.ts` + `user-organization.decorator.ts`). The global `APP_GUARD` is `ClerkAuthGuard` (`app.module.ts:136-139`); `@Public()` short-circuits it (`clerk-auth.guard.ts:162-166`).

Verify Telegram's `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM.WEBHOOK_SECRET`. Pattern to copy: `whatsapp.controller.ts:223-235` (header-token) and `:258-272` (**ack-fast-then-process** — reply 200 immediately, then `await` the handler in try/catch; Telegram retries on slow/failed responses).

⚠️ **`CustomResponseInterceptor`** (`helpers/custom-sucess.filter.ts:19-27`, registered `main.ts:84`) wraps every returned value as `{success, data, message}`. Just return 200 and send outbound via `fetch` separately — do **not** try to answer Telegram inline via the response body unless you use `@Res()` raw (as `verifyWebhook` does).

---

## 5. Identity & linking — **must be built (does not exist)**

> ⚠️ **There is NO `User` model in `prisma/schema.prisma`.** Identity is 100% Clerk. `UserRole.userId` (L638) and `UserOrganization.userId` (L654) are bare `String` columns holding the **Clerk user id** (`user_...`), with no FK. Therefore **there is no `User.phone`**, and no sender→user mapping exists. `WhatsAppContact` maps a phone to an *org*, not a user — it cannot serve as identity.

### 5.1 New Prisma model

```prisma
model OperatorIdentity {
  id             String   @id @default(uuid())
  channel        String   // 'telegram' | 'whatsapp'
  channelUserId  String   // Telegram numeric id (string) | WhatsApp phone digits
  clerkUserId    String   // the AIMS/Clerk user id
  organizationId String?  // chosen active org (REQUIRED for multi-org users — see 5.3)
  displayName    String?
  verified       Boolean  @default(false)
  lastSeenAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([channel, channelUserId])
  @@index([clerkUserId])
}

model OperatorLinkCode {
  id          String   @id @default(uuid())
  code        String   @unique     // 6 digits
  clerkUserId String
  expiresAt   DateTime
  usedAt      DateTime?
  createdAt   DateTime @default(now())
}

model OperatorSession {
  id            String   @id @default(uuid())
  channel       String
  channelUserId String
  state         Json     // { history: [...], pendingAction?: {...}, draftDocumentId?, draftType? }
  expiresAt     DateTime
  updatedAt     DateTime @updatedAt
  @@unique([channel, channelUserId])
}
```
Run `npm run db:push` after adding (dev), per repo convention.

### 5.2 Linking flow (one-time, verified)
1. Portal (new control in Settings/CRM): logged-in user clicks "Link Telegram" → backend creates an `OperatorLinkCode` (6 digits, 10-min expiry) for their `clerkUserId` and shows it.
2. User texts the bot `/link 123456` → operator matches an unused, unexpired code → upserts `OperatorIdentity{channel, channelUserId, clerkUserId, verified: true}` → marks the code used.
3. Thereafter recognized automatically.

### 5.3 Per-message resolution (`OperatorAuthService`)

⚠️ **`ClerkAuthGuard.loadUserAuth` is `private`** (`clerk-auth.guard.ts:117`) and its cache is `private static` — you **cannot call it**. **Replicate the two queries** in `OperatorAuthService` (recommended over changing a hot auth path). Copy the select constants verbatim from `clerk-auth.guard.ts:10-49` (`USER_ROLE_SELECT`, `USER_ORG_SELECT`) — export them from that file if you prefer not to duplicate.

```ts
// the two queries loadUserAuth runs (clerk-auth.guard.ts:128-145)
prisma.userRole.findMany({ where: { userId: clerkUserId, isActive: true }, select: USER_ROLE_SELECT })
prisma.userOrganization.findFirst({ where: { userId: clerkUserId, isActive: true }, select: USER_ORG_SELECT })
```

Resolution steps:
1. `OperatorIdentity.findUnique({ channel_channelUserId })`. Missing/unverified → reply *"Your account isn't linked. Open AIMS → Settings → Link Telegram."* and stop.
2. Load roles + memberships for `clerkUserId`.
3. **Determine the org explicitly** — do NOT rely on `findFirst`. If `OperatorIdentity.organizationId` is set, use it (after verifying an active `UserOrganization` exists for that user+org). If the user has exactly one active membership, use it and persist it. If >1 and none chosen, ask "which org?" (or `/org` command) and store the choice.
4. Build the context passed to every tool:
   ```ts
   type OperatorContext = {
     organizationId: string;
     clerkUserId: string;
     actor: { id: string; name?: string; email?: string };  // DocumentActor shape
     roles: CachedUserRoles;
     isOsirisAdmin: boolean;
   };
   ```

### 5.4 Permission check per tool call (replicate exactly)

From `clerk-auth.guard.ts:262-285`. Semantics that are easy to get wrong: **a single role must satisfy ALL required permissions** (permissions are *not* unioned across roles), and `*` is a wildcard on resource and/or action independently.

```ts
function hasPermission(ctx: OperatorContext, required: string[]): boolean {
  if (ctx.isOsirisAdmin) return true;                       // role name === 'osirisadmin' (lowercase literal, guard L190)
  const relevant = ctx.roles.filter(r => r.organizationId === ctx.organizationId); // filter by the CHOSEN org
  return relevant.some(ur => required.every(req => {
    const [resource, action] = req.split(':');
    return ur.role.permissions.some(p =>
      (p.resource === resource || p.resource === '*') && (p.action === action || p.action === '*'));
  }));
}
```
**Decision needed (§12):** should `osirisadmin`'s total bypass apply over a chat channel? Default recommendation: **yes for reads, still require confirm for writes.**

---

## 6. The agent brain

Standard Anthropic tool-use loop (`@anthropic-ai/sdk` is already a backend dependency — see `whatsapp-agent.service.ts` for the existing usage pattern):

1. Build `system` (identity, org name, permissions summary, rules) + `messages` (session history + new text) + `tools`.
2. `while (resp.stop_reason === 'tool_use')`: execute each `tool_use` block → append `tool_result` → call again.
3. Final assistant text → send via the adapter.
4. Persist history + any pending draft to `OperatorSession` (cap history ~20 turns; expire ~2h).

**Model: `claude-opus-4-8`.** Do **not** reuse Haiku (the PA agent's model) — that agent only drafts text; this one moves money and must pick tools reliably.

**System prompt must state:**
- Who the user is, their org name, and what they're permitted to do.
- **Never invent** a customer id, item id, price, or amount — always resolve via tools.
- Draft-then-confirm: never call a confirm/post/pay tool without the user's explicit confirmation in this conversation.
- Amounts are SGD unless stated; ask when ambiguous rather than guessing.
- Keep replies short and WhatsApp/Telegram-appropriate (no markdown tables).

**Confirm flow:** after building a draft, the agent calls `preview_document`, the adapter sends the PDF + `sendButtons([{label:'✅ Confirm', data:'confirm:<docId>'}, {label:'❌ Cancel', data:'cancel:<docId>'}])`, and the pending action is stored in `OperatorSession.state.pendingAction`. The callback (or a typed "confirm") executes it. **Confirm callbacks must re-verify identity + permission** — never trust the callback payload alone.

---

## 7. First slice (build this end-to-end first)

`/link` → **"create a quotation for {customer} with {items}"** → `find_customer` → `find_item` ×N → `create_quotation` → `preview_document` (send PDF) → Confirm button → `confirm_quotation`.

This exercises every hard part: identity, permissions, multi-turn tool-use, real writes, PDF delivery, and confirm-before-commit. Only after it's solid should the catalog widen.

---

## 8. Tool catalog → verified methods

Each tool: (1) check permission, (2) call the existing service with `ctx.organizationId` + `ctx.actor`, (3) return compact JSON to the model, (4) audit-log writes. **Never reimplement business logic.**

### 8.1 Read / resolve

| Tool | Implementation | Permission |
|---|---|---|
| `find_customer(query)` | `CustomersService.getCustomers({page:1,limit:5,search:query}, orgId)` — `src/customers/customers.service.ts:18`. Searches `customerCode,name,email,phone,address` (case-insensitive contains). Returns `{docs,...}`. For fuzzy scoring, mirror `V1DocumentsService.fuzzyMatch` (`src/api-v1/v1-documents.service.ts:604`, accept ≥0.6). | `customers:read` |
| `find_item(query)` | `AssetsService.getAssets({page:1,limit:5,search:query}, orgId)` — `src/assets/assets.service.ts:16`. Returns assets with `id, name, skuKey, description, price, costPrice, uom, isTracked, category`. **Use `Asset.id` as `inventoryItemId`** (see §13.2). | `assets:read` (verify actual name) |
| `get_last_price(assetId, customerId?)` | `PriceHistoryService.getLastSoldPrice(assetId, orgId, customerId?)` — `src/price-history/price-history.service.ts:126` → `{unitPrice, documentNumber, documentDate, quantity, uom, customerName} \| null`. Prefer over `asset.price` when present. | `documents:read` |
| `get_document(id)` / `list_recent(type)` | `DocumentsService` getters | `documents:read` |
| `get_open_invoices(customerId)` | `ReceiptsService.openInvoices(orgId, customerId)` — `src/receipts/receipts.service.ts:191` → `[{documentId, reference, date, gross, outstanding, currency}]`. Also the best way to derive a customer balance. | `documents:read` |
| `run_aged_receivables()` | `XeroReportsService.aged(orgId, 'receivable', {level:'summary'})` — `src/statements/xero-reports.service.ts:173`. ⚠️ **Use this, NOT** `StatementsService.calculateAging/getAgingSummary` — those read `xeroBalance` only and return **0** for AIMS-native invoices. | `reports:read` (verify) |

### 8.2 Write

| Tool | Implementation | Permission |
|---|---|---|
| `create_customer(fields)` | `CustomersService.createCustomers(dto, orgId)` — `:127` (auto-generates `customerCode`) | `customers:create` |
| `create_quotation(customerId, items[])` | Build config per §9, resolve template per §10 → `DocumentsService.createBasicDocument(templateId, 'QUOTATION', orgId, config, undefined, ctx.actor)` — `src/documents/documents.service.ts:1815` | `documents:create-basic` |
| `update_document(id, config)` | `DocumentsService.updateDocument({id, type, config, documentTemplateId, version?}, orgId, ctx.actor)` — `:777`. Items = the **whole** `config.items[]` array (there is no add-one primitive). | `documents:update` |
| `preview_document(id)` | `DocumentsService.getOrGeneratePdfUrl(id, orgId)` — `:4975` → **presigned S3 URL string** (or `undefined`). Send that URL via `sendDocument`. | `documents:read` |
| `confirm_quotation(id)` | `updateDocument({id, type:'QUOTATION', status:'confirmed', documentTemplateId}, orgId, actor)` — `:777`. With the `enableConfirmQuotation` org feature on, this auto-creates an Order via `OrdersService.createFromQuotation` (`:1164-1187`). Quotations never post to GL. | `documents:update` |
| `create_invoice_from_quotation(quotationId)` | **Copy the proven server-side pattern** `DocumentsService.createInvoiceFromDeliveryOrder` (`:4326-4370`): resolve INVOICE template → spread the source config → restamp `date` + `sourceDocumentId`/`sourceDocumentNumber`/`sourceDocumentType:'QUOTATION'` → `createBasicDocument(...)`. Include the same idempotency guard (`document.findFirst({type:'INVOICE', config:{path:['sourceDocumentId'], equals: quotationId}})`). | `documents:create-basic` |
| `confirm_invoice(id, fromNo, toNo)` | `DocumentsService.confirmInvoice(id, {fromInvoiceNo, toInvoiceNo}, orgId, actor)` — `:4569`. **Auto-posts the GL** via `JournalAutoPostService.postFromInvoice`, idempotent (`alreadyPostedForDocument`, `journal-auto-post.service.ts:200`). | `documents:update` + `accounting:post` (verify) |
| `record_payment(customerId, documentId, amount, …)` | `PaymentsService.create(dto, orgId, userId)` — `src/payments/payments.service.ts:18`. DTO: `{customerId, documentId, amount, paymentDate ISO, paymentMethod, cashAccountCode?, reference?, notes?}`. Validates posted-invoice + rejects overpayment + updates invoice status + best-effort GL post. ⚠️ **Writes no audit log — you must log it.** | `payments:create` |
| `record_receipt(customerId, amount, allocations[])` | Two-step: `ReceiptsService.create(orgId, actor)` — `:133` → `ReceiptsService.save(orgId, id, dto, actor)` — `:277`. Dto requires `{date, customerId, debitAccountCode, receiptAmount, allocations:[{documentId,amount}]}` and must be **fully allocated** (Σ = receiptAmount ±0.005). Writes its own audit log. **Do not call `postFromReceipt` directly** — that creates a JE with no Payment rows and breaks AR/aging. | `payments:create` |
| `create_bill(...)` / `post_bill(id)` | `BillsService.create(orgId, userId?, dto, {postOnSave})` — `src/bills/bills.service.ts:229`; `.post(orgId, billId)` — `:448` | `bills:create` |

### 8.3 Accounting is NOT rebuilt
"Handle the accounting" = call the existing confirm path. `confirmInvoice` posts via `JournalAutoPostService.postFromInvoice` (`journal-auto-post.service.ts:216`); CN/DN/PO/PR post through `updateDocument` → `repostGlForDocument` (`documents.service.ts:189`). Both guard with `alreadyPostedForDocument` (`:200`).

⚠️ `postFromPayment` (`:371`) and `postFromReceipt` (`:609`) **return `null` silently** when control accounts / bank account / FX rate can't be resolved. Treat `null` as "not posted" and tell the user — never assume success.

### 8.4 Audit every write
`AuditService.logAction(data)` — `src/common/audit.service.ts:23`. It swallows its own errors (can't break a flow). Use the document-history shape so operator actions appear in the doc timeline (copy `DocumentsService.logDocumentEvent`, `documents.service.ts:149-172`):
```ts
auditService.logAction({
  userId: ctx.actor.id || 'operator', userName: ctx.actor.name, userEmail: ctx.actor.email,
  action: 'CREATED' | 'EDITED' | 'STATUS_CHANGED' | 'APPROVED',
  resource: 'document', resourceId: docId, resourceName: docName,
  organizationId: ctx.organizationId,
  details: { detail: 'Created via Operator (telegram)', channel: 'telegram' },
});
```

---

## 9. The document `config` shape (**the #1 source of silent breakage**)

**There are two config shapes in the codebase and only one is real.** The class-validator DTOs (`IConfig`/`ItemDto` in `dto/create-document-with-timeline.dto.ts`, `dto/update-document.dto.ts`) are **legacy, partial, and NOT enforced** — `POST /documents/basic` takes `config?: any` with **zero validation** (`documents.controller.ts:55-74`). A malformed config is accepted and silently produces a broken document.

The real shape is what the portal editor emits (`portal-production/containers/DocumentTemplates/utils/documentDataTransformer.ts:38-186`): a **flat** object where `documentInfo.*` fields are also hoisted to top level. Backend readers accept both (`cfg.subTotal ?? cfg.documentInfo.subTotal ?? cfg.summary.subTotal`, `documents.service.ts:206-208`).

> **Rule: write totals/date/currency in BOTH `config.X` and `config.documentInfo.X`.** Then every reader works.

**Reference implementations to copy:** `v1-documents.service.ts:86-146`, `recurring-invoices.service.ts:174-217`, `documents.service.ts:2334-2419`.

### 9.1 Item fields (exact)
| field | notes |
|---|---|
| `inventoryItemId` | **string uuid — an `Asset.id` OR `Inventory.id`** (polymorphic, §13.2). The only key that materialises a `DocumentItem` row. Empty string for service lines. |
| `itemCode`, `sku`, `description`, `uom` | strings |
| `quantity` | number |
| **`unitPrice`** | number — ⚠️ **NOT `price`**. The DTO's `ItemDto.price` is dead code; every reader uses `unitPrice`. |
| `discount` | number (percent) |
| **`amount`** | number — **caller-supplied line total. Nothing derives it on write**; missing → `DocumentItem.amount = 0`. |
| `tax` | number/string percent (editor defaults 9 for non-invoice types) |
| `accountCode` | GL revenue account or null |
| `isService` | boolean — service lines are skipped by `syncDocumentItems` (fine for quotes/invoices) |

### 9.2 Valid quotation config (2 lines) — copy this template
```jsonc
{
  "company": { "name": "Acme Pte Ltd", "address": "1 Test Rd, Singapore 100001", "phoneNumber": "+65 6000 0000" },
  "gstRegNo": "200812345M",

  "customerId": "11111111-1111-1111-1111-111111111111",
  "customer": { "id": "1111...", "name": "Beta Industries Pte Ltd", "address": "22 Buyer Ave", "email": "ap@beta.example", "customerCode": "C-0042" },
  "customerName": "Beta Industries Pte Ltd",
  "customerCode": "C-0042",
  "customerAddress": "22 Buyer Ave, Singapore 200002",
  "customerEmail": "ap@beta.example",
  "attention": { "name": "Jane Tan", "phoneNumber": "+65 9000 0000", "email": "jane@beta.example" },

  "items": [
    { "id": 1, "inventoryItemId": "2222...", "itemCode": "FCU-100", "description": "Fan Coil Unit 100",
      "uom": "PCS", "quantity": 2, "unitPrice": 500, "discount": 0, "amount": 1000, "tax": 9, "accountCode": "4000" },
    { "id": 2, "inventoryItemId": "", "isService": true, "itemCode": "SVC-INSTALL", "description": "Installation labour",
      "uom": "HR", "quantity": 8, "unitPrice": 75, "discount": 0, "amount": 600, "tax": 9, "accountCode": "4200" }
  ],

  "date": "2026-08-11", "dueDate": "2026-09-10",
  "poNo": "PO-BETA-7788", "referenceNo": "REF-2026-0042",
  "currency": "SGD", "gstPercent": 9, "taxApplicable": "Y", "absorbTax": "N",
  "subTotal": 1600, "gstAmount": 144, "nettTotal": 1744,

  "documentInfo": {
    "date": "2026-08-11", "currency": "SGD", "gstPercent": 9,
    "taxApplicable": "Y", "absorbTax": "N",
    "poNo": "PO-BETA-7788", "referenceNo": "REF-2026-0042",
    "subTotal": 1600, "gstAmount": 144, "nettTotal": 1744, "grossTotal": 1600, "discountAmount": 0
  },

  "termsAndConditions": "Validity 30 days.", "note": "Delivery 4 weeks from confirmed order."
}
```
`attention.phoneNumber` (editor contract) — the v1 API writes `attention.phone`; the editor/preview read `phoneNumber`. Use `phoneNumber`.

### 9.3 You must compute prices and totals — the API does not

**No server-side price lookup exists** and **no server-side totals computation exists** on the `/documents/basic` or `/documents/update` paths. The portal does both client-side. Your tools must:

1. **Price per line:** `PriceHistoryService.getLastSoldPrice(assetId, orgId, customerId?)` → else `Asset.price` (sales docs) / `Asset.costPrice` (purchase docs). Then `amount = round2(quantity * unitPrice * (1 - discount/100))`.
2. **Document totals** (mirror `TabbedDocumentCreator.tsx:1898-1937`; server-side equivalent to copy: `recurring-invoices.service.ts:203-208`):
   ```
   grossTotal = Σ item.amount
   subTotal   = grossTotal - discountAmount
   if absorbTax === 'Y': gstAmount = subTotal * pct/(100+pct); nettTotal = subTotal
   else:                 gstAmount = subTotal * pct/100;       nettTotal = subTotal + gstAmount
   ```
   Round to 2dp. **A config with items but no `nettTotal` shows $0.00 in list views** (documented bug at `documents.service.ts:2405-2409`).

### 9.4 What `createBasicDocument` auto-seeds (do NOT supply)
`documents.service.ts:1815-2035`: document number (`:1877-1919`), `logo` (`:1923`), `stamp.company` (`:1927`), `tableColumnOrder`/`columnLabels` from the template (`:1936`), `documentInfo.taxApplicable`/`absorbTax` as **`'Y'`/`'N'` strings** (`:1955`), `gstPercent` from org `taxRate` (`:1961`), `currency` (`:1964`), per-type T&Cs/notes/footer from `organization.docTypeDefaults[type]` (`:1977`), and customer prefill when `projectId` is passed (`:1992`). It then calls `syncDocumentItems` (`:2021`) and logs `CREATED` (`:2023`).

**Required from caller:** `documentTemplateId`, `type`, `organizationId`. Everything in `config` is optional to the API — but items/customer/totals/date are required for a *correct* document.
**Status:** not settable here — new docs are always `unconfirmed` (DB default). Confirm in a second call.

---

## 10. Template + numbering resolution

`createBasicDocument` needs a `documentTemplateId`.

- ⚠️ `DocumentsService.resolveTemplateIdForType` (`:4376`) is **private** — you can't call it.
- **Use** `DocumentTemplatesService.getDocumentTemplateByType(type, organizationId)` — `src/documentTemplates/documentTemplates.service.ts:193-244`. Returns a full template row (take `.id`). Ladder: per-org active selection (`OrganizationActiveTemplate`, primary first) → selections by `[isDefault desc, createdAt desc]` → org's own `isActive` newest → cross-org `isDefault` → any → **throws 404**. (Verify `DocumentTemplatesModule` exports the service; add to `exports:` if not.)
- Alternative, never-throws behavior: mirror `V1DocumentsService.resolveTemplateId` (`v1-documents.service.ts:470-511`), which auto-creates a minimal template as a last resort.
- **Look templates up by canonical type** (`QUOTATION`, `INVOICE`) — aliases at `documents.service.ts:2181-2192` (`QO|QO1|QT→QUOTATION`, `TI|TI2→INVOICE`, `DO→DELIVERY_ORDER`, …). But the `type` you *store* is whatever you pass; `createBasicDocument` does not alias.

**Numbering** is automatic inside `createBasicDocument`. It calls `DocumentNumberingService.generateNumber(organizationId, documentType, formatId?, when = new Date()): Promise<string|null>` (`src/document-numbering/document-numbering.service.ts:112-148`) and falls back to a legacy scheme when it returns `null`. **Do not set `config.documentNumber`** unless you deliberately want to override the generated number (it hijacks `Document.name`, `:2001-2007`).

---

## 11. Build order

1. **Telegram adapter + `@Public()` webhook + echo.** Prove the channel (secret-token verify, ack-fast, outbound `fetch`).
2. **`OperatorIdentity` + `/link` + `OperatorAuthService`.** Prove identity, org selection, and the permission check. No AIMS writes yet.
3. **Tool-use loop with read-only tools** (`find_customer`, `find_item`, `get_document`). Prove the brain + session history.
4. **First slice writes:** `create_quotation` (§9 config builder + §9.3 pricing/totals) → `preview_document` → Confirm button → `confirm_quotation`. Prove writes, PDF, confirm gate, audit.
5. **Widen the catalog:** invoice-from-quotation, `confirm_invoice` (+GL), payments/receipts, bills, reports.
6. **WhatsApp adapter** — second `ChannelAdapter` impl. Requires adding a **`sendDocument`** to `WhatsAppService` (see §13.6).

Each phase should be independently testable; do not start N+1 before N works end-to-end.

---

## 12. Open questions for the product owner

1. **Who can use it at launch** — all roles, or admins/finance only?
2. Should `osirisadmin`'s permission **bypass** apply over chat, or should chat always enforce role permissions?
3. Are **draft-creating** actions unattended (recommended), or do they also need a confirm?
4. Telegram linking: **6-digit code** (recommended) or share-contact phone match?
5. For `record_payment`, must the operator always require an explicit confirm (recommended **yes**)?
6. Should the operator be **feature-flagged per org** (recommended: yes, via `OrganizationUIConfig.features` — see §13.8)?

---

## 13. TRAPS — read before coding

1. **`price` vs `unitPrice`.** `ItemDto.price` in `update-document.dto.ts` is dead. Every reader uses **`unitPrice`**.
2. **`inventoryItemId` is polymorphic** — accepts an `Inventory.id` (serialized unit) **or** an `Asset.id` (products mode); resolved Inventory-first-then-Asset (`documents.service.ts:1417-1430`, `:357-370`). **For the Operator use `Asset.id`** — it has `price`/`uom` and doesn't consume a specific serial. **An id matching neither table is silently dropped** from `DocumentItem` (warn only) — a bad id fails quietly.
3. **`amount` and all totals are caller-supplied.** Nothing computes them on write (§9.3). Missing totals → $0.00 in lists.
4. **Write totals in both `config.X` and `config.documentInfo.X`.**
5. **`taxApplicable`/`absorbTax` are the strings `'Y'`/`'N'`**, not booleans (`:1955-1959`). To force zero-rated use `taxApplicable:'N'` — passing `gstPercent: 0` is treated as unset and overwritten by the org rate (`:1961`).
6. **No WhatsApp media send exists.** `whatsapp.service.ts` has only `sendText` (`:205`) and `sendTemplate` (`:189`). For phase 6, add a `sendDocument` using the private `dispatch(orgId, {messaging_product:'whatsapp', to, type:'document', document:{link, filename}})`, or send the presigned URL as text. **Telegram sends files natively — the first slice is unaffected.**
7. **Order of operations: fill config first, confirm last.** `updateDocument` **throws 403 "Cannot edit confirmed document"** if `dto.config` is non-empty on an already-confirmed doc (`:795-802`).
8. **Feature flags:** `isOrgFeatureEnabled(prisma as any, organizationId, key)` — `src/common/org-features.ts:6` (a plain exported function, not a service). Auto-post constant: `AUTO_POST_INGEST_FLAG = 'enableAutoPostIngest'` (L4). Reads `OrganizationUIConfig.features[key] === true`.
9. **`createDocumentWithTimeline` is a trap** — it mutates inventory status to `rental`/`instock` and hard-requires `inventoryItemId` on every line (`:1727-1739`). It's the legacy DO/rental path. **Use `createBasicDocument` for quotations/invoices.**
10. **Optimistic concurrency:** sending a stale `version` to `updateDocument` → 409 `VERSION_CONFLICT` (`:806-824`). Omitting `version` bypasses the check — omit it for operator-created drafts unless you're implementing conflict handling.
11. **Invoices have their own confirm endpoint** (`confirmInvoice`), separate from `updateDocument({status:'confirmed'})`. A quotation-derived invoice carrying `sourceDocumentId` **skips stock deduction** by design (`:4604-4611`).
12. **Documents with items but no `inventoryItemId`** are hard-rejected on save for certain types (400 *"Please select inventory items for all rows…"*, `:1319`, `:1732`) — resolve an id or set `isService: true`.
13. **`PaymentsService.create` writes no audit log**; `ReceiptsService.save` does. Log payments yourself.
14. **`StatementsService.calculateAging`/`getAgingSummary` read `xeroBalance` only** → return 0 for AIMS-native invoices. Use `XeroReportsService.aged` instead.
15. **`postFromPayment`/`postFromReceipt` return `null` silently** on unresolvable accounts/FX — surface it, don't assume posted.
16. **The response interceptor wraps everything** — see §4.
17. **A replicated auth cache won't be invalidated** by existing `ClerkAuthGuard.invalidateUser()` call sites. Keep the operator's cache TTL short (≤30s) or skip caching.

## 14. Do NOT

- Do not rebuild accounting/posting — call `confirmInvoice` / `updateDocument({status:'confirmed'})`.
- Do not create a per-type document table — everything is the unified `Document` table (`type` discriminator, payload in `config` JSON).
- Do not bake channel specifics into the core — keep them in adapters.
- Do not skip the confirm gate on financial actions, and always re-verify identity on the confirm callback.
- Do not use Haiku for the operator brain.
- Do not use `/documents/with-timeline` for quotations/invoices (trap §13.9).
- Do not call `postFromReceipt` directly — go through `ReceiptsService`.
