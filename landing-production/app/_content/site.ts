/**
 * All copy + links for the landing page live here so marketing edits never
 * touch a component. Links resolve from env at build time (see .env.example).
 */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.ai-ms.io").replace(/\/$/, "");
export const SIGN_IN_URL = `${APP_URL}/sign-in`;
export const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || "#book-a-demo";
export const WHATSAPP_URL = process.env.NEXT_PUBLIC_WHATSAPP_URL || "";

export const TAGLINE = "One Intelligent System. More Human Potential.";

export const NAV_LINKS = [
  { label: "The agent", href: "/agent" },
  { label: "Who it is for", href: "/#trades" },
  { label: "Pricing", href: "/pricing" },
];

export const HERO = {
  eyebrow: "Operations software for Singapore SMEs",
  title: ["One WhatsApp message.", "All the paperwork."],
  body: "Your team sends a message. AIMS drafts the documents. Your accountant posts.",
  /** The WhatsApp line that produces every document on the desk. */
  message: { text: "quote Beta for 2 fan coil units and 8 hours install, deliver Thursday", time: "09:41" },
};

/** The flow on the right of the hero: one step per paper and who did it. */
export type DeskStep = { key: "message" | "quotation" | "delivery" | "invoice" | "journal"; label: string; who: string };
export const DESK_STEPS: DeskStep[] = [
  { key: "message", label: "Message", who: "Ravi · Mon 09:41" },
  { key: "quotation", label: "Quotation", who: "AIMS drafted · Ravi confirmed" },
  { key: "delivery", label: "Delivery order", who: "Hafiz · on site Thu 14:22" },
  { key: "invoice", label: "Tax invoice", who: "AIMS drafted · Mei confirmed" },
  { key: "journal", label: "Journal", who: "S. Lim · accountant" },
];

/** The four papers on the desk. Figures tie: 1,760 + 640 = 2,400; GST 216; total 2,616. */
export const DESK = {
  quotation: {
    ref: "QT-2026-0148",
    customer: ["Beta Industries Pte Ltd", "UEN 201512345K · 12 Tuas Ave 3"],
    lines: [
      ["2 × Fan coil unit FXAQ25", "1,760.00"],
      ["8 hr installation", "640.00"],
      ["GST 9%", "216.00"],
    ],
    total: ["Total", "S$2,616.00"],
  },
  delivery: {
    ref: "DO-2026-0097",
    summary: "2 × FXAQ25 · serials 7A41, 7A42 · Tuas",
    photos: ["Front", "Left", "Back", "Right"],
    stamp: "Thu 12 Nov · 14:22 · 1.3345°N 103.6364°E",
  },
  invoice: {
    ref: "INV-0248",
    rows: [
      ["Amount due", "S$2,616.00"],
      ["Due", "12 Dec 2026"],
      ["GST reg.", "M9-0012345-6"],
    ],
    note: "Scan to pay with PayNow, or click the link in the email.",
  },
  journal: {
    ref: "JV-1193",
    status: "Posted · S. Lim · 12 Nov",
    lines: [
      ["Dr 1200 Trade receivables", "2,616.00", false],
      ["Cr 4000 Sales, installation", "2,400.00", true],
      ["Cr 2200 GST output", "216.00", true],
    ] as [string, string, boolean][],
  },
};

/** Who it is for. Plain table, no links yet: trade pages come with the photo shoot. */
export const TRADES: { name: string; runs: string; papers: string }[] = [
  { name: "Aircon & M&E", runs: "Serial-tracked units, NFC tags, 4-photo delivery proof, servicing contracts billed monthly.", papers: "Quotation · DO · Service report" },
  { name: "Parts & distribution", runs: "Thousands of SKUs, stock by location, purchase orders to suppliers, price lists imported.", papers: "Stock card · PO · Invoice" },
  { name: "Interior design", runs: "Itemised quotations with discounts, progress billing, designer commissions and advances.", papers: "Quotation · Progress invoice · Claims" },
  { name: "Collection & logistics", runs: "Routes, driver links with no login, weights and volumes on the DO, recurring customer invoicing.", papers: "DO · Route · Recurring invoice" },
  { name: "Events & ticketing", runs: "Payouts from ticket platforms matched to sales, GST on fees, books that tie to the bank.", papers: "Receipt · Bank rec · GST F5" },
];

/** Sample conversation rendered in the phone. A different job from the hero:
 *  chasing money, recording a receipt, a stock check that drafts a PO. A
 *  `card` turn carries a draft with a Confirm button; the `sent` turn is the
 *  reply to that tap. */
export type ChatCard = { lines: [string, string, string][]; total: [string, string]; action: string; done: string };
export type ChatTurn =
  | { from: "you"; text: string; time: string }
  | { from: "aims"; html: string; time: string; card?: ChatCard; sent?: boolean };

export const CHAT: ChatTurn[] = [
  { from: "you", text: "who hasn't paid us this month?", time: "09:12" },
  {
    from: "aims",
    html: "<strong>3 overdue invoices, S$7,940.00.</strong> Reminders with pay links are drafted:",
    time: "09:12",
    card: {
      lines: [
        ["INV-0231 · Beta Industries", "3,200.00", "12 days"],
        ["INV-0226 · Ciel Interior", "2,860.00", "5 days"],
        ["INV-0219 · Tan Brothers", "1,880.00", "2 days"],
      ],
      total: ["Overdue", "S$7,940.00"],
      action: "Send reminders",
      done: "Sent ✓",
    },
  },
  { from: "aims", html: "Sent to all three, with PayNow links. Logged under your name.", time: "09:12", sent: true },
  { from: "you", text: "beta just paid 3,200 by paynow, record it", time: "09:14" },
  {
    from: "aims",
    html: "Draft receipt: <strong>S$3,200.00</strong> against INV-0231, PayNow. Beta would then owe S$1,620.00. Confirm to post?",
    time: "09:14",
  },
  { from: "you", text: "yes. how many FXAQ25 left? raise a PO to Daikin for 20", time: "09:15" },
  {
    from: "aims",
    html: "Posted. <strong>FXAQ25: 14 in stock</strong> (Woodlands 9, Tuas 5), 6 reserved. Draft <strong>PO-2026-0061</strong> to Daikin, 20 units, S$17,600.00, waiting for your Confirm.",
    time: "09:15",
  },
];

/**
 * Client logos for the proof strip. Leave empty and the strip is not rendered -
 * never ship placeholder logos. Files go in /public/clients/.
 */
export const CLIENT_LOGOS: { src: string; alt: string }[] = [];

export type ModuleKey = "inventory" | "crm" | "accounting" | "claims";
export type ModuleBadge = "early-access" | "roadmap";
export const MODULES: {
  key: ModuleKey;
  name: string;
  /** a few words for the selector tile */
  short: string;
  /** the documents this module owns, as they appear on paper */
  papers: string;
  /** one-line hero claim shown above the body */
  hero: string;
  body: string;
  prompts: string[];
  badge?: ModuleBadge;
  /** key into SCREENS for the card's thumbnail */
  screen?: string;
}[] = [
  {
    key: "inventory",
    name: "Inventory",
    short: "Stock, purchases and the field app",
    papers: "Stock card · PO · Goods received · DO",
    hero: "Tap the NFC sticker, photograph the nameplate. The unit exists.",
    body: "Products, purchases, adjustments and a stock card per item. A field app that creates units from a tag tap and a serial read off the nameplate.",
    screen: "field-scan",
    prompts: ["“check stock for FXAQ25”", "“raise a PO to Daikin for 20 units”", "“what did we deliver to Tuas this week?”"],
  },
  {
    key: "crm",
    name: "CRM",
    short: "Customers, quotations and invoices",
    papers: "Quotation · Tax invoice · Credit note · Statement",
    hero: "Drop a PDF or a photo. Get a numbered, branded document.",
    body: "Customers, the full quotation to invoice chain, click-to-pay invoices with a PayNow QR, and a WhatsApp assistant that only says what you taught it.",
    screen: "doc-upload",
    prompts: ["“quote Beta for 2 FCUs + install”", "“which quotes are unanswered over 7 days?”", "“add Ciel Interior as a customer”"],
  },
  {
    key: "accounting",
    name: "Accounting",
    short: "Ledger, bank rec and reports",
    papers: "Journal · Bank rec · GST F5 · 43 reports",
    hero: "AIMS proposes the entry. Your accountant keeps the pen.",
    body: "Documents post journals automatically and wait for review. Bank rec, period close, anomaly checks, GST F5 and 43 reports. Moves your books over from Xero, QuickBooks, Odoo and more.",
    screen: "posting-queue",
    prompts: ["“aged receivables as of today”", "“record S$3,200 from Beta against INV-0231”", "“GST report for Q3”"],
  },
  {
    key: "claims",
    name: "Claims",
    short: "Receipt to reimbursement",
    papers: "Claim · Approval · Payment run",
    hero: "Snap the receipt. It is filed, coded and waiting for approval.",
    body: "Send a receipt photo to the bot. It reads the amount, GST and vendor, tags the project, and posts it to the ledger once approved.",
    prompts: ["[receipt photo] “claim this under Tuas project”", "“approve all claims under S$50”", "“how much has Ravi claimed this month?”"],
  },
];

/** How the modules feed each other, shown in the module explorer. */
export const MODULE_LINKS: { from: ModuleKey; to: ModuleKey; text: string }[] = [
  { from: "crm", to: "inventory", text: "A delivery order ships the goods and deducts the stock." },
  { from: "inventory", to: "crm", text: "A signed delivery from the field drafts the invoice, already priced." },
  { from: "crm", to: "accounting", text: "Every invoice and credit note prepares its own journal for review." },
  { from: "accounting", to: "crm", text: "A recorded payment updates the customer's balance and statement." },
  { from: "inventory", to: "accounting", text: "Goods received against a PO match the supplier's bill. Stock on hand is valued on the balance sheet." },
  { from: "claims", to: "accounting", text: "An approved claim posts the expense and its GST." },
];

export const AGENT = {
  eyebrow: "The agent",
  title: "Not a chatbot that answers questions. A colleague that does the work.",
  body: "The agent has the same permissions as the person messaging it. It looks things up, drafts anything, and only commits after you tap Confirm.",
  /** `at` = the chat turn (index into CHAT) that lights this step. */
  steps: [
    {
      at: 0,
      when: "On your phone",
      title: "Ask in plain language",
      body: "WhatsApp or Telegram, from the phone you already have. It knows your customers, items, prices and staff.",
    },
    {
      at: 1,
      when: "Seconds later",
      title: "It drafts and shows you",
      body: "A quotation PDF, a leave request, a claim. Rendered on your own template so you see exactly what will go out.",
    },
    {
      at: 2,
      when: "One tap",
      title: "You confirm, AIMS executes",
      body: "One tap. The document is numbered, sent and posted to the ledger. Every action is logged with your name on it.",
    },
  ],
  /** Diagram: where work comes in. */
  channels: [
    { key: "whatsapp", label: "WhatsApp" },
    { key: "telegram", label: "Telegram" },
    { key: "email", label: "Email" },
    { key: "portal", label: "Portal" },
    { key: "field", label: "Field app" },
  ] as { key: "whatsapp" | "telegram" | "email" | "portal" | "field"; label: string }[],
  core: { title: "AIMS agent", body: "Your permissions. Your name on every action." },
  actions: ["Draft", "Confirm", "Execute"],
  waysTitle: "Two ways work reaches AIMS",
  ways: [
    { title: "You ask", body: "Message the agent or work in the portal. It drafts, you confirm." },
    { title: "It arrives", body: "Forwarded emails, uploaded files and field jobs become drafts that wait for review." },
  ],
  foot: "Every action is logged with the name of the person who confirmed it.",
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
    { icon: "file", title: "Branded documents", body: "Quotation, SO, DO, invoice, credit note, PO. Your templates, your numbering." },
    { icon: "phone", title: "Field app", body: "Android app for technicians. NFC scans, deliveries with signature and location." },
    { icon: "inbox", title: "Email & API ingestion", body: "Forward supplier bills to your AIMS email address. Connect your own apps through the API." },
    { icon: "layers", title: "Projects & deployments", body: "Rentals, sales and service jobs with assigned assets and recurring invoicing." },
    { icon: "building", title: "Multi-company, multi-currency", body: "Several companies from one login. Foreign invoices convert to base currency automatically." },
    { icon: "swap", title: "Migration from your current software", body: "Xero, QuickBooks, Odoo, MYOB, Sage and more. We bring in contacts, invoices, bills and history, and check the trial balance before you switch." },
  ] as { icon: "file" | "phone" | "inbox" | "layers" | "building" | "swap"; title: string; body: string }[],
};

export const CTA = {
  eyebrow: "Next step",
  title: "Bring one real job. We will run it through AIMS in front of you.",
  body: "A 45-minute demo on your own documents. Priced per company, per module. Our team handles setup and moves your books over.",
};

export const FOOTER = {
  blurb: "Operations software for small and medium businesses. By Osiris Technology Pte. Ltd., Singapore.",
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
        { label: "Privacy policy", href: "/privacy-policy" },
        { label: "Terms of service", href: "/terms" },
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
  dashboard: { file: "dashboard.png", alt: "The AIMS portal home: due today, pending, priorities, business overview and the assistant", kind: "desktop" },
  "field-scan": { file: "field-scan.png", alt: "SiteJobs field app: tap an asset tag", kind: "phone", caption: "Tap an asset tag" },
  "field-photos": { file: "field-photos.png", alt: "Guided 4-angle condition photo capture", kind: "phone", caption: "Guided 4-angle condition photos" },
  "field-route": { file: "field-route.png", alt: "Completed delivery run with photos, signature and linked Delivery Order", kind: "desktop", caption: "Proof of delivery in the office" },
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
  body: "The SiteJobs field app on an Android handheld: tap the NFC sticker, let AI read the nameplate, walk the four-angle photo set, take one signature at the end. and the Delivery Order and a priced draft invoice are already in the office.",
  points: [
    "NFC tap identifies the unit; AI reads model + serial off the label",
    "Front · Left · Back · Right photos, enforced on the phone and the server; before/after side-by-side on return",
    "Background GPS from Start to Acknowledge, drawn as a route in the portal",
    "Subcontracted driver? Send a link. no app, no login, self-expiring",
  ],
  screens: ["field-scan", "field-photos", "guest-delivery"],
  wide: "field-route",
};

export const ACCOUNTANT_BAND = {
  eyebrow: "Built for the accountant",
  title: "Nothing reaches the ledger without a human clicking Post.",
  body: "The controls an accountant would ask for, on by default. Plus bank rec that solves batch payments: one transfer settling four invoices is matched by subset-sum, guarded by the counterparty’s name in the narrative. and still surfaced as a suggestion for you to confirm.",
  tiles: [
    { screen: "posting-queue", title: "One review queue", body: "Invoices, bills, credit and debit notes, receipts and journal vouchers, each with an AI Dr/Cr preview you can override. Batch-post; never double-posts." },
    { screen: "ask-ai", title: "Ask the books. and hand it a PDF", body: "“Who owes me the most?” answered from the ledger with tables and drill-links. Attach a supplier or bank statement and it reconciles it against your books. It never invents a figure." },
    { screen: "close-wizard", title: "A close that locks the door", body: "Preflight checks with fix-it links, retained-earnings rollover and depreciation posted for you, then a period lock enforced at the write path." },
    { screen: "finance-hub", title: "Six detectors on the dashboard", body: "Possible duplicate invoices, invoices posted without GST, amounts 3× an account’s norm, stale drafts, rentals still billed in full after a partial return." },
  ],
  parity: {
    title: "Checked to the cent before you switch",
    body: "Import your Xero history, then run the reconciler: every GL account, plus total AR and AP, diffed against Xero’s live API at a one-cent tolerance and cross-checked against your own control accounts. Zero drift or the run fails.",
    sample: [
      "$ reconcile --asof 2026-08-31 --tol 0.01",
      "GL / trial balance  169 accounts   drift 0.00   OK",
      "Accounts receivable                 drift 0.00   OK",
      "Accounts payable                    drift 0.00   OK",
      "AR vs debtor control (GL)           drift 0.00   OK",
      "exit 0",
    ],
  },
};
