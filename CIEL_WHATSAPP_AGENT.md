# Ciel Interior — WhatsApp Agent

How the AIMS WhatsApp operator works for **CIEL INTERIOR PTE. LTD.** — what it can do, how to use it, how it's secured, and how it's wired underneath.

_Last updated: 2026-08-31_

---

## 1. What it is

The Ciel WhatsApp agent is the **AIMS Operator** — a chat agent that performs **real actions in AIMS** (creates documents, records costs, posts to the ledger) by chatting on WhatsApp. It is not the generic "customer Q&A" bot; it is a tool-using assistant that operates Ciel's own books.

- **Model:** Claude Opus 4.8, running a tool-use loop inside the AIMS backend.
- **Scope:** every message operates inside the **Ciel Interior org** (`09e55c23-e031-4254-8152-a373597b2cb3`) — its customers, projects, documents, chart of accounts.
- **Safety:** anything that moves money or is irreversible (posting an invoice, recording a payment, saving a cost) shows a preview and waits for you to **Confirm**.

---

## 2. The number & who can use it

- **The line you message:** **+65 8053 7238** (verified name "Osiris Technology"). This number is just the *transport* — several orgs can share it.
- **The org is decided by *your* number, not the line.** When you text, AIMS looks up your phone number and routes you into the org it's registered against. Ciel's registered tester is **9115 1041**, pointed at the Ciel org.
- **Only registered staff are recognised.** A number that isn't registered gets nothing from the operator (it can't touch any books). This is the security gate.

To add a Ciel staff member: register their phone number against their AIMS user in the Ciel org (see §7).

---

## 3. What it can do

Ask in plain language. The agent figures out which action you mean and runs it.

**Customers**
- Find a customer, create a new one, update details.

**Sales documents**
- Create quotations and invoices.
- **Raise an invoice from a quotation** — including **progress / milestone billing**: bill only part of a quote now and the rest later (e.g. "bill the 2.8k setup now, the 1.5k next month"). It tracks what's already billed so nothing is billed twice.
- **Edit a draft** — reword a line, change a price, add/remove lines. For small wording changes it does a *surgical* find-and-replace so the rest of the text is preserved.
- **Get an app link** to open any document in the full AIMS editor.
- **Email** an invoice/quotation (with its PDF) to a customer.
- **Confirm / post** a document to the ledger (always behind a Confirm button).

**Projects & costing** _(the Ciel workflow)_
- List your projects.
- **Upload a supplier invoice → project costing table** (see §4).

**Money & reports**
- Record a payment against an invoice.
- Aged receivables / aged payables, sales by customer, GST report.

> The agent only ever offers what your role is allowed to do, and every write is logged against you.

---

## 4. Upload an invoice → project costing (the headline feature)

This is the interior-design workflow: subcontractor and supplier invoices get charged to a project's costing table.

**How to use it**
1. In the chat, **send a photo or PDF** of the supplier invoice (optionally with a caption).
2. The agent reads it and pulls out the **supplier, invoice number, date and amount**, and stores the original file.
3. It files the cost against a project:
   - If Ciel has **only one project**, it uses it automatically — no question asked.
   - If there are **several**, it picks the best match from the invoice, or asks you which one.
4. It shows a preview: *"Add cost — [supplier] [inv#] S$[amount] to [project]? Confirm."*
5. You **Confirm** → the cost is saved to that project's **Subcontractor & supplier costs** table, with the invoice attached.

**Status = Pending approval.** Costs filed by chat come in as **pending**, not auto-approved. A human approves them in the app (the costing view) to finalise them — so nothing lands in the numbers unreviewed.

Everything downstream — *Actual cost vs quotation provision*, variance per section — updates from these cost rows.

---

## 5. The safety model

- **Recognition:** unknown numbers are ignored; only registered staff reach the agent.
- **Confirm-before-commit:** posting invoices, recording payments, saving costs — all show a preview and a **Confirm / Cancel** button (or you can type "yes"/"no"). Nothing hits the books until you confirm.
- **Pending costs:** uploaded costs await human approval in the app.
- **Audit:** every action is written to the audit log against the user who sent it.
- **Draft-safe:** creating or editing a *draft* is safe and needs no confirmation; only *finalising* does.

---

## 6. Typical sessions

**Progress billing a quote**
> You: *bill the 2.8k from QO1202608-001*
> Agent: preview of an invoice for just the 2,800 line → **Confirm** → posted. The remaining 1,500 stays billable later with *"bill the rest of QO1202608-001"*.

**Fixing wording**
> You: *on TI2202608-004 line 1, change "two (2)" to "one (1)"*
> Agent: swaps just those words, keeps the rest of the description intact.

**Filing a supplier cost**
> You: *(send a photo of a Daco Interior tiling invoice)*
> Agent: *"Add cost — Daco Interior Pte Ltd (DINV-2605-003) S$11,067.50 to [project]? Confirm."* → **Confirm** → saved as pending, invoice attached.

---

## 7. Onboarding a number to Ciel

A number is registered as an **operator identity**: `(channel = whatsapp, phone digits) → AIMS user → org`. To point a number at the Ciel org:

```bash
# from api-server-production/, against the prod DB
DOTENV_CONFIG_PATH=.env.production npx ts-node -r dotenv/config --transpile-only \
  scripts/register-whatsapp-operator.ts <phone-digits> <clerkUserId> \
  09e55c23-e031-4254-8152-a373597b2cb3 "<display name>"
```

- `phone-digits` — country code, no `+` or spaces (e.g. `6591151041`).
- `clerkUserId` — the AIMS user the number acts as. Needs a role in the Ciel org (or be the global osirisadmin, which works in any org).

To move a number back to another org, re-run with that org's id.

---

## 8. Current limitations

- **No `create_project` by chat yet** — projects are still made in the app. A cost upload needs at least one project to exist first.
- **Uploads always file as a *project cost*** (Ciel's use case). For non-project orgs (e.g. Osiris/Biofuel) an upload should become a bill/invoice draft instead — that branch isn't built yet.
- **One-project auto-select** relies on the org genuinely having a single project; with many projects it matches or asks.
- The shared line **+65 8053 7238** is an Osiris Technology connection; Ciel doesn't have its own WhatsApp number (not required — routing is by sender).

---

## 9. Under the hood (for developers)

**Entry:** WhatsApp webhook → `WhatsAppService.handleWebhook` (`src/whatsapp/whatsapp.service.ts`). For a sender with a registered operator identity, the message is routed to `OperatorService.handleInbound` and the CRM agent is skipped.

**Identity:** `OperatorAuthService.resolve(channel, phone)` (`src/operator/operator-auth.service.ts`) → `OperatorContext` (org, roles, permissions). `isLinked()` is the cheap routing gate. The global osirisadmin can operate in any org without a membership row.

**The brain:** `OperatorService` (`src/operator/operator.service.ts`) runs the Claude tool-use loop, handles the confirm flow (button tap or typed yes/no → `runPending`), and manages per-user session memory. Channel-agnostic via `ChannelAdapter`; WhatsApp specifics live in `src/operator/adapters/whatsapp.adapter.ts` (send text/document/buttons, typing indicator).

**Tools:** `OperatorToolsService` (`src/operator/operator-tools.service.ts`) — ~30 tools; each declares its required permission and returns either a result or a `pending` action for confirmation.

**Upload → costing path:**
1. `WhatsAppService.downloadMedia(mediaId, token)` fetches the file (2-step Graph API) → `InboundMessage.attachment` (`{dataUri, mimetype, filename}`).
2. `handleInbound` sees the attachment → `OperatorToolsService.extractUpload()` runs `BillsService.extractFromFile` (the AP invoice extractor) + `S3Service.uploadFile` → stamps `ctx.upload`.
3. The `add_project_cost` tool (perm `projects:update`) reads `ctx.upload`, returns a `pending` cost.
4. On confirm, `runPending` calls `ProjectCostingService.addCost(...)` → a `ProjectCost` row (`source = 'whatsapp'`, `status = 'pending'`) with the original attached.

**Data:** costs live in the `ProjectCost` model (the costing table). Documents live in the unified `Document` table.

**Deploy:** backend on Render (`aims-ahwy.onrender.com`), auto-deploys on push to `main`.
