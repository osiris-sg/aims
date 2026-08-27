import type { ModuleBadge, ModuleKey } from "./site";

/** Per-module marketing pages (/modules/<slug>). Screens reference SCREENS keys in site.ts. */
export type Feature = { title: string; body: string; bullets?: string[]; screen?: string };
export type ModulePage = {
  slug: ModuleKey;
  name: string;
  badge?: ModuleBadge;
  eyebrow: string;
  title: string;
  lede: string;
  heroScreen?: string;
  stats: { value: string; label: string }[];
  features: Feature[];
  prompts: string[];
};

export const MODULE_PAGES: ModulePage[] = [
  {
    slug: "inventory",
    name: "Inventory",
    eyebrow: "Inventory and field",
    title: "Stock you can trust, because the field keeps it honest.",
    lede: "Track products by serial or by quantity. Tag units with an NFC sticker. Get proof of delivery back from the van without asking.",
    heroScreen: "field-route",
    stats: [
      { value: "3", label: "checks before a duplicate serial can be created" },
      { value: "4", label: "condition photos per equipment delivery" },
      { value: "0", label: "logins needed for an outside driver" },
    ],
    features: [
      {
        title: "Tap the sticker. Photograph the nameplate. Done.",
        body: "The NFC tag is the unit's identity. AI reads the model and serial off the label and matches it to your catalog. Three checks stop the same pump being added twice.",
        bullets: ["Works on NFC Android phones and rugged handhelds", "Manual serial entry for units you cannot tag", "Create a new product from the field"],
        screen: "field-scan",
      },
      {
        title: "Four photos out, four photos back.",
        body: "Front, left, back, right. The app guides each shot and will not let a short set through. On return, each new photo sits next to the old one.",
        bullets: ["Equipment needs 4 photos, accessories 1", "Before and after, side by side", "Photos shrink on the phone so uploads are quick"],
        screen: "field-photos",
      },
      {
        title: "One signature closes the run. The paperwork writes itself.",
        body: "The customer signs once. AIMS creates the Delivery Order, deducts stock and drafts an invoice with the right prices. The office checks it and confirms.",
        bullets: ["GPS tracked from start to sign-off", "Rental billing stops when the last unit comes back", "Print a receipt at the door over Bluetooth"],
        screen: "field-route",
      },
      {
        title: "Send the driver a link, not an app.",
        body: "Using an outside driver? Send a link from the Delivery Order. They see the list, take the photos and get the signature. No account needed. The link expires on its own.",
        bullets: ["No install, no login", "Photos and signature only, nothing else can be changed", "Revoke it any time"],
        screen: "guest-delivery",
      },
      {
        title: "Purchases, adjustments and a stock card per product.",
        body: "Purchase orders with a receive step, returns, and stock adjustments in and out. Every product has a movement ledger with a running balance.",
        bullets: ["Parent and child products", "Price history, one click to reuse", "Every adjustment shows who, when and why"],
      },
    ],
    prompts: ["“check stock for FXAQ25”", "“raise a PO to Daikin for 20 units”", "“what did we deliver to Tuas this week?”", "“which rentals are still out on the Holland Drive project?”"],
  },
  {
    slug: "crm",
    name: "CRM",
    eyebrow: "CRM and sales documents",
    title: "From first WhatsApp to paid invoice, without retyping anything.",
    lede: "Customers, quotations, orders, deliveries and invoices in one chain. AI turns a PDF or photo into a document. Customers pay from a link.",
    heroScreen: "invoices-list",
    stats: [
      { value: "9", label: "document types in one linked chain" },
      { value: "10", label: "steps tracked from draft to paid" },
      { value: "5", label: "document types AI can read from a file" },
    ],
    features: [
      {
        title: "Drop a PDF or a photo. Get a numbered document.",
        body: "Upload a supplier invoice, a customer PO or a photo of a handwritten DO. AI reads the customer, dates, items and totals and creates the document on your template.",
        bullets: ["Upload a ZIP and each file becomes a document", "Customer matched by name, or created", "Lines coded from your price list"],
        screen: "doc-upload",
      },
      {
        title: "Quotation to invoice, linked all the way.",
        body: "Convert a quotation to an order, a delivery order, then an invoice. Items carry forward. Partial billing knows what was already invoiced.",
        bullets: ["Revisions, duplicates and notes on every document", "Two people cannot overwrite the same quote", "Recurring invoices that update their own text each month"],
        screen: "invoice-preview",
      },
      {
        title: "Click to pay, with a PayNow QR.",
        body: "Every emailed invoice has a private link. The customer sees the amount, whether it is overdue, your bank details and a PayNow QR. No login.",
        bullets: ["PDF attached when you send", "Status changes to Awaiting Payment", "Statement of account per customer"],
        screen: "pay-page",
      },
      {
        title: "A WhatsApp assistant that only says what you taught it.",
        body: "Connect your WhatsApp Business number. Paste question and answer pairs. Tell it what it may answer on its own. Everything else waits for your approval.",
        bullets: ["Knows the customer's balance and recent documents", "Test it before going live", "Scheduled and recurring messages"],
      },
      {
        title: "Ask AI inside the editor.",
        body: "Say “same terms as the last CityGas quote, but 12 units”. It searches your past documents and offers a change you can apply. It never edits on its own.",
        bullets: ["Past line descriptions suggested as you type", "Several template designs per document type", "Your own numbering format"],
      },
    ],
    prompts: ["“quote Beta for 2 FCUs + install”", "“which quotes are unanswered over 7 days?”", "“add Ciel Interior as a customer”", "“email INV-0231 to Beta with the pay link”"],
  },
  {
    slug: "accounting",
    name: "Accounting",
    eyebrow: "Accounting",
    title: "AI does the coding. Your accountant keeps the pen.",
    lede: "Real double-entry accounting. Documents post journals automatically and wait for review. Bank rec, period close, GST F5 and 43 reports. Works with the software you use today.",
    heroScreen: "finance-hub",
    stats: [
      { value: "43", label: "reports, searchable and exportable" },
      { value: "6", label: "checks watching the books" },
      { value: "$0.01", label: "tolerance when we check your migrated books" },
    ],
    features: [
      {
        title: "One review queue. Nothing posts without a human.",
        body: "Invoices, bills, credit notes, receipts and journals in one screen. See the suggested debit and credit, change it if needed, and post in bulk.",
        bullets: ["Each line gets its own account", "Reject with a reason", "Documents from email and API land here too"],
        screen: "posting-queue",
      },
      {
        title: "It learns your chart of accounts.",
        body: "Every correction is remembered. The next similar line is coded the same way, and the screen tells you why.",
        bullets: ["Per company", "Faster every month", "Your rules, not a generic mapping"],
      },
      {
        title: "Bank rec that handles batch payments.",
        body: "Import a CSV or a PDF statement. Exact matches clear first. Then it finds the invoices behind one big transfer and suggests them for you to confirm.",
        bullets: ["AI suggests an account for unmatched lines", "Post a bank line as a new entry in one click", "Reconciles to the cent"],
        screen: "bank-rec",
      },
      {
        title: "Ask the books a question.",
        body: "Type “who owes me the most?” and get a table from the ledger. Attach a supplier statement and it checks it against your books.",
        bullets: ["15 tools: P&L, balance sheet, GST, ageing, ledgers", "Answers stream as it works", "Never makes up a number"],
        screen: "ask-ai",
      },
      {
        title: "A close that locks the period.",
        body: "It checks that everything is posted and balanced, posts depreciation and the year-end rollover, then locks the period. Nothing can be posted into a locked period.",
        bullets: ["Month-end and year-end", "Three depreciation methods", "Budgets with variance"],
        screen: "close-wizard",
      },
      {
        title: "Six checks watching the books.",
        body: "Possible duplicate invoices. Invoices without GST. Unusual amounts. Stale drafts. Rentals still billed after a partial return. All on the dashboard.",
        bullets: ["Singapore GST F5, checked line by line", "Multi-currency with realised FX", "Every action logged with a name"],
        screen: "finance-hub",
      },
      {
        title: "Bring your books from the software you use today.",
        body: "Xero, QuickBooks, Odoo, MYOB, Sage, Zoho Books, SAP Business One or AutoCount. We import your contacts, invoices, bills and history, then check every account to one cent before you switch.",
        bullets: ["Reports shaped like the Singapore desktop packages you know", "Keep syncing to your old system while you switch", "AI-assisted account mapping you approve"],
      },
    ],
    prompts: ["“aged receivables as of today”", "“record S$3,200 from Beta against INV-0231”", "“GST report for Q3”", "“list open bills over 30 days”"],
  },
  {
    slug: "claims",
    name: "Claims",
    badge: "early-access",
    eyebrow: "Claims · early access",
    title: "Snap the receipt. It is filed, coded and waiting for approval.",
    lede: "Staff expense claims that use the same AI that reads supplier bills. Send a receipt to the bot, approve it in the chat, and it posts to the ledger.",
    stats: [
      { value: "1", label: "photo to raise a claim" },
      { value: "0", label: "spreadsheets" },
      { value: "100%", label: "of approved claims posted with GST" },
    ],
    features: [
      {
        title: "From a photo in WhatsApp to a coded claim.",
        body: "Send the receipt with a note like “claim this under Tuas project”. AI reads the vendor, amount and GST, files it under you and tags the project.",
        bullets: ["Same AI that reads supplier bills", "Learns which account each vendor goes to", "Spots duplicate receipts"],
      },
      {
        title: "Approve in the chat or in the queue.",
        body: "Approvers get the claim in their own chat with Approve and Query buttons. The accountant sees everything in the review queue.",
        bullets: ["Approval rules by role and amount", "Reject with a reason", "Every step logged"],
      },
      {
        title: "Approved means posted and paid.",
        body: "Approval posts the expense and GST to the ledger. Reimbursement uses the same payment run as supplier bills.",
        bullets: ["Claim history per staff member", "Project and cost centre reports", "Export for payroll"],
      },
    ],
    prompts: ["[receipt photo] “claim this under Tuas project”", "“approve all claims under S$50”", "“how much has Ravi claimed this month?”"],
  },
  {
    slug: "hr",
    name: "HR",
    badge: "roadmap",
    eyebrow: "HR · roadmap",
    title: "Leave, attendance and payroll, approved in the chat.",
    lede: "Staff records on the same roles and permissions as the rest of AIMS. Leave through the agent. Attendance from the field app. Payroll prepared for review.",
    stats: [
      { value: "1", label: "identity across portal, field app and bot" },
      { value: "93", label: "permissions already in the platform" },
      { value: "2027", label: "target" },
    ],
    features: [
      {
        title: "Leave that asks and answers itself.",
        body: "Say “apply 2 days leave next Thu to Fri”. The agent checks the balance, raises the request and pings the approver with Approve and Decline buttons.",
        bullets: ["Leave types per company", "Singapore public holidays built in", "Team calendar in the portal"],
      },
      {
        title: "Attendance from the field app.",
        body: "Technicians already carry the AIMS Field app. Clock in and out on the same phone, with location.",
        bullets: ["NFC or GPS clock-in", "Hours per project", "Exceptions flagged for review"],
      },
      {
        title: "Payroll prepared, reviewed, posted.",
        body: "Monthly payroll drafted from attendance, leave and approved claims. Reviewed by the person who signs it, then posted to the ledger.",
        bullets: ["Review before posting", "Payslips sent in the chat", "CPF and levies split correctly"],
      },
    ],
    prompts: ["“apply 2 days leave next Thu to Fri”", "“who is on leave this week?”", "“prepare August payroll”"],
  },
];

export const MODULE_BY_SLUG = Object.fromEntries(MODULE_PAGES.map((m) => [m.slug, m])) as Record<ModuleKey, ModulePage>;
