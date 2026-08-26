/**
 * All copy + links for the landing page live here so marketing edits never
 * touch a component. Links resolve from env at build time (see .env.example).
 */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.ai-ms.io").replace(/\/$/, "");
export const SIGN_IN_URL = `${APP_URL}/sign-in`;
export const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || "#book-a-demo";
export const WHATSAPP_URL = process.env.NEXT_PUBLIC_WHATSAPP_URL || "";

export const NAV_LINKS = [
  { label: "Modules", href: "#modules" },
  { label: "WhatsApp agent", href: "#agent" },
  { label: "How it works", href: "#how" },
  { label: "Pricing", href: "#pricing" },
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
export const MODULES: {
  key: ModuleKey;
  name: string;
  body: string;
  prompts: string[];
  /** grid span at desktop width (6-col grid) */
  span: 2 | 3;
  dark?: boolean;
}[] = [
  {
    key: "inventory",
    name: "Inventory",
    body: "Products, purchases, stock adjustments and a live stock card per item — by location, serial and QR.",
    prompts: ["“check stock for FXAQ25”", "“raise a PO to Daikin for 20 units”", "“what did we deliver to Tuas this week?”"],
    span: 2,
  },
  {
    key: "hr",
    name: "HR",
    body: "Staff records, leave, attendance and payroll runs — approvals happen in the chat, not in a queue of emails.",
    prompts: ["“apply 2 days leave next Thu–Fri”", "“who’s on leave this week?”", "“prepare August payroll”"],
    span: 2,
  },
  {
    key: "crm",
    name: "CRM",
    body: "Customers, quotations, follow-ups and a trained WhatsApp assistant that answers your customers in your voice.",
    prompts: ["“quote Beta for 2 FCUs + install”", "“which quotes are unanswered over 7 days?”", "“add Ciel Interior as a customer”"],
    span: 2,
  },
  {
    key: "accounting",
    name: "Accounting",
    body: "A real double-entry ledger. Invoices and bills post journals automatically, an accountant reviews the posting queue, and you get aged AR/AP, P&L, balance sheet, GST F5 and bank reconciliation — reconciled to the cent against Xero.",
    prompts: ["“aged receivables as of today”", "“record S$3,200 from Beta against INV-0231”", "“GST report for Q3”"],
    span: 3,
    dark: true,
  },
  {
    key: "claims",
    name: "Claims",
    body: "Snap a receipt, send it to the bot. It extracts the amount, GST and vendor, files the claim under the right staff and project, routes it for approval, and posts it to the ledger when approved.",
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
    { title: "Modules", links: MODULES.map((m) => ({ label: m.name, href: "#modules" })) },
    {
      title: "Product",
      links: [
        { label: "WhatsApp agent", href: "#agent" },
        { label: "Sign in", href: SIGN_IN_URL },
        { label: "Pricing", href: "#pricing" },
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
