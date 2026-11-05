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
  { label: "WhatsApp agent", href: "/agent" },
  { label: "How it works", href: "/#how" },
  { label: "Pricing", href: "/pricing" },
];

export const HERO = {
  eyebrow: "The intelligent business operating system",
  /** Line one, then line two split so the second half takes the brand colour. */
  title: "One Intelligent System.",
  titleLead: "More",
  titleAccent: "Human Potential.",
  body:
    "Inventory, CRM, accounting, claims and HR in one system. An AI agent on WhatsApp or Telegram does the work when you ask. You confirm, it is done.",
  proofs: ["Double-entry ledger built in", "GST-ready, Singapore first", "Works with your current accounting software"],
};

/** The floating card on the hero photo: one request, three modules consulted. */
export const HERO_CARD = {
  channel: "AIMS agent on WhatsApp",
  ask: "Quote Beta for 2 fan coil units and 8 hours install",
  reply: "Draft QT-2026-0148 is ready. S$2,616.00 incl. GST.",
  checks: [
    { text: "Customer and prices matched", module: "CRM" },
    { text: "FXAQ25: 14 in stock", module: "Inventory" },
    { text: "Beta owes S$4,820.00", module: "Accounting" },
  ],
  status: "Draft ready for your Confirm",
};

export const MARQUEE = [
  "One Intelligent System",
  "More Human Potential",
  "Unified by Design",
  "Built to Execute",
  "Designed Around People",
];

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
    html: "Beta Industries has <strong>2 open invoices, S$4,820.00</strong>. INV-0231 (S$3,200) is 12 days overdue. Send a reminder?",
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
 * Client logos for the proof strip. Leave empty and the strip is not rendered -
 * never ship placeholder logos. Files go in /public/clients/.
 */
export const CLIENT_LOGOS: { src: string; alt: string }[] = [];

export type ModuleKey = "inventory" | "hr" | "crm" | "accounting" | "claims";
export type ModuleBadge = "early-access" | "roadmap";
export const MODULES: {
  key: ModuleKey;
  name: string;
  /** a few words for the selector tile */
  short: string;
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
    hero: "Tap the NFC sticker, photograph the nameplate. The unit exists.",
    body: "Products, purchases, adjustments and a stock card per item. A field app that creates units from a tag tap and an AI-read serial.",
    screen: "field-scan",
    prompts: ["“check stock for FXAQ25”", "“raise a PO to Daikin for 20 units”", "“what did we deliver to Tuas this week?”"],
  },
  {
    key: "hr",
    name: "HR",
    short: "Leave, attendance and payroll",
    hero: "Leave, attendance and payroll, approved in the chat.",
    body: "Staff records, leave and payroll on the same roles and permissions as every other module. Approvals happen in the chat.",
    badge: "roadmap",
    prompts: ["“apply 2 days leave next Thu–Fri”", "“who’s on leave this week?”", "“prepare August payroll”"],
  },
  {
    key: "crm",
    name: "CRM",
    short: "Customers, quotations and invoices",
    hero: "Drop a PDF or a photo. Get a numbered, branded document.",
    body: "Customers, the full quotation to invoice chain, click-to-pay invoices with a PayNow QR, and a WhatsApp assistant that only says what you taught it.",
    screen: "doc-upload",
    prompts: ["“quote Beta for 2 FCUs + install”", "“which quotes are unanswered over 7 days?”", "“add Ciel Interior as a customer”"],
  },
  {
    key: "accounting",
    name: "Accounting",
    short: "Ledger, bank rec and reports",
    hero: "AI does the coding. Your accountant keeps the pen.",
    body: "Documents post journals automatically and wait for review. Bank rec, period close, anomaly checks, GST F5 and 43 reports. Moves your books over from Xero, QuickBooks, Odoo and more.",
    screen: "posting-queue",
    prompts: ["“aged receivables as of today”", "“record S$3,200 from Beta against INV-0231”", "“GST report for Q3”"],
  },
  {
    key: "claims",
    name: "Claims",
    short: "Receipt to reimbursement",
    hero: "Snap the receipt. It is filed, coded and waiting for approval.",
    body: "Send a receipt photo to the bot. AI reads the amount, GST and vendor, tags the project, and posts it to the ledger once approved.",
    badge: "early-access",
    prompts: ["[receipt photo] “claim this under Tuas project”", "“approve all claims under S$50”", "“how much has Ravi claimed this month?”"],
  },
];

/**
 * "AIMS in action": three everyday jobs, stepped through one stage at a time.
 * `modules` on a step are the modules that stage touches, which is what lights
 * up the rail beside the walkthrough. All figures are sample data.
 */
export type UseCaseIcon = "chat" | "file" | "truck" | "receipt" | "check" | "box" | "inbox" | "review" | "bank" | "camera" | "search" | "approve" | "post";
export type UseCase = {
  key: string;
  label: string;
  icon: "chat" | "box" | "receipt";
  badge?: ModuleBadge;
  summary: string;
  steps: { label: string; icon: UseCaseIcon; title: string; body: string; meta: string; modules: ModuleKey[] }[];
};
export const USE_CASES: UseCase[] = [
  {
    key: "order",
    label: "A customer order",
    icon: "chat",
    summary: "From a WhatsApp message to a paid invoice",
    steps: [
      {
        label: "Ask",
        icon: "chat",
        title: "You message the agent",
        body: "“Quote Beta for 2 fan coil units and 8 hours install.” Sent from WhatsApp, on the phone you already have.",
        meta: "WhatsApp or Telegram",
        modules: ["crm"],
      },
      {
        label: "Draft",
        icon: "file",
        title: "Quotation QT-2026-0148 is drafted",
        body: "AIMS finds Beta Industries, prices both lines and renders the PDF on your own template. S$2,616.00 including 9% GST.",
        meta: "Nothing goes out until you tap Confirm",
        modules: ["crm"],
      },
      {
        label: "Deliver",
        icon: "truck",
        title: "Delivered and signed for",
        body: "The technician taps the NFC tag, takes the photos and gets one signature. AIMS creates the delivery order and deducts the 2 units from stock.",
        meta: "Proof of delivery reaches the office by itself",
        modules: ["inventory", "crm"],
      },
      {
        label: "Invoice",
        icon: "receipt",
        title: "Invoice INV-0248 is waiting",
        body: "A priced draft invoice is already there. Confirm it and Beta gets a pay link with a PayNow QR. The journal is prepared for your accountant.",
        meta: "Posts only after a person clicks Post",
        modules: ["crm", "accounting"],
      },
      {
        label: "Paid",
        icon: "check",
        title: "Payment recorded, books updated",
        body: "S$2,616.00 is recorded against INV-0248. Beta's balance, the ledger and your reports change together.",
        meta: "Every action logged with a name",
        modules: ["accounting", "crm"],
      },
    ],
  },
  {
    key: "purchase",
    label: "A stock purchase",
    icon: "box",
    summary: "From a purchase order to a reconciled payment",
    steps: [
      {
        label: "Order",
        icon: "chat",
        title: "You ask for a purchase order",
        body: "“Raise a PO to Daikin for 20 units.” AIMS drafts it with the supplier and items already filled in.",
        meta: "Draft first, confirm to send",
        modules: ["inventory"],
      },
      {
        label: "Receive",
        icon: "box",
        title: "Goods arrive, stock goes up",
        body: "Receive the delivery against the PO. 20 units land on the stock card with a running balance.",
        meta: "Who, when and why on every movement",
        modules: ["inventory"],
      },
      {
        label: "Bill",
        icon: "inbox",
        title: "The supplier's bill reads itself",
        body: "Forward the bill to your AIMS email address. AI reads the supplier, the lines and the GST and creates a draft bill.",
        meta: "By email, upload or API",
        modules: ["accounting"],
      },
      {
        label: "Review",
        icon: "review",
        title: "Your accountant reviews and posts",
        body: "The bill waits in one review queue with a suggested debit and credit. Change it if needed, then post.",
        meta: "AIMS remembers every correction",
        modules: ["accounting"],
      },
      {
        label: "Match",
        icon: "bank",
        title: "The bank payment is matched",
        body: "Import the bank statement. The payment to Daikin is matched to the bill, and payables and GST are up to date.",
        meta: "Reconciles to the cent",
        modules: ["accounting"],
      },
    ],
  },
  {
    key: "claim",
    label: "A staff claim",
    icon: "receipt",
    badge: "early-access",
    summary: "From a receipt photo to a reimbursement",
    steps: [
      {
        label: "Snap",
        icon: "camera",
        title: "Staff send a receipt photo",
        body: "“Claim this under Tuas project.” Sent to the same bot, straight from the counter.",
        meta: "One photo raises the claim",
        modules: ["claims"],
      },
      {
        label: "Read",
        icon: "search",
        title: "AI reads the receipt",
        body: "Vendor, amount and GST come off the photo. The claim is filed under the staff member and tagged to the project.",
        meta: "Duplicate receipts are spotted",
        modules: ["claims"],
      },
      {
        label: "Approve",
        icon: "approve",
        title: "The approver taps Approve",
        body: "The claim arrives in the approver's own chat with Approve and Query buttons.",
        meta: "Approval rules by role and amount",
        modules: ["claims"],
      },
      {
        label: "Post",
        icon: "post",
        title: "Expense and GST reach the ledger",
        body: "Approval posts the expense and its GST. Your accountant sees it in the same review queue as everything else.",
        meta: "No spreadsheet in between",
        modules: ["claims", "accounting"],
      },
      {
        label: "Repay",
        icon: "bank",
        title: "Reimbursed in the next payment run",
        body: "Reimbursement uses the same payment run as supplier bills. The history stays against the staff member.",
        meta: "Project and cost centre reports included",
        modules: ["accounting", "claims"],
      },
    ],
  },
];

/** How the modules feed each other, shown in the module explorer. */
export const MODULE_LINKS: { from: ModuleKey; to: ModuleKey; text: string; badge?: ModuleBadge }[] = [
  { from: "crm", to: "inventory", text: "A delivery order ships the goods and deducts the stock." },
  { from: "inventory", to: "crm", text: "A signed delivery from the field drafts the invoice, already priced." },
  { from: "crm", to: "accounting", text: "Every invoice and credit note prepares its own journal for review." },
  { from: "accounting", to: "crm", text: "A recorded payment updates the customer's balance and statement." },
  { from: "claims", to: "accounting", text: "An approved claim posts the expense and its GST." },
  { from: "claims", to: "hr", text: "Approved claims flow into the month's payroll.", badge: "roadmap" },
  { from: "inventory", to: "hr", text: "Clock-ins on the field app become attendance.", badge: "roadmap" },
  { from: "hr", to: "accounting", text: "Payroll is reviewed, then posted to the ledger.", badge: "roadmap" },
];

export const AGENT = {
  eyebrow: "The agent",
  title: "Not a chatbot that answers questions. A colleague that does the work.",
  body: "The agent has the same permissions as the person messaging it. It looks things up, drafts anything, and only commits after you tap Confirm.",
  steps: [
    {
      n: "01",
      title: "Ask in plain language",
      body: "WhatsApp or Telegram, from the phone you already have. It knows your customers, items, prices and staff.",
    },
    {
      n: "02",
      title: "It drafts and shows you",
      body: "A quotation PDF, a leave request, a claim. Rendered on your own template so you see exactly what will go out.",
    },
    {
      n: "03",
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
  eyebrow: "Get started",
  title: "Pick the modules you need. Talk to the agent tomorrow.",
  body: "Priced per company, per module. Our team handles setup and migration.",
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
