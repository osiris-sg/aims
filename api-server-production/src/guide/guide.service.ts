import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { APP_KNOWLEDGE } from './app-knowledge';

// ---------------------------------------------------------------------------
// In-app guide assistant ("AIMS Guide"). Powers the floating bottom-right chat
// widget: the user asks "how do I create a delivery order?" and the assistant
// answers briefly AND emits UI actions the portal executes — navigate to a
// screen and/or start a step-by-step guided tour (spotlight popups).
//
// The frontend owns the tour definitions (selectors are a UI concern); each
// request carries the catalog of available guides + the org's enabled modules
// so the model only ever references things that actually exist for that org.
// ---------------------------------------------------------------------------

export type GuideAction =
  | { type: 'navigate'; path: string; label?: string }
  | { type: 'start_guide'; guideId: string }
  // A walkthrough the model composed itself (for questions with no prebuilt
  // guide). The frontend plays it through the same TourOverlay engine.
  | {
      type: 'custom_guide';
      guide: {
        title: string;
        steps: Array<{ route?: string; anchor?: string; title: string; body: string; advanceOnClick?: boolean }>;
      };
    };

export interface GuideChatContext {
  currentPath?: string;
  modules?: Array<{
    code: string;
    label: string;
    route: string;
    // path is the real navigation target (some submenus have href overrides
    // that differ from route/key — e.g. Accounting → Setup).
    subMenus?: Array<{ key: string; label: string; path?: string }>;
  }>;
  guides?: Array<{ id: string; title: string; description: string; route: string }>;
}

const MODEL = 'claude-opus-5';
const MAX_ITERATIONS = 3; // answer + at most a couple of action rounds

// Modules guru marked as legacy (2026-07-27). Filtered out of the context
// server-side as well (defense in depth vs the frontend filter) so the
// assistant can never guide users into retired screens. Keep in sync with
// LEGACY_MODULES in portal GuideAssistant/guides.ts.
const LEGACY_MODULES = new Set<string>([
  'DOCUMENTS',
  'INVOICES',
  'PAYMENTS',
  'ASSETS',
  'USER_MANAGEMENT',
  'AUDIT',
  'ANALYTICS',
  'INTEGRATIONS',
]);

// Anchor vocabulary + access rules appended after the full APP_KNOWLEDGE
// (imported from ./app-knowledge — the compiled codebase survey).
const KNOWLEDGE_FOOTER = `
Spotlight anchors you may use in walkthrough steps (anchor field):
- "nav-<MODULECODE>" — a sidebar module item (e.g. nav-SALES, nav-ACCOUNTING)
- "nav-<MODULECODE>-<submenuKey>" — a sidebar submenu item (e.g. nav-SALES-delivery-orders, nav-ACCOUNTING-ledger) — submenu keys are in the screen list
- "page-create-button" — the Create/New button on any list page
- "page-filter-button" — the Filter button on any list page (opens the filter drawer: status, dates, customer…)
- "page-search" — the search box on any list page
- "document-row-view" — the eye (view/open) icon on a document list row
- "bills-upload" — the bulk "Upload Bills" button on the Bills page (/portal/accounting/bills)
- "document-upload" — the "Upload <type>" button on any Sales document list page (upload existing PDFs/images/ZIP for AI extraction)
- On the Finance Hub (/portal/accounting): "finance-ask-ai" (Ask AI button), "new-journal-entry", "close-period"
- "bankrec-upload" — the "Upload PDF statement" button on Bank Reconciliation
- "maintenance-schedule-button": the "Schedule maintenance" button on Service Reports -> Maintenance Dates (/portal/maintenance-reports/dates)
- AIMEE (/portal on orgs with enableAimsChat): "aimee-bar" (the strip on top of the dashboard), "aimee-face" (her face in the strip; press to open), "aimee-ask" (the Ask AIMEE box in the strip), "home-view-toggle" (her face in the top bar; opens AIMEE from any page, closes it when open), "aimee-header" (AIMEE's name and face once open), "aimee-close" (Dashboard button that closes AIMEE), "chat-home" (the whole open screen), "chat-new" (New conversation button), "chat-input" (message box), "chat-composer" (message box frame incl. 📎), "chat-prompts" (suggested prompts), "chat-panel" (side panel), "chat-panel-open-editor" (Open in editor button in the panel)
- Template design (Admin Panel → organization → Document Types tab, flag enableTemplateDesign): "manage-templates" (Manage Templates button on a document type row), "template-design" (Design button on a template card), "template-design-knobs" (the colour / font / logo / blocks controls), "template-design-save" (Save design button)
- "ar-official-receipt" — the "Official Receipt" button on Accounts Receivable (opens the receipt editor)
- Shipments (orgs with the SHIPMENTS module): "contracts-from-pis" (bulk "New shipments from PIs" drop zone, inside its dialog), "contract-fill-from-pi" (the "Fill from PI" drop zone at the top of the New Shipment (contract) dialog), "shipment-fill-from-bl" (the "Fill from B/L draft" drop zone at the top of the New shipment dialog), "bl-draft-check" (the B/L draft check panel on a shipment's Overview / its "Approve B/L draft" step), "shipments-tab-pending" / "shipments-tab-completed" (the Pending / Completed tabs on the Shipments list), "deal-actions-menu" (the ⋮ menu in the deal page header: Complete / Cancel / Reopen contract), "create-from-source" (the "Create from …" item in a Customer PL / COA step's "Other ways" menu), "step-bulk-drop" (the "Drop all documents here" zone at the top of a step card with 2+ uploads, e.g. 3. Receive shipping documents), "bulk-drop-table" (the confirm table of a bulk drop: detected type, confidence, Skip), "settings-bl-defaults" / "settings-doc-settings" / "settings-qmjp" / "settings-email-intake" / "email-intake-address" / "email-intake-list" (Org Settings → Shipping & documents: B/L defaults, Document settings, QMJP by quarter, Email intake section, its address + copy button, its Received emails list), "orders-expand" (the chevron that expands an order row into its shipments), "order-fill-from-pi" (Fill from PI in the New Order form), "order-save" (Create order button), "order-add-shipment" (Add shipment on the order page), "order-shipment-cards" (the shipment cards on the order page), "order-billing-chip" (the billing chip in the order header), "step-na-chip" (an N/A (customer profile) step), "step-subtasks" (a step's sent sub-tasks), "estimator-costs" / "estimator-import-tax" / "estimator-actuals" (the estimator on shipment steps 7 / 8 / 12), "order-reconciliation" (step 13 panel), "invoice-covers-picker" (which shipments an Invoice #2 / single invoice covers), "invoice-covers-chip", "invoice-suggest-costs" (Suggest costs from estimator), "format-not-confirmed-chip", "customer-pl-attach-body" (計量検収票 body: container PL page or typed table), "settings-estimator" / "settings-estimator-rates" (Org Settings → Shipping & documents → Estimator rates), "customer-profile-card" / "profile-billing-mode" (Org Settings → Customers), "inbox-tabs" / "inbox-table" / "inbox-undo" (Shipments → Inbox)
- Shipments round E (cash, alerts, contract master): "shipments-home" (Shipments Home page), "my-tasks" (My tasks today card), ""pipeline-grid" (the pipeline grid — only with the enableTradePipelineGrid flag, off by default since round K), "manager-money" (cash by month + open credits, managers only), "price-check-panel" (price check on a PI / invoice), "contract-master" (Contract terms card on a contract), "credit-note-chip" (Credit note chip on a negative Invoice #2), "apply-open-credit" (Apply open credit on an Invoice #1), "invoice-costs-basis" (Costs basis Estimated / Actual on Invoice #2), "cost-variance" (Cost variance panel at step 13), "profit-formula-pending" (manual profit at step 13), "generated-entity" (Entity picker on a generated document), "hub-entity-badge" (entity badge in the Documents table), "shipment-track" (Track button by the B/L), "shipment-port-storage" (Port & storage panel), "shipment-folder-zip" (Download folder .zip menu item), "settings-alerts" (Alerts settings), "settings-supplier-profiles" (Suppliers section in customer settings), "settings-lme" (LME monthly averages table), "shipment-tracking-paste" (the Paste tracking button next to Track on a shipment's Arrival panel — round AL), "settings-lme-feed" (the Westmetall LME feed panel under that table: source, last fetch, Fetch now / Preview, monthly averages vs the table — round AK), "settings-qmjp" (QMJP by quarter), "settings-bank-entity" (a bank account's entity select), "settings-customer-bank" (a customer's default bank account in Settings → Customers), "settings-customer-addressee" (a customer's 宛先 for the PL / COA in Settings → Customers), "customer-pl-auto-crop" (Auto crop switch on a 計量検収票 attached page), "settings-intake-keep-domains" (Email intake — never purge mail from, in Settings → Shipping), "order-check-confirm" (the "Check: … · Mark confirmed" button on an order), "order-unconfirmed" (the "Unconfirmed" chip in an unconfirmed order's header — round AB), "dashboard-toggle" (the Overview / Admin toggle, top-left of the Sales dashboard — the "To do" line and the "Dashboard" heading were removed in round AC).
- Shipments round H (one order process): "orders-monthly" ("+ New monthly order" on the orders list), "monthly-order-grid" (its rows grid), "order-steps" (the order's steps 0–2 above the shipments), "order-closing-steps" (the order's steps 11 / 13 below the shipments), "order-vedanta-side" / "order-customer-side" (field groups on the order's Details tab), "step-payment" (a step's payment: amount, date, account, proof), "shipments-list" (Shipments → Shipments page), "shipments-list-tabs" (its In transit / Arrived / Delivered / Completed tabs), "inbox-pi-table" (Vedanta's PI table → the month's orders, in the Inbox), "inbox-check" (the "check" chip on an inbox match whose subject disagrees), "step-create-from-source" (step 4's "Create from PL spreadsheet / COA summary" button), "monthly-order-import-pis" ("Import from PI PDFs…" in the monthly-order window), "inbox-change-order" ("Change order…" on an inbox row), "inbox-picker" (the order picker window), "inbox-auto" (the "Auto · B/L …" chip on an email applied by itself), "inbox-accept-rate" (the last-30-days accept-rate line above the inbox tabs).
- Shipments round K: "orders-progress-bar" (an order's segmented progress bar on the Orders list), "inbox-filter-preview" (the Filter preview tab in Shipments › Inbox), "inbox-filter-table" (its table), "settings-email-filter" (Settings → Shipping → Email filter: mode + allow-list), "settings-email-filter-domains" (its Allowed domains box).
- Shipments round L: "hub-tabs" (the category tabs on the Documents page), "hub-order-link" (a row's #27-1 order / shipment link on the Documents page).
- Shipments round N: "order-tolerance" (the over-tolerance warning on the order page), "order-tolerance-3a" (the same on step 3a), "inbox-dialog-actions" (Accept / Change order… / Not a shipment in the email details window).
- Shipments round O (no Home page): "orders-tasks" (the "Tasks (n)" button on the Orders list header — opens the tasks side panel), "my-tasks" (the task list itself: on the Orders panel, in the bell, and on the flag-gated Home page), "bell-tasks" (the Tasks section at the top of the bell dropdown), "receipt-not-tracked" (the "Imported, payment not tracked" line on an invoice step).
- Shipments round P (Sales nav, email-first dashboard, inbox threads): "dashboard-emails" (the Emails to confirm section), "dashboard-filed" (Filed automatically, last 3 days), "dashboard-tasks" (the Tasks section), "dashboard-arriving" (Arriving this week), "inbox-tabs" (now the two tabs Unprocessed / Processed), "inbox-thread" (a thread row in the Inbox), "inbox-reason" (the reason chip on an unprocessed message), "inbox-linked" (the "Linked to" chip / per-attachment lines), "inbox-by" (the "Confirmed by … · when" / "Auto · …" line on a processed message), "settings-filter-preview" (the sender-filter preview table in Org Settings → Shipping → Email filter).
- Shipments round Q (backlog, UI trims): "inbox-no-order" (the "No order yet — create one?" group at the bottom of Unprocessed), "inbox-create-order" (its "Create order from this thread" button), "settings-hidden-emails" (the Hidden emails table in Org Settings → Shipping → Email filter), "inbox-accept-rate" (the accept-rate line — now in that settings section).
- Shipments round W (question cards, result box, emails view): "dashboard-see-all-emails" (the "See all emails" button on the Dashboard's Emails section), "emails-all" (the two-tab view it opens), "emails-back" (its "← Back to Dashboard" link), "question-queue" (the queue of question cards), "question-card" (one card), "question-title" (its question), "question-show-full" ("Show the full email"), "question-not-shipment", "question-not-deal", "question-ask-later", "question-result" (the banner after an answer, with Undo "question-undo"), "question-list" (the other waiting threads under the card), "thread-card" (a processed thread's card), "thread-result" (its result line), "thread-earlier" ("3 earlier emails"), "result-box" (the big result box in the opened thread), "why-link" / "why-panel" (the "Why?" link and what it reveals), "thread-timeline" / "timeline-row" (the numbered timeline and one row), "timeline-different" ("This one is different"), "email-headers-compact" (the one-line From/To), "email-show-original", "email-signature", "email-links" (the restyled email's toggles), "settings-email-companies" (the Companies table in Email filter settings). "email-dialog-close" (the X of the email pop-up / timeline dialog, round X). Round AA (minimal card, confirm-first): "question-from" (the "From Company · date · subject" line), "question-choose" (the "Choose shipment" / "Answer" button that opens the dialog), "choose-shipment-dialog" (the dialog: search, "Likely" list with "Select all", all open shipments, the Not-a-shipment / New-deal / Ask-later options, Confirm), "thread-latest-email" (the newest email expanded in the thread pop-up), "email-dialog-from" (the pop-up title's from-line). Round AB (card list): "question-queue" is now the whole list block, "question-list" the stack of cards, "question-number" a card's circular number badge, "question-subject" its full subject (2 lines), "question-from" the "Company · date time" line, "question-summary" the one-line summary, "question-choose" the "Answer" button, "question-more" the "Show N more" button.
- Shipments round AG (Monthly list): "monthly-list" (the page), "monthly-filters" (Month by / From / To / Client / Supplier / Grade / Status), "monthly-export" (Export → .xlsx in ADH's layout or CSV), "monthly-group-order" / "monthly-group-supplier" / "monthly-group-shipment" (the three header groups), "monthly-block" (a client's block title row), "monthly-row" (one row — opens the order on that shipment's current step), "monthly-kanri" (the 管理NO cell: #n-s, the client-order number).
- Shipments round AM (Clients, Monthly view): "orders-view-toggle" (List | Monthly at the top of Orders and of a client's Orders tab), "monthly-month-picker" (‹ month › + Range + This month), "monthly-order-status" / "monthly-supplier-status" (the two yellow status cells), "monthly-notes" (a shipment's Notes cell — click to edit), "clients-customers" / "clients-suppliers" (the Clients lists), "clients-tab-customers" / "clients-tab-suppliers" (the Customers · Suppliers switch), "client-profile" (a customer's page), "client-tab-orders" / "client-tab-contracts" / "client-tab-details" / "client-tab-formats" (its tabs), "client-contract" (one contract card), "client-doc-formats" (the Document formats tab), "client-format-generator" (a document's format select), "client-format-sample" (Add sample), "client-format-preview" (Preview on shipment), "client-supplier-docs" (the documents a supplier sends).
- Shipments round AN (one Orders header, Hoei formats): "shipments-tab-all" (the All tab next to Pending / Completed), "monthly-totals" (the "N orders · N rows · N t" totals in the Monthly toolbar), "monthly-elsewhere" (the "Found in: <month>" chips when a search matches another month).
- Shipments round AF (step-by-step Answer, thread files): "answer-flow" (the Answer dialog; data-step = q1 / what / which / confirm), "answer-step-title" (the one question on screen), "answer-yes" / "answer-no" (step 1), "answer-existing" / "answer-not-shipment" / "answer-later" (step 2), "choose-shipment-search" / "choose-shipment-likely" / "choose-shipment-all" (step 3), "answer-next", "answer-back", "choose-shipment-confirm" (the final Confirm), "thread-files" (the "All files in this thread (n)" list at the top of the email pop-up), "thread-file" (one file row with Preview / Download), "thread-gap" (the grey "earlier emails weren't forwarded" line), "timeline-attachments" (an earlier email's attachment names in its row), "result-file-link" (a filed document line in the result box — opens the order page on that step and file), "result-order-chip" (the order chip under it), "file-highlight" (the highlighted file row on the order page).
- Shipments round R (order page focus, evidence): "record-current-step" (the "Step 4 · Customer docs" text in the record header), "order-header-line2" (the header's second line), "shipment-card-menu" (the ⋮ on the selected shipment card), "inbox-evidence" (the italic evidence line on an inbox message).
- WCT service job DO (2026-10-27): "run-select-service-item" (the "Select item" button on a Service line of the field app's run page — one tap, no photos).
- WCT service report (2026-10-27): "field-service-report" (the "Write Service Report" / "View Service Report" button on the field app's "Delivery completed" screen of a run with a Service line), "service-report-print" / "service-report-download-pdf" (Print and Download PDF above the server-rendered paper on a WCT report's portal page).
- Service reports (2026-10-26): "service-report-sign-link" (the "Copy sign link" button on an unsigned service report page in the portal, and "Customer not here? Send sign link" on the field app's Sign screens).
- In the Official Receipt editor: "or-amount" (Receipt Amount field), "or-offset-grid" (Offset Transactions grid — allocate against invoices)
- Inside the document editor only: "editor-customer" (customer field), "editor-add-item" (Add Item button), "editor-add-service" (Add Service button — opens the Services master-file picker; orgs with enableServiceItems), "service-picker-add-selected" (the "Add N services" button inside that picker, multi-select mode), "editor-confirm" (Confirm button), "editor-send-email" (Send Email button — invoices/quotations), "editor-save" (Save button), "editor-preview" (Preview/Edit toggle), "editor-more-menu" (the ⋮ more-actions menu — Print/PDF, Duplicate, Create Revision, History & notes live in it), "editor-ask-ai" (Ask AI button)
Steps whose anchor can't be found on screen show as a centered explanation card, so a step with no anchor is fine — use anchor-less steps for anything without a listed anchor.

Access control: the screen list in each request is already filtered to what THIS user and organization can access. If something (even something described above) is not in the screen list, do not navigate there or build steps for it — tell the user it isn't available to them and, if relevant, that an administrator's help is needed.`;

@Injectable()
export class GuideService {
  private readonly logger = new Logger(GuideService.name);

  // Streams SSE-style events to the widget:
  //   { type: 'text', delta }       — answer text chunk
  //   { type: 'action', action }    — navigate / start_guide for the UI to run
  //   { type: 'error', message } / { type: 'done' }
  async chatStream(
    question: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
    context: GuideChatContext | undefined,
    emit: (e: any) => void,
  ): Promise<void> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      emit({ type: 'error', message: 'Guide assistant is not configured (missing ANTHROPIC_API_KEY)' });
      return;
    }
    const client = new Anthropic({ apiKey });
    const tools = this.buildTools();
    const system = this.buildSystemPrompt(context);
    const messages: Anthropic.MessageParam[] = [
      ...(history || []).slice(-12).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: question },
    ];

    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          // Navigation answers should be snappy — low effort keeps latency down.
          output_config: { effort: 'low' },
          system,
          tools,
          messages,
        } as any);
        stream.on('text', (delta) => emit({ type: 'text', delta }));
        const response = await stream.finalMessage();

        if (response.stop_reason === 'refusal') {
          emit({ type: 'error', message: 'The assistant declined to answer that. Try rephrasing your question.' });
          return;
        }

        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) break;

        messages.push({ role: 'assistant', content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          const tu = block as Anthropic.ToolUseBlock;
          const action = this.toAction(tu.name, tu.input as any, context);
          if (action) {
            emit({ type: 'action', action });
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'ok — the UI is doing this now' });
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: 'Error: unknown route or guide id — only use paths/ids from the lists you were given',
              is_error: true,
            });
          }
        }
        messages.push({ role: 'user', content: toolResults });
      }
    } catch (e: any) {
      this.logger.error(`guide chatStream failed: ${e?.message || e}`);
      emit({ type: 'error', message: e?.message || 'Guide assistant failed' });
    } finally {
      emit({ type: 'done' });
    }
  }

  // System prompt is split into two blocks for prompt caching: the big static
  // part (persona + compiled app knowledge + rules) carries a cache_control
  // breakpoint, and the small per-request part (current page, this user's
  // screens and guides) comes after it so it never invalidates the cache.
  private buildSystemPrompt(context: GuideChatContext | undefined): Array<Record<string, any>> {
    const modules = (context?.modules || []).filter((m) => !LEGACY_MODULES.has(m.code));
    const guides = context?.guides || [];

    const moduleLines = modules
      .map((m) => {
        const subs = (m.subMenus || [])
          .map((s) => `    - ${s.label}: ${s.path || `${m.route}/${s.key}`} (anchor nav-${m.code}-${s.key})`)
          .join('\n');
        return `- ${m.label} (${m.code}): ${m.route}${subs ? `\n${subs}` : ''}`;
      })
      .join('\n');

    const guideLines = guides
      .map((g) => `- id: ${g.id} — "${g.title}" (lands on ${g.route}): ${g.description}`)
      .join('\n');

    const staticPart = `You are the AIMS Guide — an in-app assistant living in the bottom-right corner of the AIMS portal (Asset & Inventory Management System). You help users find their way around and learn how to do things, by TAKING THEM THERE, not just describing it.

${APP_KNOWLEDGE}
${KNOWLEDGE_FOOTER}

Rules:
- BE CONTEXT-AWARE: the user's current page is given below. If they are ALREADY on the relevant screen, do NOT navigate and do NOT make a "go to / open the page" step — start the walkthrough directly on the control (e.g. already on the invoice list and asking about filtering → step 1 anchors page-filter-button, not "open Invoices"). Only navigate when the answer lives on a DIFFERENT screen.
- "How do I …?" questions that match a prebuilt walkthrough → call start_guide with that guide's id, and reply with ONE short sentence like "Taking you there — just follow the highlighted steps."
- "How do I …?" questions with NO matching prebuilt walkthrough → compose one yourself with show_steps (2-6 steps) using the app knowledge above: navigate to the right screen on the first step, use the documented anchors where available, and put instructions the UI can't point at into anchor-less steps. Reply with one short sentence.
- "Where is …?" / "Show me …" questions → call navigate with the matching route, plus a one-sentence answer.
- Pure informational questions about AIMS ("can I…?", "what does X do?") → answer in 1-3 short sentences from the app knowledge; navigate too if a screen is clearly relevant.
- Accounting DATA questions (who owes me, P&L numbers, balances) → point the user to the Finance Hub's own Ask AI assistant and navigate to /portal/accounting.
- NEVER invent routes, guide ids, or anchors. Only use paths from the user's screen list / knowledge above, ids from the walkthrough list, and the documented anchors. If a feature isn't available for this organization or user, say so.
- Don't start a guide the user didn't ask about, and don't call the same tool twice in one turn.
- Keep every reply short and friendly. No markdown headers or long lists.
- If the question is unrelated to using AIMS (general chit-chat, maths, world facts), politely say you can only help with using AIMS.`;

    const dynamicPart = `The user is CURRENTLY ON: ${context?.currentPath || '(unknown page)'} — they are already looking at this page, so never tell them to open it or add a step that navigates to it.

Screens available to THIS user in THIS organization (module: route):
${moduleLines || '(none provided — answer from general AIMS knowledge, do not navigate)'}

Prebuilt walkthroughs available to this user (start_guide ids):
${guideLines || '(none available)'}`;

    return [
      { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicPart },
    ];
  }

  private buildTools(): Anthropic.Tool[] {
    return [
      {
        name: 'navigate',
        description:
          'Navigate the user to a screen in the portal. Use ONLY paths from the screen list in your instructions.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Route path, e.g. /portal/sales/delivery-orders' },
            label: { type: 'string', description: 'Human name of the screen, e.g. "Delivery Orders"' },
          },
          required: ['path'],
        },
      },
      {
        name: 'start_guide',
        description:
          'Start a prebuilt guided walkthrough. It navigates the user to the right screen and shows popup explanations. Use ONLY ids from the walkthrough list.',
        input_schema: {
          type: 'object',
          properties: {
            guideId: { type: 'string', description: 'Guide id from the walkthrough list' },
          },
          required: ['guideId'],
        },
      },
      {
        name: 'show_steps',
        description:
          'Compose and run a custom step-by-step walkthrough when no prebuilt guide matches. Each step can navigate to a route and spotlight one of the documented anchors; steps without an anchor show as a centered explanation card. Use 2-6 steps.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short walkthrough title, e.g. "Invite a user"' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  route: { type: 'string', description: 'Optional /portal… route to navigate to for this step' },
                  anchor: {
                    type: 'string',
                    description:
                      'Optional anchor token from the documented list, e.g. nav-CUSTOMERS, nav-SALES-invoices, page-create-button, editor-confirm',
                  },
                  title: { type: 'string' },
                  body: { type: 'string', description: '1-3 sentences telling the user what to do here' },
                  advanceOnClick: {
                    type: 'boolean',
                    description: 'true when the user should CLICK the highlighted element to continue (e.g. a create button)',
                  },
                },
                required: ['title', 'body'],
              },
            },
          },
          required: ['title', 'steps'],
        },
      },
    ];
  }

  // Validate tool inputs against the request context so the model can't send
  // the UI somewhere that doesn't exist.
  private toAction(name: string, input: any, context: GuideChatContext | undefined): GuideAction | null {
    if (name === 'navigate') {
      const path = String(input?.path || '');
      if (!path.startsWith('/portal')) return null;
      return { type: 'navigate', path, label: input?.label };
    }
    if (name === 'start_guide') {
      const guideId = String(input?.guideId || '');
      const known = (context?.guides || []).some((g) => g.id === guideId);
      if (!known) return null;
      return { type: 'start_guide', guideId };
    }
    if (name === 'show_steps') {
      const title = String(input?.title || '').slice(0, 80);
      const rawSteps = Array.isArray(input?.steps) ? input.steps.slice(0, 8) : [];
      const steps = rawSteps
        .map((s: any) => {
          const route = typeof s?.route === 'string' && s.route.startsWith('/portal') ? s.route : undefined;
          const anchor =
            typeof s?.anchor === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.anchor) ? s.anchor : undefined;
          const stepTitle = String(s?.title || '').slice(0, 120);
          const body = String(s?.body || '').slice(0, 600);
          if (!stepTitle || !body) return null;
          return { route, anchor, title: stepTitle, body, advanceOnClick: s?.advanceOnClick === true };
        })
        .filter(Boolean) as Array<{ route?: string; anchor?: string; title: string; body: string; advanceOnClick?: boolean }>;
      if (!title || steps.length === 0) return null;
      return { type: 'custom_guide', guide: { title, steps } };
    }
    return null;
  }
}
