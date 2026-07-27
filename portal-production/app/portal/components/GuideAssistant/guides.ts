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
    title: 'Record a Customer Payment',
    description:
      'How to record a customer payment / receipt against an invoice, or see which invoices are unpaid: Accounts Receivable under Accounting.',
    route: '/portal/accounting/receivables',
    module: 'ACCOUNTING',
    steps: [
      {
        route: '/portal/accounting/receivables',
        selector: '[data-tour="nav-ACCOUNTING-receivables"]',
        title: 'Accounts Receivable',
        body: "Customer payments are handled in Accounting → Accounts Receivable. I've brought you here — this shows your invoices and what's still outstanding.",
      },
      {
        route: '/portal/accounting/receivables',
        title: 'Record the receipt',
        body: 'Find the invoice that was paid, open it, and record the amount received with the payment date. Fully-paid invoices move to Paid; partial payments leave the balance outstanding.',
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
