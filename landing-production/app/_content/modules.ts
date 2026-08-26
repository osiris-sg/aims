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
    eyebrow: "Inventory & field",
    title: "Stock you can trust, because the field keeps it honest.",
    lede: "Serial-tracked or quantity-tracked products, purchases and adjustments, a stock card per item — and an Android field app that creates units from an NFC tap and an AI-read nameplate, then sends proof of delivery back by itself.",
    heroScreen: "field-route",
    stats: [
      { value: "3", label: "duplicate-serial guards before a unit is minted" },
      { value: "4", label: "condition photos per equipment delivery, enforced" },
      { value: "0", label: "logins needed for a subcontracted driver" },
    ],
    features: [
      {
        title: "Tap the sticker. Photograph the nameplate. Done.",
        body: "The tag's factory UID is the identity. AI reads model and serial off the label photo and matches it to your catalog. A three-layer guard — normalised serial, one-character typos, O/0 and I/1 confusions — means the same pump never ends up in the system twice.",
        bullets: ["Works with NFC-capable Android phones and rugged handhelds", "Manual serial entry for untaggable units", "New product from the field when the nameplate matches nothing"],
        screen: "field-scan",
      },
      {
        title: "Four angles out, four angles back.",
        body: "Front, left, back, right — a guided walk-around with a reference image per slot, enforced on the phone and on the server. On collection the rider shoots each angle and sees it beside the outbound photo of the same angle. Damage disputes end here.",
        bullets: ["Equipment needs 4 photos, accessories 1", "Before/after side-by-side on return", "Photos compressed on-device so LTE never stalls"],
        screen: "field-photos",
      },
      {
        title: "One signature closes the run — and the paperwork writes itself.",
        body: "The customer signs once for every item. AIMS creates the Delivery Order from what was actually delivered, deducts stock, and drafts an invoice that has already priced itself — list price for sales, monthly rate for rentals. The office reviews and confirms.",
        bullets: ["Background GPS from Start to Acknowledge, drawn as a route", "Partial returns don't stop rental billing; the last unit out does", "Bluetooth receipt printing at the door"],
        screen: "field-route",
      },
      {
        title: "Send the driver a link, not an app.",
        body: "Subcontracting the delivery? Mint a link from the DO and WhatsApp it. The driver sees the manifest, photographs each item, takes the customer's signature — and that signature commits the DO in your office. The link expires around the delivery date and revokes itself on completion.",
        bullets: ["No account, no install", "No skip, no add, no edit — proof only", "Self-expiring, revocable from the same menu"],
        screen: "guest-delivery",
      },
      {
        title: "Purchases, adjustments and a stock card per product.",
        body: "Purchase orders with a receive mode, purchase returns, stock adjustments in and out, and a movement ledger per product with running balance, unit price and counterparty — every row a click away from its document. Closing stock valued at cost for the accountant.",
        bullets: ["Parent/child products with auto-spawned child units", "Price history per product, one click to apply", "Every quantity adjustment audited: who, when, why"],
      },
    ],
    prompts: ["“check stock for FXAQ25”", "“raise a PO to Daikin for 20 units”", "“what did we deliver to Tuas this week?”", "“which rentals are still out on the Holland Drive project?”"],
  },
  {
    slug: "crm",
    name: "CRM",
    eyebrow: "CRM & sales documents",
    title: "From first WhatsApp to paid invoice, without retyping anything.",
    lede: "Customers, the full Quotation → Sales Order → Delivery Order → Invoice chain, AI that turns a PDF or a photo into a finished document, click-to-pay invoices with a PayNow QR, and a WhatsApp assistant that only says what you taught it.",
    heroScreen: "invoices-list",
    stats: [
      { value: "9", label: "document types, one linked chain" },
      { value: "10", label: "lifecycle states from draft to paid" },
      { value: "5", label: "document types AI can read from a PDF or photo" },
    ],
    features: [
      {
        title: "Drop a PDF or a photo. Get a numbered, branded document.",
        body: "A supplier invoice, a customer PO, a phone photo of a handwritten DO — AI pulls out the customer, dates, cross-references, line items with model codes and serials, and totals, then creates a real document on your template with your next number.",
        bullets: ["Upload a ZIP of files; each becomes its own document", "Customer matched by name, created if new", "Lines coded from your revenue master file"],
        screen: "doc-upload",
      },
      {
        title: "Quotation → SO → DO → Invoice, linked.",
        body: "Convert with one dialog, carrying line items forward. Partial billing knows which lines were already invoiced. Confirming a DO or invoice deducts stock at the right moment. Every stage numbers itself from your own format and rolls up under the project.",
        bullets: ["Revisions and duplicates, with history and notes per document", "Two people can't overwrite each other's quote — presence lock + versioning", "Recurring invoices with text that rewrites itself each period"],
        screen: "invoice-preview",
      },
      {
        title: "Click to pay, with a PayNow QR.",
        body: "Every emailed invoice carries an unguessable link. The customer taps it and sees the amount, a DUE / OVERDUE / PAID badge, your bank details, your PayNow QR and the PDF — no login, no app. The number-one cause of late payment is “I couldn't find the invoice.” Solved.",
        bullets: ["PDF attached automatically when you send", "Status flips to Awaiting Payment on send", "Statement of account and 30/60/90 ageing per customer"],
        screen: "pay-page",
      },
      {
        title: "A WhatsApp assistant that answers customers 24/7 — and only what you trained it on.",
        body: "Connect your own WhatsApp Business number in-portal. Paste question/answer pairs. Tell it in plain English what it may answer without you. Anything outside that scope, or below its confidence bar, queues for one-tap approval. It will not improvise, quote a price, or promise anything.",
        bullets: ["Knows the customer: outstanding balance and recent documents in context", "Dry-run tester before you go live", "Scheduled and recurring messages"],
      },
      {
        title: "Ask AI inside the editor, with memory of every document you've sent.",
        body: "“Same terms as the last CityGas quote, but 12 units.” The assistant searches your own history and hands you an Apply card. It never edits behind your back.",
        bullets: ["Past line descriptions suggested as you type", "Multiple template designs per document type", "Your numbering: BIPL-EW-{DOC}-{YYYYMMDD}-{####}"],
      },
    ],
    prompts: ["“quote Beta for 2 FCUs + install”", "“which quotes are unanswered over 7 days?”", "“add Ciel Interior as a customer”", "“email INV-0231 to Beta with the pay link”"],
  },
  {
    slug: "accounting",
    name: "Accounting",
    eyebrow: "Accounting",
    title: "AI does the coding. Your accountant keeps the pen.",
    lede: "A real double-entry ledger. Documents post balanced journals automatically and wait in a review queue. Bank rec that solves batch payments, a close whose lock is enforced at the write path, six anomaly detectors, GST F5, and 43 reports — reconciled to the cent against Xero.",
    heroScreen: "finance-hub",
    stats: [
      { value: "43", label: "reports, searchable, starrable, exportable" },
      { value: "6", label: "anomaly detectors on the dashboard" },
      { value: "$0.01", label: "tolerance when reconciling against Xero" },
    ],
    features: [
      {
        title: "One review queue. Nothing reaches the ledger without a human clicking Post.",
        body: "Sales invoices, supplier bills, credit and debit notes, receipts and journal vouchers, all in one screen. Open the AI Dr/Cr preview, override an account, post the selection in bulk. Posting is confirmation — the document moves to Awaiting Payment and the journal is live in one action. It never double-posts.",
        bullets: ["Per-line revenue and expense accounts, not one blanket sales account", "Reject with a reason", "Machine intake (email, API) lands here too — auto-post is a switch, off by default"],
        screen: "posting-queue",
      },
      {
        title: "It learns your chart of accounts from your corrections.",
        body: "Every override is remembered. Next time the same or a similar line arrives it's coded automatically — exact text, then keywords, then meaning. The UI tells you why: “Learned from your coding (14×)”. Learned rules beat the AI; only genuinely new lines go to the model.",
        bullets: ["Per company, per side (sales / purchases)", "Month twelve is nearly free", "Your policy replayed, not a vendor's generic mapping"],
      },
      {
        title: "Bank rec that solves batch payments.",
        body: "Import a CSV in any layout, or a PDF read by AI. Exact matches clear first. Then a subset-sum pass cracks “one $48,320 transfer settles four invoices” — guarded by the counterparty's name in the narrative, and always surfaced as a suggestion for you to confirm. Unknown counterparties are never auto-batched.",
        bullets: ["AI account suggestion for unmatched lines", "Post a bank line as a new entry in one click", "Reconciliation statement to ±$0.01"],
        screen: "bank-rec",
      },
      {
        title: "Ask the books a question — and hand it a PDF.",
        body: "“Who owes me the most?” answered from the ledger with tables and drill-links. Attach a supplier statement or a bank statement and it reconciles the document against your books and tells you what doesn't agree. It calls tools to get real numbers; it never makes one up.",
        bullets: ["15 tools: TB, P&L, balance sheet, GST, ageing, ledgers, statements", "Streams the answer as it works", "Every tool call shown for transparency"],
        screen: "ask-ai",
      },
      {
        title: "A close that does the closing work, then locks the door.",
        body: "Preflight: invoices posted, no drafts, every entry balanced, GST payable, depreciation due — each pass / warn / fail with a fix-it link. Then it posts the retained-earnings rollover and the month's depreciation, stamps the close history and sets the lock. The lock is enforced where journals are written, not just in the UI.",
        bullets: ["Month-end and year-end closes", "Three depreciation methods, assets auto-created from PO lines", "Budgets per account per month, with variance"],
        screen: "close-wizard",
      },
      {
        title: "Six detectors watching the books.",
        body: "Possible duplicate invoices. Invoices posted without GST. An expense three times its own account's norm. Stale drafts. Draft journals older than a week. Rentals still billed in full after a partial return. All on the Finance Hub, each a click from the entries.",
        bullets: ["Singapore GST F5 with multi-era tax codes, verified line-by-line against Xero", "Multi-currency with realised FX on settlement", "Every action logged with the user's name"],
        screen: "finance-hub",
      },
      {
        title: "Reconciled to the cent against Xero.",
        body: "Import contacts, invoices, bills, credit notes and the full journal history. Then run the reconciler: every GL account, plus total AR and AP, diffed against Xero's live API at a one-cent tolerance and cross-checked against your own control accounts. Zero drift or the run fails. We do this with you before you switch.",
        bullets: ["Legacy-shaped reports for teams moving off SG desktop packages", "Push documents back to Xero as drafts during transition", "AI-assisted account mapping you approve"],
      },
    ],
    prompts: ["“aged receivables as of today”", "“record S$3,200 from Beta against INV-0231”", "“GST report for Q3”", "“list open bills over 30 days”"],
  },
  {
    slug: "claims",
    name: "Claims",
    badge: "early-access",
    eyebrow: "Claims · early access",
    title: "Snap the receipt. It's filed, coded and waiting for approval.",
    lede: "Staff expense claims built on the same machinery that already reads supplier bills: AI extraction, project and cost-centre tagging, learned account coding, and an approve-then-post queue. Send a receipt to the bot; the claim appears for approval; approval posts it to the ledger.",
    stats: [
      { value: "1", label: "photo to raise a claim" },
      { value: "0", label: "spreadsheets" },
      { value: "100%", label: "of approved claims posted with GST split out" },
    ],
    features: [
      {
        title: "From a photo in WhatsApp to a coded claim.",
        body: "Send the receipt to the AIMS bot with a line like “claim this under Tuas project”. AI reads vendor, amount and GST, files it under the sender, tags the project or cost centre, and codes the account the way your accountant has coded that vendor before.",
        bullets: ["Same extraction that reads supplier bills", "Grab is always Travel — after the first correction", "Duplicate receipt detection"],
      },
      {
        title: "Approval in the chat, or in the queue.",
        body: "Approvers get the claim in their own chat with Approve / Query buttons; the accountant sees everything in the posting review queue with the journal preview. Thresholds decide who must approve what.",
        bullets: ["Role-based approval chains", "Reject with a reason, back to the claimant", "Every step in the action log"],
      },
      {
        title: "Approved means posted — and paid.",
        body: "Approval posts the expense and the GST to the ledger against the staff member. Reimbursement runs through the same payment rails as supplier bills, with a payment voucher and attachment.",
        bullets: ["Per-staff claim history and monthly totals", "Project and cost-centre reporting", "Export for payroll offset"],
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
    lede: "Staff records built on the roles and permissions that already gate every other AIMS module, leave requests that move through the agent instead of an email queue, attendance from the same field app your technicians carry, and payroll runs prepared for review.",
    stats: [
      { value: "1", label: "identity across portal, field app and bot" },
      { value: "93", label: "granular permissions already in the platform" },
      { value: "2027", label: "target" },
    ],
    features: [
      {
        title: "Leave that asks and answers itself.",
        body: "“Apply 2 days leave next Thu–Fri” — the agent checks the balance and the calendar, raises the request, and pings the approver with Approve / Decline buttons. “Who's on leave this week?” answered instantly.",
        bullets: ["Leave types and entitlements per company", "Public-holiday calendar for Singapore", "Team calendar in the portal"],
      },
      {
        title: "Attendance from the field app.",
        body: "Technicians already tap in with the AIMS Field app. Clock-in and clock-out on the same handheld, with location, becomes attendance — no separate device, no separate login.",
        bullets: ["NFC or GPS clock-in", "Overtime and site hours per project", "Exceptions flagged for review"],
      },
      {
        title: "Payroll prepared, reviewed, posted.",
        body: "Monthly payroll drafted from attendance, leave and approved claims, reviewed by the person who signs it, and posted to the ledger with CPF and levies split correctly.",
        bullets: ["Review before anything is posted", "Payslips delivered in the chat", "Posts to the same GL as everything else"],
      },
    ],
    prompts: ["“apply 2 days leave next Thu–Fri”", "“who's on leave this week?”", "“prepare August payroll”"],
  },
];

export const MODULE_BY_SLUG = Object.fromEntries(MODULE_PAGES.map((m) => [m.slug, m])) as Record<ModuleKey, ModulePage>;
