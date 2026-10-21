// Fixture data for the Sales dashboard / Inbox preview (round P): shaped like
// the API's answers, dummy names and numbers (no real email content). Rendered
// at /preview/sales?view=dashboard|inbox only with PREVIEW_FIXTURES=1 — the
// Playwright / puppeteer screenshots in the round report come from here.
import type { InboxDashboard, InboxMessage, InboxThread, ShipmentListItem, TradeAlert } from "@/app/portal/shipments/_lib/api";

const TODAY = "2026-10-21";
const file = (name: string, docType: string, docLabel: string, ref: string, stepNo: string, stepTitle: string, status = "planned") => ({ name, docType, docLabel, status, ownerKind: "shipment", ownerId: "s", ref, stepId: `st-${stepNo}`, stepNo, stepTitle });

let n = 0;
const msg = (o: Partial<InboxMessage> & { subject: string; from: string; date: string }): InboxMessage =>
  ({
    id: `m${++n}`,
    receivedAt: o.date,
    direction: "IN",
    counterparty: "MITSUI_SOKO",
    verdict: "SHIPMENT",
    inboxState: "SUGGESTED",
    attachments: [],
    orderId: null,
    shipmentId: null,
    matched: null,
    matchedOrder: null,
    matchedBy: null,
    keys: null,
    planned: [],
    done: [],
    canUndo: false,
    purgeAfter: null,
    error: null,
    reason: null,
    matchReason: null,
    threadFrom: null,
    threadSize: 1,
    linked: null,
    by: null,
    ...o,
  }) as InboxMessage;

const linked = (ref: string, label: string, files: ReturnType<typeof file>[] = [], fields: Array<{ field: string; value: string; status: string }> = []) => ({ orderId: "o", shipmentId: "s", ref, label, files, fields, linkOnly: !files.length && !fields.length });

export const UNPROCESSED: InboxThread[] = [
  {
    id: "t1",
    by: "subject",
    subject: "Re: 10/16 朝 ビレット 納品明細",
    latest: `${TODAY}T08:04:00+09:00`,
    emails: 4,
    files: 4,
    link: { orderId: "o", shipmentId: "s", ref: "#15-1", label: "#15-1 · SUS 6063 300t · B/L 198GX05383", from: "suggested", combined: [] },
    otherCount: 1,
    messages: [
      msg({
        subject: "Re: 10/16 朝 ビレット 納品明細",
        from: '"Mitsui Soko ops" <ops@mitsui-soko.example>',
        date: `${TODAY}T08:04:00+09:00`,
        attachments: [{ index: 0, name: "納品明細_1016.pdf", docType: "DELIVERY_NOTE" }],
        orderId: "o",
        shipmentId: "s",
        matched: "#15-1",
        confidence: "thread",
        threadFrom: "traced",
        reason: { code: "CONFIRM", label: "Confirm match" },
        matchReason: "B/L 198GX05383 is in an earlier email of this thread (2026-10-15)",
        linked: linked("#15-1", "#15-1 · SUS 6063 300t · B/L 198GX05383", [file("納品明細_1016.pdf", "DELIVERY_NOTE", "Delivery note", "#15-1", "14", "Delivery changes")]),
        planned: [{ kind: "file", status: "planned", filename: "納品明細_1016.pdf", docType: "DELIVERY_NOTE", ownerKind: "shipment", ownerId: "s" }],
      }),
      msg({
        subject: "Re: 10/16 朝 ビレット 納品明細",
        from: '"ADH ops" <ops@asiadealhub.example>',
        date: "2026-10-20T17:09:00+09:00",
        direction: "OUT",
        counterparty: "INTERNAL",
        orderId: "o",
        shipmentId: "s",
        matched: "#15-1",
        confidence: "thread",
        threadFrom: "traced",
        reason: { code: "CONFIRM", label: "Confirm match" },
        matchReason: "B/L 198GX05383 is in an earlier email of this thread (2026-10-15)",
        linked: linked("#15-1", "#15-1 · SUS 6063 300t · B/L 198GX05383"),
      }),
      msg({
        subject: "10/16 朝 ビレット 納品明細",
        from: '"Mitsui Soko ops" <ops@mitsui-soko.example>',
        date: "2026-10-15T10:30:00+09:00",
        attachments: [
          { index: 0, name: "COA_9000565680.pdf", docType: "COA" },
          { index: 1, name: "PL_9000565680.pdf", docType: "PL" },
          { index: 2, name: "198GX05383 SCAN.pdf", docType: "BL" },
        ],
        orderId: "o",
        shipmentId: "s",
        matched: "#15-1",
        confidence: "exact",
        matchedBy: "bl",
        reason: { code: "CONFIRM", label: "Confirm match" },
        matchReason: "B/L 198GX05383 is in the attachment",
        linked: linked("#15-1", "#15-1 · SUS 6063 300t · B/L 198GX05383", [
          file("COA_9000565680.pdf", "COA", "Certificate of analysis", "#15-1", "3b", "Shipping documents"),
          file("PL_9000565680.pdf", "PL", "Packing list", "#15-1", "3b", "Shipping documents"),
          file("198GX05383 SCAN.pdf", "BL", "Bill of lading", "#15-1", "3b", "Shipping documents"),
        ]),
        planned: [{ kind: "file", status: "planned" }],
      }),
    ],
  },
  {
    id: "t2",
    by: "headers",
    subject: "RE: 書類送付: アルミビレット11月納入分 (6005 8inch - 40T, 6063HSB 6inch - 32T, 6063 8inch - 40T)",
    latest: "2026-10-20T15:52:00+09:00",
    emails: 2,
    files: 0,
    link: {
      orderId: "o",
      shipmentId: "s",
      ref: "#20-1",
      label: "#20-1 · Kato 6005C 40t · B/L 276956322",
      from: "processed",
      combined: [
        { orderId: "o20", shipmentId: "s20", ref: "#20-1", label: "#20-1 · Kato 6005C 40t" },
        { orderId: "o21", shipmentId: "s21", ref: "#21-1", label: "#21-1 · Kato 6063 HSB 32t" },
        { orderId: "o22", shipmentId: "s22", ref: "#22-1", label: "#22-1 · Kato 6063 40t" },
      ],
    },
    otherCount: 1,
    messages: [
      msg({
        subject: "RE: 書類送付: アルミビレット11月納入分 (6005 8inch - 40T, 6063HSB 6inch - 32T, 6063 8inch - 40T)",
        from: '"Kato purchasing" <purchasing@katokei.example>',
        date: "2026-10-20T15:52:00+09:00",
        counterparty: "KATO",
        inboxState: "UNMATCHED",
        multiOrderIds: ["o20", "o21", "o22"],
        reason: { code: "PICK_SHIPMENT", label: "Pick shipment (thread covers #20-1/#21-1/#22-1)" },
        matchReason: "this thread covers #20-1 / #21-1 / #22-1 — pick the shipment",
      }),
      msg({
        subject: "RE: 書類送付: アルミビレット11月納入分 (6005 8inch - 40T, 6063HSB 6inch - 32T, 6063 8inch - 40T)",
        from: '"ADH ops" <ops@asiadealhub.example>',
        date: "2026-10-19T18:30:00+09:00",
        direction: "OUT",
        counterparty: "INTERNAL",
        inboxState: "SUGGESTED",
        orderId: "o21",
        shipmentId: "s21",
        matched: "#21-1",
        confidence: "thread",
        threadFrom: "followed",
        attachments: [{ index: 0, name: "請求書_加藤軽金属様6063HSB_29.2t.pdf", docType: "INVOICE_SINGLE" }],
        reason: { code: "CONFIRM", label: "Confirm match" },
        matchReason: "this thread covers #20-1 / #21-1 / #22-1; the subject describes #21-1 (grade 6063 HSB, 6 inch, 29 t)",
        linked: linked("#21-1", "#21-1 · Kato 6063 HSB 29.2t · B/L 198GX06445", [file("請求書_加藤軽金属様6063HSB_29.2t.pdf", "INVOICE_SINGLE", "Invoice (single)", "#21", "11", "Invoice #2 / single invoice")]),
        planned: [{ kind: "file", status: "planned" }],
      }),
    ],
  },
  {
    id: "t3",
    by: "subject",
    subject: "Re: ビレット案件（10月納入6005ー120t, 6063ー300t）_アジアディールハブ 22AA198GX06003",
    latest: "2026-10-19T20:35:00+09:00",
    emails: 1,
    files: 1,
    link: { orderId: "o", shipmentId: "s", ref: "#18-2", label: "#18-2 · SUS 6063 300t · B/L 198GX06003", from: "suggested", combined: [] },
    otherCount: 0,
    messages: [
      msg({
        subject: "Re: ビレット案件（10月納入6005ー120t, 6063ー300t）_アジアディールハブ 22AA198GX06003",
        from: '"Mitsui Soko ops" <ops@mitsui-soko.example>',
        date: "2026-10-19T20:35:00+09:00",
        attachments: [{ index: 0, name: "AN_198GX06003.pdf", docType: "ARRIVAL_NOTICE" }],
        orderId: "o",
        shipmentId: "s",
        matched: "#18-2",
        confidence: "exact",
        check: ["qty 120/300 t ≠ 300 / 300.4 t", "grade 6005/6063 ≠ 6063"],
        reason: { code: "CHECK", label: "Check — subject disagrees" },
        matchReason: "B/L 198GX06003 is in the subject",
        linked: linked("#18-2", "#18-2 · SUS 6063 300t · B/L 198GX06003", [file("AN_198GX06003.pdf", "ARRIVAL_NOTICE", "Arrival notice", "#18-2", "9", "A/N & delivery instructions")]),
        planned: [{ kind: "file", status: "planned" }],
      }),
    ],
  },
  {
    id: "t4",
    by: "subject",
    subject: "Re: 諸掛りについて",
    latest: "2026-10-20T10:15:00+09:00",
    emails: 2,
    files: 1,
    link: null,
    otherCount: 0,
    messages: [
      msg({ subject: "Re: 諸掛りについて", from: '"Mitsui Soko accounts" <ar@mitsui-soko.example>', date: "2026-10-20T10:15:00+09:00", inboxState: "UNSURE", attachments: [{ index: 0, name: "諸掛り明細.xlsx", docType: null }], reason: { code: "IS_SHIPMENT", label: "Is it a shipment?" }, matchReason: "no record number in the email or its thread, and the subject fits no single order" }),
      msg({ subject: "諸掛りについて", from: '"Mitsui Soko accounts" <ar@mitsui-soko.example>', date: "2026-10-14T22:44:00+09:00", inboxState: "UNSURE", reason: { code: "IS_SHIPMENT", label: "Is it a shipment?" } }),
    ],
  },
];

export const PROCESSED: InboxThread[] = [
  {
    id: "p1",
    by: "headers",
    subject: "RE: JPYOK_DebitNote-198GX05383-20261020",
    latest: `${TODAY}T09:10:00+09:00`,
    emails: 3,
    files: 1,
    link: { orderId: "o", shipmentId: "s", ref: "#15-1", label: "#15-1 · SUS 6063 300t · B/L 198GX05383", from: "processed", combined: [] },
    otherCount: 0,
    messages: [
      msg({
        subject: "RE: JPYOK_DebitNote-198GX05383-20261020",
        from: '"Wan Hai Lines" <jp.counter@wanhai.example>',
        date: `${TODAY}T09:10:00+09:00`,
        counterparty: "SHIPPING_LINE",
        inboxState: "PROCESSED",
        orderId: "o",
        shipmentId: "s",
        matched: "#15-1",
        confidence: "thread",
        canUndo: false,
        by: { outcome: "AUTO", name: null, at: `${TODAY}T09:11:00+09:00`, autoLabel: "thread" },
        linked: linked("#15-1", "#15-1 · SUS 6063 300t · B/L 198GX05383"),
        done: [{ kind: "subtask", status: "skipped" }],
      }),
      msg({
        subject: "Fw: JPYOK_DebitNote-198GX05383-20261020",
        from: '"ADH ops" <ops@asiadealhub.example>',
        date: "2026-10-19T17:10:00+09:00",
        direction: "OUT",
        counterparty: "INTERNAL",
        inboxState: "PROCESSED",
        orderId: "o",
        shipmentId: "s",
        matched: "#15-1",
        confidence: "exact",
        attachments: [{ index: 0, name: "JPYOK_DebitNote-198GX05383.pdf", docType: "VENDOR_INVOICE" }],
        canUndo: true,
        by: { outcome: "ACCEPTED", name: "Sayaka", at: "2026-10-21T01:12:00.000Z", autoLabel: null },
        linked: linked("#15-1", "#15-1 · SUS 6063 300t · B/L 198GX05383", [file("JPYOK_DebitNote-198GX05383.pdf", "VENDOR_INVOICE", "Vendor invoice", "#15-1", "12", "Transport & storage payment", "done")]),
        done: [{ kind: "file", status: "done", filename: "JPYOK_DebitNote-198GX05383.pdf" }],
      }),
    ],
  },
];

export const DASHBOARD: InboxDashboard = {
  toConfirm: { emails: 6, threads: UNPROCESSED, total: 4 },
  filedAuto: [
    { ...PROCESSED[0].messages[0], threadSubject: PROCESSED[0].subject },
    { ...msg({
      subject: "Copy documents - Asia Deal(Kato) // 454003598 // 198GX06445",
      from: '"Vedanta exports" <exports@vedanta.example>',
      date: "2026-10-20T21:29:00+09:00",
      counterparty: "VEDANTA",
      inboxState: "PROCESSED",
      orderId: "o21",
      shipmentId: "s21",
      matched: "#21-1",
      confidence: "exact",
      canUndo: true,
      attachments: [{ index: 0, name: "COA_9000565690.pdf", docType: "COA" }],
      by: { outcome: "AUTO", name: null, at: "2026-10-20T21:30:00+09:00", autoLabel: "B/L 198GX06445" },
      linked: linked("#21-1", "#21-1 · Kato 6063 HSB 29.2t · B/L 198GX06445", [file("COA_9000565690.pdf", "COA", "Certificate of analysis", "#21-1", "3b", "Shipping documents", "done")]),
      done: [{ kind: "file", status: "done", filename: "COA_9000565690.pdf" }],
    }), threadSubject: null },
  ],
};

export const TASKS: TradeAlert[] = [
  { id: "a1", kind: "TAX_FUNDING", key: "k1", dueAt: "2026-10-10T00:00:00.000Z", title: "#20-1: fund the import tax (ETA 2026-10-24)", detail: "Import-tax funds should be ready 14 days before arrival (step 8).", shipmentId: "s", orderId: "o", supplierOrderId: null, linkUrl: "/portal/shipments/orders/o", status: "DUE", notifiedAt: null },
  { id: "a2", kind: "FREE_TIME", key: "k2", dueAt: "2026-10-19T00:00:00.000Z", title: "#14-1: detention free time ends 2026-10-20", detail: "DET 4 days from ETA 2026-10-16.", shipmentId: "s", orderId: "o", supplierOrderId: null, linkUrl: "/portal/shipments/orders/o", status: "DUE", notifiedAt: null },
  { id: "a3", kind: "AN_EXPECTED", key: "k3", dueAt: "2026-10-22T00:00:00.000Z", title: "#20-1: Arrival Notice expected (ETA 2026-10-24)", detail: "Wan Hai sends the A/N about 2 days before arrival — upload it on step 9.", shipmentId: "s", orderId: "o", supplierOrderId: null, linkUrl: "/portal/shipments/orders/o", status: "SCHEDULED", notifiedAt: null },
];

export const SHIPMENTS: ShipmentListItem[] = [
  { id: "s20", orderId: "o20", ref: "#20-1", blNumber: "276956322", vessel: "WAN HAI 326", voyageNo: "E045", etd: "2026-10-10", eta: "2026-10-24T00:00:00.000Z", actualArrivalDate: null, status: "OPEN", createdAt: "", contract: null, contractLine: null, customer: null, contractNo: null, customerName: "Kato Light Metal Industry Co., Ltd.", productLine: "6005C · 203MM · 40 MT", progress: { done: 7, total: 14 } as never, currentStep: null as never, contractId: null, freeTime: { from: "eta", det: { ends: "2026-10-28", daysLeft: 7 }, dem: { ends: "2026-11-03", daysLeft: 13 } } },
  { id: "s18", orderId: "o18", ref: "#18-1", blNumber: "198GX06003", vessel: "WAN HAI 316", voyageNo: "E052", etd: "2026-10-12", eta: "2026-10-26T00:00:00.000Z", actualArrivalDate: null, status: "OPEN", createdAt: "", contract: null, contractLine: null, customer: null, contractNo: null, customerName: "SUS Co., Ltd.", productLine: "6063 · 203MM · 300 MT", progress: { done: 4, total: 14 } as never, currentStep: null as never, contractId: null, freeTime: { from: "eta", det: { ends: "2026-10-30", daysLeft: 9 }, dem: { ends: "2026-11-05", daysLeft: 15 } } },
  { id: "s30", orderId: "o30", ref: "#30-1", blNumber: null, vessel: null, voyageNo: null, etd: null, eta: "2026-11-15T00:00:00.000Z", actualArrivalDate: null, status: "OPEN", createdAt: "", contract: null, contractLine: null, customer: null, contractNo: null, customerName: "SUS Co., Ltd.", productLine: null, progress: { done: 1, total: 14 } as never, currentStep: null as never, contractId: null, freeTime: null },
];

export const PREVIEW_TODAY = TODAY;
