/**
 * All copy + links for the landing page live here so marketing edits never
 * touch a component. Links resolve from env at build time (see .env.example).
 */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.ai-ms.io").replace(/\/$/, "");
export const SIGN_IN_URL = `${APP_URL}/sign-in`;
export const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || "#book-a-demo";
export const WHATSAPP_URL = process.env.NEXT_PUBLIC_WHATSAPP_URL || "";

export const NAV_LINKS = [
  { label: "Modules", href: "/#modules" },
  { label: "WhatsApp agent", href: "/agent" },
  { label: "How it works", href: "/agent#how" },
  { label: "Pricing", href: "/pricing" },
];

export const HERO = {
  eyebrow: "AI operations platform for SMEs",
  title: "Run your whole business from one chat.",
  body:
    "Inventory, HR, CRM, accounting and claims in one system — and an agent on WhatsApp or Telegram that does the work when you ask. Quotations, stock checks, leave approvals, expense claims, aged receivables: type it, confirm it, done.",
  proofs: ["Double-entry ledger built in", "GST-ready, Singapore first", "Imports your Xero history"],
};

/** Sample conversation rendered in the hero phone. */
export type ChatTurn =
  | { from: "you"; text: string; time: string }
  | { from: "aims"; html: string; time: string; quote?: boolean };

export const CHAT: ChatTurn[] = [
  { from: "you", text: "create a quotation for Beta Industries, 2 fan coil units and 8 hours install", time: "09:41" },
  { from: "aims", html: "Draft quotation ready for <strong>Beta Industries Pte Ltd</strong>:", time: "09:41", quote: true },
  { from: "you", text: "how much does Beta owe us?", time: "09:42" },
  {
    from: "aims",
    html: "Beta Industries has <strong>2 open invoices — S$4,820.00</strong>. INV-0231 (S$3,200) is 12 days overdue. Want me to send a reminder?",
    time: "09:42",
  },
  { from: "you", text: "yes, and check stock for FXAQ25", time: "09:42" },
  {
    from: "aims",
    html: "Reminder sent to accounts@beta.com.sg. <strong>FXAQ25: 14 in stock</strong> (Woodlands 9, Tuas 5), 6 reserved on open DOs.",
    time: "09:43",
  },
];

export const QUOTE_LINES = [
  { label: "2 × Fan Coil Unit FXAQ25", amount: "1,760.00" },
  { label: "8 hr Installation", amount: "640.00" },
];
export const QUOTE_TOTAL = { label: "Total incl. 9% GST", amount: "S$2,616.00" };
export const QUOTE_FILE = "QT-2026-0148.pdf";

/**
 * Client logos for the proof strip. Leave empty and the strip is not rendered —
 * never ship placeholder logos. Files go in /public/clients/.
 */
export const CLIENT_LOGOS: { src: string; alt: string }[] = [];

export type ModuleKey = "inventory" | "hr" | "crm" | "accounting" | "claims";
export type ModuleBadge = "early-access" | "roadmap";
export const MODULES: {
  key: ModuleKey;
  name: string;
  /** one-line hero claim shown above the body */
  hero: string;
  body: string;
  prompts: string[];
  /** grid span at desktop width (6-col grid) */
  span: 2 | 3;
  dark?: boolean;
  badge?: ModuleBadge;
  /** key into SCREENS for the card's thumbnail */
  screen?: string;
}[] = [
  {
    key: "inventory",
    name: "Inventory",
    hero: "Tap the NFC sticker, photograph the nameplate — the unit exists.",
    body: "Serial-tracked or quantity-tracked products, purchases and adjustments, a stock card per item, and a field app that creates units from a tag tap and an AI-read serial — with a three-layer duplicate guard.",
    screen: "field-scan",
    prompts: ["“check stock for FXAQ25”", "“raise a PO to Daikin for 20 units”", "“what did we deliver to Tuas this week?”"],
    span: 2,
  },
  {
    key: "hr",
    name: "HR",
    hero: "Leave, attendance and payroll, approved in the chat.",
    body: "Staff records built on the same roles and permissions that gate every other module. Leave requests and approvals move through the agent, not a queue of emails.",
    badge: "roadmap",
    prompts: ["“apply 2 days leave next Thu–Fri”", "“who’s on leave this week?”", "“prepare August payroll”"],
    span: 2,
  },
  {
    key: "crm",
    name: "CRM",
    hero: "Drop a PDF or a photo — get a numbered, branded document.",
    body: "Customers, the full Quotation → Sales Order → Delivery Order → Invoice chain with partial billing, click-to-pay invoices with a PayNow QR, and a WhatsApp assistant that only answers what you trained it on.",
    screen: "doc-upload",
    prompts: ["“quote Beta for 2 FCUs + install”", "“which quotes are unanswered over 7 days?”", "“add Ciel Interior as a customer”"],
    span: 2,
  },
  {
    key: "accounting",
    name: "Accounting",
    hero: "AI does the coding. Your accountant keeps the pen.",
    body: "Documents post balanced journals automatically and wait in a review queue. Bank rec that solves batch payments, a close wizard whose lock is enforced at the write path, six anomaly detectors, GST F5, and 43 reports — reconciled to the cent against Xero.",
    screen: "posting-queue",
    prompts: ["“aged receivables as of today”", "“record S$3,200 from Beta against INV-0231”", "“GST report for Q3”"],
    span: 3,
    dark: true,
  },
  {
    key: "claims",
    name: "Claims",
    hero: "Snap the receipt. It's filed, coded and waiting for approval.",
    body: "The same extraction that reads supplier bills reads staff receipts: amount, GST and vendor, tagged to a project or cost centre, coded with the account your accountant taught it, and posted to the ledger on approval.",
    badge: "early-access",
    prompts: ["[receipt photo] “claim this under Tuas project”", "“approve all claims under S$50”", "“how much has Ravi claimed this month?”"],
    span: 3,
  },
];

export const AGENT = {
  eyebrow: "The agent",
  title: "Not a chatbot that answers questions. A colleague that does the work.",
  body: "The AIMS agent has the same permissions as the person messaging it. It looks things up freely, drafts anything, and only commits — send, post, pay, delete — after you tap Confirm.",
  steps: [
    {
      n: "01",
      title: "Ask in plain language",
      body: "WhatsApp or Telegram, from the phone you already have. No app to open, no forms to find. It knows your customers, items, prices and staff.",
    },
    {
      n: "02",
      title: "It drafts and shows you",
      body: "A quotation PDF, a leave request, a claim, a payment allocation — rendered with your own document template so you see exactly what will go out.",
    },
    {
      n: "03",
      title: "You confirm, AIMS executes",
      body: "One tap. The document is numbered, sent, and — for invoices, bills and claims — posted to the general ledger. Every action is in the audit trail with your name on it.",
    },
  ],
  guarantees: [
    { icon: "lock", text: "Role-based permissions per staff" },
    { icon: "check", text: "Confirm before anything commits" },
    { icon: "clock", text: "Full action log, per user, per document" },
    { icon: "layers", text: "One bot, every company you run" },
  ] as { icon: "lock" | "check" | "clock" | "layers"; text: string }[],
};

export const PLATFORM = {
  eyebrow: "The platform underneath",
  title: "The chat is the front door. The system behind it is complete.",
  items: [
    { title: "Branded documents", body: "Quotation, SO, DO, invoice, credit/debit note, PO — your templates, your numbering formats." },
    { title: "Field app", body: "Android app for technicians: NFC asset scans, deliveries with signature and location, offline-tolerant." },
    { title: "Email & API ingestion", body: "Forward supplier bills to your AIMS address; connect your own apps through the REST API." },
    { title: "Projects & deployments", body: "Rentals, sales and service jobs with assigned assets and recurring invoicing anchored to each deployment." },
    { title: "Multi-company, multi-currency", body: "Run several entities from one login; foreign invoices convert to base with realised FX handled for you." },
    { title: "Xero migration", body: "Bring in contacts, invoices, bills and the full journal history; we reconcile the trial balance before you switch." },
  ],
};

export const CTA = {
  eyebrow: "Get started",
  title: "Pick the modules you need. Talk to the agent tomorrow.",
  body: "Priced per company, per module. Setup and Xero migration handled by our team.",
};

export const FOOTER = {
  blurb: "AI operations for small and medium businesses. By Osiris Technology Pte. Ltd., Singapore.",
  columns: [
    { title: "Modules", links: MODULES.map((m) => ({ label: m.name, href: `/modules/${m.key}` })) },
    {
      title: "Product",
      links: [
        { label: "WhatsApp agent", href: "/agent" },
        { label: "How it works", href: "/agent#how" },
        { label: "Pricing", href: "/pricing" },
        { label: "Sign in", href: SIGN_IN_URL },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "Book a demo", href: DEMO_URL },
      ],
    },
  ],
  legal: `© ${new Date().getFullYear()} Osiris Technology Pte. Ltd.`,
  site: "ai-ms.io",
};

export const BADGE_LABEL: Record<ModuleBadge, string> = {
  "early-access": "Early access",
  roadmap: "Roadmap",
};

/**
 * Product screenshots. Files live in /public/screens/<key>.png (desktop 1440-wide
 * captures) or .../<key>.png at phone width for kind "phone". A missing file
 * renders as a labelled placeholder tile, never a broken image.
 */
export type Screen = { file: string; alt: string; kind: "desktop" | "phone"; caption?: string };
export const SCREENS: Record<string, Screen> = {
  "field-scan": { file: "field-scan.png", alt: "AIMS Field app: tap an asset tag", kind: "phone", caption: "Tap an asset tag" },
  "field-photos": { file: "field-photos.png", alt: "Guided 4-angle condition photo capture", kind: "phone", caption: "Guided 4-angle condition photos" },
  "field-route": { file: "field-route.png", alt: "Completed delivery run with condition photos, customer signature and linked Delivery Order", kind: "desktop", caption: "Proof of delivery in the office: condition photos, signature, linked DO" },
  "guest-delivery": { file: "guest-delivery.png", alt: "Zero-login delivery link for a driver", kind: "phone", caption: "Zero-login driver link" },
  "doc-upload": { file: "doc-upload.png", alt: "Upload a PDF and AIMS extracts the document", kind: "desktop", caption: "PDF in, numbered document out" },
  "invoices-list": { file: "invoices-list.png", alt: "Invoice list with statuses and totals", kind: "desktop", caption: "Every invoice, its status and its balance" },
  "invoice-preview": { file: "invoice-preview.png", alt: "Branded tax invoice preview", kind: "desktop", caption: "Your template, your numbering" },
  "pay-page": { file: "pay-page.png", alt: "Click-to-pay invoice page with PayNow QR", kind: "phone", caption: "Click-to-pay with PayNow QR" },
  "posting-queue": { file: "posting-queue.png", alt: "Posting review queue with AI journal preview", kind: "desktop", caption: "Posting review queue" },
  "bank-rec": { file: "bank-rec.png", alt: "Bank reconciliation with suggested batch matches", kind: "desktop", caption: "Bank rec that solves batch payments" },
  "ask-ai": { file: "ask-ai.png", alt: "Ask the books: who owes me the most money?", kind: "phone", caption: "Ask the books a question" },
  "close-wizard": { file: "close-wizard.png", alt: "Smart close wizard preflight checklist", kind: "desktop", caption: "Close wizard with an enforced lock" },
  "finance-hub": { file: "finance-hub.png", alt: "Finance hub with KPIs and anomaly action queue", kind: "desktop", caption: "Finance hub with anomaly detection" },
  "reports": { file: "reports.png", alt: "Report library with favourites", kind: "desktop", caption: "43 reports, starrable, exportable" },
};

export const FIELD_BAND = {
  eyebrow: "In the field",
  title: "Proof that comes back from the van by itself.",
  body: "The AIMS Field app on an Android handheld: tap the NFC sticker, let AI read the nameplate, walk the four-angle photo set, take one signature at the end — and the Delivery Order and a priced draft invoice are already in the office.",
  points: [
    "NFC tap identifies the unit; AI reads model + serial off the label",
    "Front · Left · Back · Right photos, enforced on the phone and the server; before/after side-by-side on return",
    "Background GPS from Start to Acknowledge, drawn as a route in the portal",
    "Subcontracted driver? Send a link — no app, no login, self-expiring",
  ],
  screens: ["field-scan", "field-photos", "guest-delivery"],
  wide: "field-route",
};

export const ACCOUNTANT_BAND = {
  eyebrow: "Built for the accountant",
  title: "Nothing reaches the ledger without a human clicking Post.",
  body: "The controls an accountant would ask for, on by default. Plus bank rec that solves batch payments: one transfer settling four invoices is matched by subset-sum, guarded by the counterparty’s name in the narrative — and still surfaced as a suggestion for you to confirm.",
  tiles: [
    { screen: "posting-queue", title: "One review queue", body: "Invoices, bills, credit and debit notes, receipts and journal vouchers, each with an AI Dr/Cr preview you can override. Batch-post; never double-posts." },
    { screen: "ask-ai", title: "Ask the books — and hand it a PDF", body: "“Who owes me the most?” answered from the ledger with tables and drill-links. Attach a supplier or bank statement and it reconciles it against your books. It never invents a figure." },
    { screen: "close-wizard", title: "A close that locks the door", body: "Preflight checks with fix-it links, retained-earnings rollover and depreciation posted for you, then a period lock enforced at the write path." },
    { screen: "finance-hub", title: "Six detectors on the dashboard", body: "Possible duplicate invoices, invoices posted without GST, amounts 3× an account’s norm, stale drafts, rentals still billed in full after a partial return." },
  ],
  parity: {
    title: "Reconciled to the cent against Xero",
    body: "Import your Xero history, then run the reconciler: every GL account, plus total AR and AP, diffed against Xero’s live API at a one-cent tolerance and cross-checked against your own control accounts. Zero drift or the run fails.",
    sample: [
      "$ reconcile-xero --asof 2026-08-31 --tol 0.01",
      "GL / trial balance  169 accounts   drift 0.00   OK",
      "Accounts receivable                 drift 0.00   OK",
      "Accounts payable                    drift 0.00   OK",
      "AR vs debtor control (GL)           drift 0.00   OK",
      "exit 0",
    ],
  },
};
