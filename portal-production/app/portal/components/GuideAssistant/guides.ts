// Guided-walkthrough registry for the AIMS Guide assistant.
//
// Each guide is a sequence of tour steps. A step may navigate to a route and
// anchor a popup on a DOM element found via `selector` (we stamp stable
// `data-tour` attributes on key elements: sidebar items are
// `nav-<MODULECODE>` / `nav-<MODULECODE>-<submenuKey>`, and every PageTable
// create button is `page-create-button`). Steps without a selector — or whose
// element can't be found — render as a centered explanation card instead, so
// guides degrade gracefully when a screen changes.
//
// The id/title/description of every guide is sent to the backend assistant as
// its catalog, so write descriptions the way a user would ask the question.

export interface TourStep {
  /** Navigate here before showing the step (skipped if already there). */
  route?: string;
  /** CSS selector to spotlight; omit for a centered explanation card. */
  selector?: string;
  title: string;
  body: string;
  /**
   * 'click' — the step completes when the user clicks the highlighted element
   * (the real action), letting the tour continue into the resulting screen.
   */
  advanceOn?: "click";
  /**
   * Wait indefinitely for the selector (small "waiting" pill instead of the
   * 5s give-up). Use for steps that follow a click-through, where pickers or
   * a page load sit between the click and the element appearing.
   */
  patient?: boolean;
}

export interface Guide {
  id: string;
  title: string;
  /** What questions this answers — used by the AI to pick the right guide. */
  description: string;
  /** The screen the guide lands on (shown to the AI). */
  route: string;
  /** Module code this guide depends on — omitted = always available. */
  module?: string;
  steps: TourStep[];
}

// Modules guru marked as legacy (2026-07-27): the assistant must never guide
// users into these — they're filtered out of the context sent to the AI and
// out of the guide catalog. Keep in sync with LEGACY_MODULES in
// api-server-production/src/guide/guide.service.ts.
export const LEGACY_MODULES = new Set<string>([
  'DOCUMENTS',
  'INVOICES',
  'PAYMENTS',
  'ASSETS',
  'USER_MANAGEMENT',
  'AUDIT',
  'ANALYTICS',
  'INTEGRATIONS',
]);

const documentGuide = (opts: {
  id: string;
  label: string; // "Delivery Order"
  plural: string; // "Delivery Orders"
  submenuKey: string; // "delivery-orders"
  description: string;
  extraFinalNote?: string;
}): Guide => {
  const route = `/portal/sales/${opts.submenuKey}`;
  return {
    id: opts.id,
    title: `Create a ${opts.label}`,
    // The clarifier keeps the AI from matching "upload/import an existing
    // file" questions to this manual-creation guide (see uploadDocumentGuide).
    description: `${opts.description} For making one manually from scratch — NOT for uploading an existing file.`,
    route,
    module: 'SALES',
    steps: [
      {
        route,
        selector: `[data-tour="nav-SALES-${opts.submenuKey}"]`,
        title: `${opts.plural} live under Sales`,
        body: `In the sidebar, open Sales and pick "${opts.label}". I've brought you here — this list shows every ${opts.label.toLowerCase()} with its status.`,
      },
      {
        route,
        selector: '[data-tour="page-create-button"]',
        title: `Start a new ${opts.label.toLowerCase()}`,
        body: `Click this button to open a blank ${opts.label.toLowerCase()}. If a numbering or template picker appears, just pick one and continue — I'll follow you into the editor.`,
        advanceOn: 'click',
      },
      // From here the tour runs inside the editor (dynamic URL — no route).
      {
        selector: '[data-tour="editor-customer"]',
        patient: true,
        title: 'Choose the customer',
        body: 'Type the customer code here, or click the search icon to pick from your customer list. Their name and details fill in automatically.',
      },
      {
        selector: '[data-tour="editor-add-item"]',
        patient: true,
        title: 'Add your line items',
        body: 'Click Add Item for each line: pick the product or type a description, then set quantity and price. Totals update as you go — press Save (top right) to keep it as a draft.',
      },
      {
        selector: '[data-tour="editor-confirm"]',
        title: `Confirm the ${opts.label.toLowerCase()}`,
        body: `When everything looks right, press this — it finalises the document and assigns its number.${opts.extraFinalNote ? ` ${opts.extraFinalNote}` : ''}`,
      },
    ],
  };
};

// Upload an EXISTING document file (PDF/image/ZIP) into a Sales list — the
// counterpart to documentGuide's manual creation.
const uploadDocumentGuide = (opts: { id: string; label: string; plural: string; submenuKey: string }): Guide => {
  const route = `/portal/sales/${opts.submenuKey}`;
  const article = /^[aeiou]/i.test(opts.label) ? 'an' : 'a';
  return {
    id: opts.id,
    title: `Upload ${article} ${opts.label}`,
    description: `How to upload or import an existing ${opts.label.toLowerCase()} file (PDF, image, or a ZIP of several) so AIMS extracts it into a draft — when the user already HAS the document as a file.`,
    route,
    module: 'SALES',
    steps: [
      {
        route,
        selector: '[data-tour="document-upload"]',
        title: `Upload ${opts.plural.toLowerCase()} you already have`,
        body: `Click Upload ${opts.label} and pick the file — a PDF or photo, or a ZIP with several. Each file is read by AI and turned into a draft ${opts.label.toLowerCase()}.`,
        advanceOn: 'click',
      },
      {
        title: 'Review and save',
        body: `Check the extracted details (customer, dates, line items), correct anything, and save. The draft then behaves like any other ${opts.label.toLowerCase()} — confirm it when it's final.`,
      },
    ],
  };
};

export const GUIDES: Guide[] = [
  documentGuide({
    id: 'create-delivery-order',
    label: 'Delivery Order',
    plural: 'Delivery Orders',
    submenuKey: 'delivery-orders',
    description:
      'How to create a delivery order (DO): where the Delivery Orders screen is, how to start a new one, fill in customer and items, and confirm it.',
    extraFinalNote: 'You can also create a DO directly from a confirmed quotation so the items carry over.',
  }),
  documentGuide({
    id: 'create-invoice',
    label: 'Invoice',
    plural: 'Invoices',
    submenuKey: 'invoices',
    description:
      'How to create a sales invoice: where the Invoices screen is, starting a new invoice, adding customer and line items, and confirming it so it posts.',
    extraFinalNote: 'Confirming an invoice also posts it to the ledger.',
  }),
  documentGuide({
    id: 'create-quotation',
    label: 'Quotation',
    plural: 'Quotations',
    submenuKey: 'quotations',
    description:
      'How to create a quotation (quote) for a customer: where Quotations live, starting a new one, adding items and prices, and confirming/sending it.',
    extraFinalNote: 'Once accepted, you can turn a quotation into a delivery order or invoice.',
  }),
  documentGuide({
    id: 'create-credit-note',
    label: 'Credit Note',
    plural: 'Credit Notes',
    submenuKey: 'credit-notes',
    description:
      'How to issue a credit note against a customer or invoice: where Credit Notes live and how to create and confirm one.',
  }),
  {
    id: 'use-aimee',
    title: 'Meet AIMEE',
    description:
      'How to use AIMEE, the assistant on top of the dashboard: press her face or type into Ask AIMEE to open her, ask for a quotation or invoice, open a screen, run a report, confirm an action, or go back to the dashboard. NOT for the help bubble.',
    route: '/portal',
    steps: [
      {
        route: '/portal',
        selector: '[data-tour="aimee-face"]',
        title: 'This is AIMEE',
        body: 'She lives on top of your dashboard. Press her face to open her, or type straight into the box next to her.',
      },
      {
        selector: '[data-tour="aimee-ask"]',
        title: 'Just say what you need',
        body: 'Type a request like "create a quotation for Acme, 2 fan coil units" or "which invoices are overdue?" and press Enter. AIMEE opens and gets going.',
      },
      {
        selector: '[data-tour="home-view-toggle"]',
        title: 'She is in the top bar too',
        body: 'From any page, press her face here to open AIMEE. While she is open, the same face takes you back.',
      },
      {
        title: 'Nothing final without you',
        body: 'Documents AIMEE drafts open on the right as a live preview. Confirming, posting, paying or emailing always shows a Confirm / Cancel card first.',
      },
    ],
  },
  {
    id: 'create-trade-order',
    title: 'Start an order (Shipments)',
    module: 'SHIPMENTS',
    description:
      'How to create a new order ("#19") in Shipments — from scratch with the New Order form or from an existing PI file (Fill from PI) — pick the contract so the premiums default, then add its shipments (#19-1) on the order page. NOT for uploading shipping documents to an existing shipment.',
    route: '/portal/shipments',
    steps: [
      {
        route: '/portal/shipments',
        selector: '[data-tour="shipments-tab-pending"]',
        title: 'Orders',
        body: 'Each row is an order (#19): customer, contract, ship → delivery month, product and quantity. The arrow next to #19 lists its shipments.',
      },
      {
        title: '+ New order',
        body: 'Click "+ New order" (top-right). Drop the PI on "Fill from PI" to fill the form from an existing PI file, or type it in. Pick the contract: the premiums come from its line and stay editable.',
      },
      {
        selector: '[data-tour="order-add-shipment"]',
        title: 'Add shipments',
        body: 'On the order page, "Add shipment" adds #19-1, #19-2 … — the B/L details go on each shipment\'s step 3a. The order\'s own steps (0, 1, 2 and 11, 13) sit above and below the shipments.',
        patient: true,
      },
    ],
  },
  {
    id: 'trade-email-inbox',
    title: 'Answer the email questions (Dashboard)',
    module: 'SHIPMENTS',
    description:
      'How the emails work now: AIMS files what it is sure about by itself (two independent clues must agree). Everything else becomes a QUESTION CARD on the Dashboard, under "Emails waiting for you": every question is its own numbered card (1, 2, 3; five shown, then "Show N more") with the question, the full subject, "Vedanta · 22 Oct 14:31", a one-line summary of the email, and two buttons: "Answer" (tick one or several shipments in a pop-up, then Confirm; nothing is applied before Confirm) and "Show full email" (the thread pop-up, the email first). The answer covers the whole thread, with Undo. "See all emails" opens the two-tab view (Unprocessed / Processed) with the thread timeline and the result of every email.',
    route: '/portal',
    steps: [
      {
        route: '/portal',
        selector: '[data-tour="question-card"]',
        title: 'One numbered card per question',
        body: 'The badge is its place in the list. The title is the question; under it the subject in full (two lines, hover for the rest), the company and time of the latest email, and a one-line summary of what the email says or asks. "Show full email" opens the thread pop-up with the email first and the earlier emails under it.',
        patient: true,
      },
      {
        selector: '[data-tour="question-choose"]',
        title: 'Answer, then Confirm',
        body: 'Opens a pop-up: search, then tick one or several shipments, AIMS\'s likely ones first ("Select all"), then every open shipment. Under the list: "Not about a shipment", "New deal → Create order" (new-deal cards), "Ask later". Nothing happens until you press Confirm; the result shows with Undo and the card leaves the list.',
        patient: true,
      },
      {
        selector: '[data-tour="dashboard-see-all-emails"]',
        title: 'See all emails',
        body: 'The full view: Unprocessed (the same numbered cards, all of them) and Processed, one card per thread with the result in plain words ("✅ Added to #16-2 …"), Undo, and the numbered timeline when you open it.',
      },
    ],
  },
  {
    id: 'trade-monthly-order',
    title: 'Make the month\'s orders (Shipments)',
    module: 'SHIPMENTS',
    description:
      'How to create the month\'s orders from scratch with "+ New monthly order" on Shipments → Orders: pick the ship month, then one row per customer × contract × grade × size × quantity — saving makes one order per row (delivery = +2 months, premiums from the contract). The Orders list is a flat list (newest ship month first) with a Ship month filter. A Vedanta PI-table email in the Inbox then fills the PI no. / amount on those orders. NOT for a single order (use New Order).',
    route: '/portal/shipments',
    steps: [
      {
        route: '/portal/shipments',
        selector: '[data-tour="orders-monthly"]',
        title: '+ New monthly order',
        body: 'Pick the ship month, then a row per customer + contract + grade + size + quantity (SUS 6063 300 t, SUS 6005 120 t, Kato 6063 40 t…). Premiums come from the contract for that month unless typed.',
      },
      {
        selector: '[data-tour="orders-progress-bar"]',
        title: 'Progress per order',
        body: 'One segment per step that applies (N/A steps hidden): green done, orange in progress, red overdue, grey not started — with the current step and "9/14". Hover an order with several shipments to see each one\'s bar. Filter by Ship month from the filter button.',
        patient: true,
      },
    ],
  },
  {
    id: 'trade-shipments-list',
    title: 'See every shipment (Shipments)',
    module: 'SHIPMENTS',
    description:
      'Shipments → Shipments lists every B/L across all orders, tabbed In transit / Arrived / Delivered / Completed, with vessel, carrier, net MT, ETD / latest ETA, the current step and the port free-time countdown (DET / DEM). Search by B/L, order no. (#19 / 19-1) or vessel; a row opens that shipment on its order.',
    route: '/portal/shipments/shipments',
    steps: [
      {
        route: '/portal/shipments/shipments',
        selector: '[data-tour="shipments-list-tabs"]',
        title: 'Four tabs',
        body: 'In transit (ETA ahead), Arrived (arrived / discharged, or the ETA has passed), Delivered (cleared — import permit done) and Completed.',
      },
      {
        selector: '[data-tour="shipments-list"]',
        title: 'Free time',
        body: 'DET / DEM days left at the port (from discharge, else the ETA) — amber on the last day, red when over. Click a row to open its steps.',
        patient: true,
      },
    ],
  },
  {
    id: 'trade-step-payment',
    title: 'Record a payment on a step (Shipments)',
    module: 'SHIPMENTS',
    description:
      'How to record money paid or received: it is kept on the step itself — step 1 (PI deposit), 6 (CI), 8 (import tax), 12 (transport & storage) and the invoice receipts on steps 2 and 11. Enter amount, date, account and pick the proof file uploaded on that step. Home\'s cash in / out and the reconciliation (step 13) add these up. There is no separate Payments page any more.',
    route: '/portal/shipments',
    steps: [
      {
        selector: '[data-tour="step-payment"]',
        title: 'Record payment',
        body: 'Open the step (1, 6, 8, 12 — or 2 / 11 for a customer\'s payment), upload the proof on it, then "Record payment": amount, date, account and the proof.',
        patient: true,
      },
    ],
  },
  {
    id: 'trade-intake-keep-domains',
    title: 'Keep counterparty emails out of the purge (Shipments)',
    module: 'SHIPMENTS',
    description:
      'Settings → Shipping → "Email intake — never purge mail from": the domains (Vedanta, SUS, Kato, Mitsui Soko, carriers) whose mail is never deleted automatically — when the AI calls it "not shipment" it goes to Inbox › Unsure for 14 days instead. Edit the list (one domain per line); customers\' email domains are always included.',
    route: '/portal/settings/shipping',
    steps: [
      {
        route: '/portal/settings/shipping',
        selector: '[data-tour="settings-intake-keep-domains"]',
        title: 'Never purge mail from',
        body: 'One domain per line. Mail from, to or quoting these domains (and replies on their threads) is kept for a person to look at — never purged by the AI. Save the document settings below.',
        patient: true,
      },
    ],
  },
  {
    id: 'trade-email-filter',
    title: 'Choose which senders the email intake keeps (Shipments)',
    module: 'SHIPMENTS',
    description:
      'Settings → Shipping → "Email filter": Off / Trial run / Enforce plus the allowed sender domains and addresses (and notes). In the trial run every email is still kept and Shipments › Inbox › "Filter preview" shows what would be dropped (from-domain + subject only), with "false drop" on shipment mail — add those senders before switching to Enforce. A shipment key in the subject / an attachment name and replies on a matched thread are always kept. This is a setting, not an upload.',
    route: '/portal/settings/shipping',
    steps: [
      {
        route: '/portal/settings/shipping',
        selector: '[data-tour="settings-email-filter"]',
        title: 'Email filter',
        body: 'Trial run first: nothing is dropped, the filter only records what it would do. Enforce drops failing mail before it is stored.',
      },
      {
        selector: '[data-tour="settings-email-filter-domains"]',
        title: 'Allowed domains',
        body: 'One domain per line (vedanta.co.in, mitsui-soko.co.jp…). For someone writing from gmail.com add their address on the right, never the whole domain. Save.',
      },
      {
        route: '/portal?view=emails',
        selector: '[data-tour="inbox-filter-preview"]',
        title: 'Filter preview',
        body: 'What the filter kept / would drop in the last 30 days. Rows marked "false drop" are shipment mail it would lose — fix the allow-list before enforcing.',
        patient: true,
      },
    ],
  },
  {
    id: 'trade-find-document',
    title: 'Find a document (Shipments)',
    module: 'SHIPMENTS',
    description:
      'Documents (top-level menu) lists every document across all orders — uploads, in-app invoices and generated documents. Tabs by category with counts (All / Supplier / Customer / Invoices / Customs & logistics / Payments / Other), a search by doc ID, doc no., file name, B/L or order no. (#27-1), and an Order / shipment link per row. Finding and opening existing documents — to upload a new one use "Upload document".',
    route: '/portal/trade-documents',
    steps: [
      {
        route: '/portal/trade-documents',
        selector: '[data-tour="hub-tabs"]',
        title: 'Tabs',
        body: 'Pick a category; the count is how many documents match. Empty categories are hidden.',
      },
      {
        selector: '[data-tour="hub-order-link"]',
        title: 'Order / shipment',
        body: 'Click #27-1 to open that shipment on its order. Click anywhere else on the row to preview the document.',
        patient: true,
      },
    ],
  },
  {
    id: 'trade-credit-note',
    title: 'Use a credit note on the next invoice (Shipments)',
    module: 'SHIPMENTS',
    description:
      'How a negative Invoice #2 becomes a credit note / open credit for the customer, and how to apply that open credit on a later Invoice #1 (adds a 前回差額充当 line). Also: issue Invoice #2 on estimated costs and the adjustment at step 13.',
    route: '/portal/trade-documents',
    steps: [
      {
        selector: '[data-tour="credit-note-chip"]',
        title: 'Credit note',
        body: 'An Invoice #2 whose total is negative is a credit note. Finalizing it books an open credit for that customer.',
        patient: true,
      },
      {
        selector: '[data-tour="apply-open-credit"]',
        title: 'Apply open credit',
        body: 'On the customer\'s next Invoice #1, "Apply open credit" adds a 前回差額充当 line (no tax) that uses the credit up.',
        patient: true,
      },
      {
        selector: '[data-tour="cost-variance"]',
        title: 'Estimated costs',
        body: 'Invoice #2 issued on estimated costs is compared with the actual costs at step 13 — "Issue adjustment" makes the adjustment invoice or credit note.',
        patient: true,
      },
    ],
  },
  {
    id: 'trade-home-alerts',
    title: 'The Sales dashboard: emails to confirm, tasks, arrivals',
    module: 'SHIPMENTS',
    description:
      'Sales › Dashboard (the landing page): one line "To do: n emails to confirm · n tasks overdue · n arriving this week", then the emails waiting for you (Confirm · Change order · Not shipment), what was filed automatically in the last 3 days (Undo), the reminders (✓ done / ✕ dismiss — also in the bell and the Orders "Tasks (n)" button) and the shipments arriving in the next 7 days with their free time. Reminder rules are in Settings → Shipping → Alerts.',
    route: '/portal',
    steps: [
      {
        route: '/portal',
        selector: '[data-tour="dashboard-todo"]',
        title: 'What needs you today',
        body: 'Emails to confirm, tasks overdue and shipments arriving this week, in one line.',
      },
      {
        selector: '[data-tour="dashboard-emails"]',
        title: 'Emails to confirm',
        body: 'Each thread shows the shipment it will be linked to and what Confirm does ("files COA.pdf to step 3b"). Confirm, "Change order" to pick another shipment, or "Not shipment". "See all in Inbox" opens the full list.',
        patient: true,
      },
      {
        selector: '[data-tour="dashboard-filed"]',
        title: 'Filed automatically',
        body: 'What the intake filed by itself in the last 3 days (its own B/L / PI / CI in the subject, or a link-only reply on a confirmed thread). Undo takes it back.',
        patient: true,
      },
      {
        selector: '[data-tour="my-tasks"]',
        title: 'Tasks',
        body: '✓ marks a reminder done; ✕ dismisses it until its date moves. Overdue ones come first. The same list is in the bell, top right.',
        patient: true,
      },
    ],
  },
  {
    id: 'design-document-template',
    title: 'Change how documents look',
    description:
      'How to change the look of quotations, invoices, credit notes and debit notes for an organization: accent colour, font, logo position, title, which blocks print (due date, bank details, amount in words), footer line. Admin Panel → organization → Document Types → Manage Templates → Design. NOT for editing the fields of a template.',
    route: '/portal/admin/organizations',
    steps: [
      {
        selector: '[data-tour="manage-templates"]',
        title: 'Open the templates for a document type',
        body: 'In the organization\'s Document Types tab, click Manage Templates on the row you want (Invoice, Quotation, Credit Note).',
      },
      {
        selector: '[data-tour="template-design"]',
        title: 'Design',
        body: 'Each template card has a Design button. Shared templates say which organization made them; a design change shows for every organization that uses the template.',
      },
      {
        selector: '[data-tour="template-design-knobs"]',
        title: 'Pick the look',
        body: 'Accent colour, font, logo position, company block alignment, the title, which blocks print, a shaded table header and a footer line. The sample on the right re-renders as you change things and is exactly what prints.',
      },
      {
        selector: '[data-tour="template-design-save"]',
        title: 'Save',
        body: 'Save design applies it to the editor preview, the PDF in the chat side panel, emailed PDFs and the pay page. Reset to standard look puts everything back.',
      },
    ],
  },
  {
    id: 'add-customer',
    title: 'Add a Customer',
    description:
      'How to add or register a new customer (client): customers live in Master Files; how to create a customer record with contact details.',
    route: '/portal/customers',
    steps: [
      {
        route: '/portal/customers',
        title: 'Customers live in Master Files',
        body: "Customers are managed under Organization Settings → Master Files. I've brought you straight to the customer list — every customer you invoice or quote lives here.",
      },
      {
        route: '/portal/customers',
        selector: '[data-tour="page-create-button"]',
        title: 'Create the customer',
        body: 'Click here and fill in the name, contact person, email and billing address. Save, and the customer becomes available in every document editor.',
      },
    ],
  },
  {
    id: 'add-product',
    title: 'Add a Product / Inventory Item',
    description:
      'How to add a new product, stock item, or inventory item: products live in Master Files; how to create one with code, price and stock.',
    route: '/portal/inventory/products',
    module: 'INVENTORY',
    steps: [
      {
        route: '/portal/inventory/products',
        title: 'Products live in Master Files',
        body: "Products are managed under Organization Settings → Master Files. I've brought you to the product list — every item you stock or sell lives here.",
      },
      {
        route: '/portal/inventory/products',
        selector: '[data-tour="page-create-button"]',
        title: 'Create the product',
        body: 'Click here to add the item: give it a name, code/SKU, unit price and (if tracked) opening stock. It then becomes pickable as a line item in quotations, DOs and invoices.',
      },
    ],
  },
  uploadDocumentGuide({ id: 'upload-invoice', label: 'Invoice', plural: 'Invoices', submenuKey: 'invoices' }),
  uploadDocumentGuide({ id: 'upload-delivery-order', label: 'Delivery Order', plural: 'Delivery Orders', submenuKey: 'delivery-orders' }),
  uploadDocumentGuide({ id: 'upload-quotation', label: 'Quotation', plural: 'Quotations', submenuKey: 'quotations' }),
  {
    id: 'email-invoice',
    title: 'Send an Invoice by Email',
    description:
      'How to send or email an invoice (or quotation) to a customer: open the document and use Send Email in the editor toolbar — recipients, subject/body, PDF attached automatically.',
    route: '/portal/sales/invoices',
    module: 'SALES',
    steps: [
      {
        route: '/portal/sales/invoices',
        title: 'Open the invoice',
        body: 'Find the invoice in this list and click it to open the editor. (Quotations can be emailed the same way from the Quotations list.)',
      },
      {
        selector: '[data-tour="editor-send-email"]',
        patient: true,
        advanceOn: 'click',
        title: 'Send Email',
        body: 'Click Send Email — the document saves first, then the email window opens. (The button is hidden while an invoice is awaiting payment.)',
      },
      {
        title: 'Address and send',
        body: "Add recipients as chips (TO prefills from the document's Attention contact when it has name, email and phone; CC/BCC have their own fields), adjust the subject and message, then hit Send. The document's PDF is attached automatically.",
      },
    ],
  },
  {
    id: 'upload-bulk-bills',
    title: 'Upload Bills in Bulk',
    description:
      'How to upload many supplier bills at once (bulk/batch upload): drop multiple PDFs, images, or a ZIP on the Bills screen and review each extracted bill.',
    route: '/portal/accounting/bills',
    module: 'ACCOUNTING',
    steps: [
      {
        route: '/portal/accounting/bills',
        title: 'The Bills screen',
        body: "Supplier bills live here (under Accounting). I've brought you to the list — each bill flows: submit → optional approval → posts to the ledger as a payable.",
      },
      {
        route: '/portal/accounting/bills',
        selector: '[data-tour="bills-upload"]',
        title: 'Upload many at once',
        body: 'Click Upload Bills and select as many PDFs or images as you like — or a single ZIP containing them. Every file is expanded and queued.',
        advanceOn: 'click',
      },
      {
        title: 'Review each extracted bill',
        body: 'After you pick the files, each one is AI-extracted into a bill. Use Prev/Next to step through the queue, correct anything, and save each as its own bill. Unsupported or oversized files are skipped with a note.',
      },
    ],
  },
  {
    id: 'record-payment',
    title: 'Record a Customer Payment (Official Receipt)',
    description:
      'How to record a customer payment / receipt / official receipt (OR) when a customer has paid an invoice: create the receipt, allocate it against the invoice, and save.',
    route: '/portal/accounting/receivables',
    module: 'ACCOUNTING',
    steps: [
      {
        route: '/portal/accounting/receivables',
        selector: '[data-tour="ar-official-receipt"]',
        advanceOn: 'click',
        title: 'Open an Official Receipt',
        body: "Customer payments are recorded as Official Receipts. Click this button — it opens the receipt editor. I'll follow you in.",
      },
      {
        selector: '[data-tour="editor-customer"]',
        patient: true,
        title: 'Pick the customer who paid',
        body: 'Type the customer code, or click the search icon to pick from the list. Their unpaid invoices then appear below in Offset Transactions. Set the receipt Date (and Cheque No. if any) on the rows above.',
      },
      {
        selector: '[data-tour="or-amount"]',
        title: 'Enter the amount received',
        body: 'Key in exactly what the customer paid. The debit account is the bank the money went into; the credit account defaults to Accounts Receivable.',
      },
      {
        selector: '[data-tour="or-offset-grid"]',
        title: 'Allocate it against invoices',
        body: 'Tick the invoice(s) this payment covers — ticking auto-fills the allocation, or type a per-invoice amount for partial payments. The Balance at the bottom right must reach 0.00 (fully allocated).',
      },
      {
        selector: '[data-tour="editor-save"]',
        title: 'Save the receipt',
        body: 'Press Save — it posts the receipt and marks the allocated invoices as paid (partial allocations leave the rest outstanding). Save stays blocked until the balance is exactly 0.00.',
      },
    ],
  },
  {
    id: 'view-financial-reports',
    title: 'View Financial Reports',
    description:
      'Where to find accounting and financial reports: profit & loss, balance sheet, trial balance, GST, general ledger, aged receivables and payables.',
    route: '/portal/accounting/reports',
    module: 'ACCOUNTING',
    steps: [
      {
        route: '/portal/accounting/reports',
        selector: '[data-tour="nav-ACCOUNTING-reports"]',
        title: 'Accounting → Reports',
        body: "All financial reports live under Accounting → Reports — I've brought you here.",
      },
      {
        route: '/portal/accounting/reports',
        title: 'Pick a report',
        body: 'This page hosts the Trial Balance, Profit/Loss & Balance Sheet, GST report, General Ledger, aged receivables/payables and more as tabs. Each report lets you set the date range and drill into the underlying entries.',
      },
    ],
  },
];

/**
 * Compact catalog sent to the backend assistant for guide matching. Pass the
 * set of module codes the current user can access — guides whose module isn't
 * in it are omitted, so the AI never offers a walkthrough the user can't use.
 */
export const guideCatalog = (allowedModules?: Set<string>) =>
  GUIDES.filter((g) => !g.module || !allowedModules || allowedModules.has(g.module)).map(
    ({ id, title, description, route }) => ({ id, title, description, route }),
  );

export const getGuide = (id: string) => GUIDES.find((g) => g.id === id);
