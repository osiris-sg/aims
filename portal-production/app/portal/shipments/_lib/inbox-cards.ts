// Round W (2026-10-22) — the question cards, the result box and the thread timeline, in words. Pure, no React,
// tested in helpers/inboxCards.test.mjs. English + Japanese follow the browser (uiLang).
import type { InboxAnswer, InboxLang, InboxLinkedFile, InboxMessage, InboxQuestion, InboxQuestionOption, InboxThread } from "./api";

/** The UI language: Japanese when the browser is, else English (the API's cards follow the same `lang`). */
export const uiLangOf = (navigatorLanguage: string | null | undefined): InboxLang => (/^ja\b/i.test(navigatorLanguage ?? "") ? "ja" : "en");

/** The few fixed labels of the cards and the result box. */
export const L = {
  en: {
    createOrder: "New deal → Create order",
    createOrderShort: "Create order",
    notShipment: "Not about a shipment",
    notDeal: "Not a deal",
    askLater: "Ask later",
    undo: "Undo",
    /** Round AB: the list shows 5 cards, then "Show 3 more". */
    showMore: (n: number) => `Show ${n} more`,
    showLess: "Show fewer",
    allDone: "All done. Nothing is waiting for you.",
    earlier: (n: number) => (n === 1 ? "1 earlier email" : `${n} earlier emails`),
    latest: "Latest",
    why: "Why?",
    showFull: "Show full email",
    hideFull: "Hide",
    /** Round AA — the minimal card + the "Choose shipment" dialog (confirm-first). */
    chooseShipment: "Choose shipment",
    answer: "Answer",
    likely: "Likely",
    allShipments: "All shipments",
    selectAll: "Select all",
    searchShipments: "Search by ref, customer, grade, B/L or vessel",
    noShipments: "No open shipment matches.",
    loadingShipments: "Loading shipments…",
    confirm: "Confirm",
    cancel: "Cancel",
    picked: (n: number) => (n === 1 ? "1 shipment picked" : `${n} shipments picked`),
    waiting: "⏳ Waiting for you",
    linkOnly: (ref: string) => `🔗 Linked to ${ref} — no documents filed.`,
    added: (ref: string, summary: string | null) => `✅ Added to ${ref}${summary ? ` — ${summary}` : ""}`,
    hidden: "Not about a shipment",
    general: (c: string | null) => `General${c ? ` — ${c}` : ""}`,
    filed: "filed",
    step: (n: string) => `step ${n}`,
    changeOrder: "Change order",
    thisOneDifferent: "This one is different",
    emails: (n: number) => (n === 1 ? "1 email" : `${n} emails`),
    files: (n: number) => (n === 1 ? "1 file" : `${n} files`),
    seeAll: "See all emails",
    nothing: "No emails waiting.",
    toTimeline: "Open the thread",
  },
  ja: {
    createOrder: "新規案件 → 注文を作成",
    createOrderShort: "注文を作成",
    notShipment: "出荷の件ではない",
    notDeal: "案件ではない",
    askLater: "後で",
    undo: "元に戻す",
    showMore: (n: number) => `他 ${n} 件を表示`,
    showLess: "閉じる",
    allDone: "すべて完了。待ちはありません。",
    earlier: (n: number) => `以前のメール ${n} 件`,
    latest: "最新",
    why: "理由",
    showFull: "メール全文を表示",
    hideFull: "閉じる",
    chooseShipment: "出荷を選ぶ",
    answer: "回答する",
    likely: "候補",
    allShipments: "すべての出荷",
    selectAll: "すべて選択",
    searchShipments: "番号・顧客・グレード・B/L・本船で検索",
    noShipments: "該当する出荷はありません。",
    loadingShipments: "出荷を読み込み中…",
    confirm: "確定",
    cancel: "キャンセル",
    picked: (n: number) => `出荷 ${n} 件を選択`,
    waiting: "⏳ 確認待ち",
    linkOnly: (ref: string) => `🔗 ${ref} に紐付け — 書類の登録なし`,
    added: (ref: string, summary: string | null) => `✅ ${ref} に登録${summary ? ` — ${summary}` : ""}`,
    hidden: "出荷の件ではない",
    general: (c: string | null) => `一般${c ? ` — ${c}` : ""}`,
    filed: "登録",
    step: (n: string) => `ステップ ${n}`,
    changeOrder: "注文を変更",
    thisOneDifferent: "このメールは別",
    emails: (n: number) => `メール ${n} 件`,
    files: (n: number) => `添付 ${n} 件`,
    seeAll: "すべてのメール",
    nothing: "待ちのメールはありません。",
    toTimeline: "スレッドを開く",
  },
} as const;

/** Plain document names ("Commercial invoice (CI)"); the org's own label when it has one, the code as a last resort. */
const DOC_PLAIN: Record<string, string> = {
  CI: "Commercial invoice (CI)",
  PI: "Proforma invoice (PI)",
  PL: "Packing list",
  COA: "COA",
  BL: "Bill of lading (B/L)",
  BL_DRAFT: "B/L draft",
  ARRIVAL_NOTICE: "Arrival notice",
  IMPORT_PERMIT: "Import permit",
  DELIVERY_NOTE: "Delivery note",
  BUNDLE_LIST: "Bundle list (NO.取りリスト)",
  TELEX_RELEASE: "Telex release",
  CONTRACT: "Sales contract",
  COO: "Certificate of origin",
  INSURANCE: "Insurance certificate",
  CONTAINER_PL: "Container packing list",
  DELIVERY_SCHEDULE: "Delivery schedule",
  PAYMENT_PROOF: "Payment proof",
  VENDOR_INVOICE: "Vendor invoice",
  SHIPPING_INSTRUCTIONS: "Shipping instructions",
  OTHER: "Other document",
};
export const docPlainName = (f: Pick<InboxLinkedFile, "docType" | "docLabel">): string => f.docLabel || (f.docType ? (DOC_PLAIN[f.docType] ?? f.docType) : "Document");

export interface ResultLine {
  text: string;
  href: string | null;
}
export interface ResultBox {
  tone: "done" | "link" | "wait" | "off";
  headline: string;
  lines: ResultLine[];
}

const orderHref = (orderId: string | null | undefined, shipmentId?: string | null, stepId?: string | null): string | null => {
  if (!orderId) return null;
  const p = new URLSearchParams();
  if (shipmentId) p.set("shipment", shipmentId);
  if (stepId) p.set("step", stepId);
  const q = p.toString();
  return `/portal/shipments/orders/${orderId}${q ? `?${q}` : ""}`;
};

/** "22AA198GX06003.pdf → Bundle list (NO.取りリスト), step 9" — clickable into the slot on the order page. */
export const fileLine = (f: InboxLinkedFile, lang: InboxLang, orderId: string | null): ResultLine => ({
  text: `${f.name} → ${docPlainName(f)}${f.stepNo ? `, ${L[lang].step(f.stepNo)}` : ""}`,
  href: orderHref(f.ownerKind === "order" ? f.ownerId : orderId, f.ownerKind !== "order" ? f.ownerId : null, f.stepId),
});

/** The result box of ONE message: what was done, in plain words, first. */
export function resultBox(m: Pick<InboxMessage, "inboxState" | "linked" | "general" | "by" | "done" | "backlog">, lang: InboxLang): ResultBox {
  const t = L[lang];
  if (m.inboxState === "HIDDEN") return { tone: "off", headline: t.hidden, lines: [] };
  if (m.inboxState !== "PROCESSED") return { tone: "wait", headline: t.waiting, lines: [] };
  if (!m.linked && m.general) return { tone: "off", headline: t.general(m.general.customerKey), lines: [] };
  if (m.by?.outcome === "IGNORED" && !m.linked) return { tone: "off", headline: t.hidden, lines: [] };
  const l = m.linked;
  if (!l || !l.ref) return { tone: "off", headline: t.hidden, lines: [] };
  const filed = l.files.filter((f) => f.status === "done");
  if (!filed.length) return { tone: "link", headline: t.linkOnly(l.ref), lines: [] };
  const summary = l.label && l.label.startsWith(l.ref) ? l.label.slice(l.ref.length).replace(/^\s*·\s*/, "") : l.label;
  return { tone: "done", headline: t.added(l.ref, summary || null), lines: filed.map((f) => fileLine(f, lang, l.orderId)) };
}

/** A thread whose emails went to different places: one line per email ("21 Oct 19:30 → #15-1 · Bundle list ×3"). */
export function threadResultLines(messages: Array<Pick<InboxMessage, "id" | "date" | "inboxState" | "linked" | "general" | "by" | "done" | "backlog">>, when: (iso: string | null) => string, lang: InboxLang): ResultLine[] {
  const processed = messages.filter((m) => m.inboxState === "PROCESSED" && m.linked?.ref);
  const refs = new Set(processed.map((m) => m.linked!.ref));
  if (refs.size <= 1) return [];
  return [...processed]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((m) => {
      const filed = m.linked!.files.filter((f) => f.status === "done");
      const byType = new Map<string, number>();
      for (const f of filed) byType.set(docPlainName(f), (byType.get(docPlainName(f)) ?? 0) + 1);
      const docs = [...byType.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
      return { text: `${when(m.date)} → ${m.linked!.ref}${docs ? ` · ${docs}` : lang === "ja" ? " · 紐付けのみ" : " · link only"}`, href: orderHref(m.linked!.orderId, m.linked!.shipmentId, filed[0]?.stepId ?? null) };
    });
}

/**
 * The result of a WHOLE thread: when every processed email went to the same place, one box with every filed document
 * (a link-only reply after a filed one still shows "Added to #16-2"); different places → `lines` per email (and the
 * headline is the newest email's).
 */
export function threadResult(messages: Array<Pick<InboxMessage, "id" | "date" | "inboxState" | "linked" | "general" | "by" | "done" | "backlog">>, when: (iso: string | null) => string, lang: InboxLang): ResultBox & { multi: ResultLine[] } {
  const newest = [...messages].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  const base = newest ? resultBox(newest, lang) : { tone: "off" as const, headline: "", lines: [] };
  const multi = threadResultLines(messages, when, lang);
  if (multi.length) return { ...base, multi };
  const processed = messages.filter((m) => m.inboxState === "PROCESSED" && m.linked?.ref);
  const filed = processed.flatMap((m) => m.linked!.files.filter((f) => f.status === "done").map((f) => ({ f, orderId: m.linked!.orderId })));
  if (!filed.length || base.tone !== "link") return { ...base, multi };
  const l = processed.find((m) => m.linked!.files.some((f) => f.status === "done"))!.linked!;
  const summary = l.label && l.ref && l.label.startsWith(l.ref) ? l.label.slice(l.ref.length).replace(/^\s*·\s*/, "") : l.label;
  return { tone: "done", headline: L[lang].added(l.ref!, summary || null), lines: filed.map(({ f, orderId }) => fileLine(f, lang, orderId)), multi };
}

/** The thread's timeline: numbered 1 → n, oldest first, the newest marked "Latest". */
export function timeline<T extends { id: string; date: string }>(messages: T[]): Array<{ n: number; m: T; latest: boolean }> {
  const sorted = [...messages].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return sorted.map((m, i) => ({ n: i + 1, m, latest: i === sorted.length - 1 }));
}

/** One status line for a collapsed thread card: the question title (waiting) or the result headline (done). */
export function cardStatus(t: Pick<InboxThread, "question" | "messages" | "general">, lang: InboxLang): { text: string; tone: ResultBox["tone"] } {
  if (t.question) return { text: t.question.title, tone: "wait" };
  const newest = t.messages[0];
  if (!newest) return { text: "", tone: "off" };
  const r = resultBox(newest, lang);
  return { text: r.headline, tone: r.tone };
}

/** "From 榎本若菜 (Mitsui Soko) · to Sayaka + 9" — the collapsed header line of an opened email. */
export function headerSummary(h: { from: string; to: string; cc: string }, company: string | null, lang: InboxLang): string {
  const name = (s: string) => {
    const m = /^"?([^"<]*?)"?\s*<([^<>]+)>$/.exec(s.trim());
    return (m ? m[1].trim() || m[2].split("@")[0] : s.trim().split("@")[0]) || "—";
  };
  const split = (s: string) => s.split(/\s*[,;]\s*/).map((x) => x.trim()).filter(Boolean);
  const to = [...split(h.to), ...split(h.cc)];
  const first = to[0] ? name(to[0]) : null;
  const more = to.length - 1;
  const from = `${name(h.from)}${company ? ` (${company})` : ""}`;
  if (lang === "ja") return `${from} から${first ? ` · ${first}${more > 0 ? ` +${more}` : ""} 宛` : ""}`;
  return `From ${from}${first ? ` · to ${first}${more > 0 ? ` + ${more}` : ""}` : ""}`;
}

// ── Round AA: the minimal question card + the "Choose shipment" dialog ───────────────────────────────────────────

/** The subject trimmed to ~50 characters with "…"; "(no subject)" when empty. */
export function trimSubject(subject: string | null | undefined, max = 50): string {
  const s = (subject ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "(no subject)";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** The sender's display name from a From header ("Name <a@b>" → Name; a bare address → its local part) — mirrors inbox-threads' fromParts (no runtime import: node --test). */
const senderName = (from: string | null | undefined): string => {
  const s = (from ?? "").trim();
  const m = /^"?([^"<]*?)"?\s*<([^<>]+)>$/.exec(s);
  if (m) return m[1].trim() || m[2].split("@")[0];
  return s.replace(/^<|>$/g, "").split("@")[0] || "—";
};

/** "22 Oct 14:31" (EN, as whenShort) / "10/22 14:31" (JA) in Tokyo — the date of the card line. */
export function whenCard(iso: string | null | undefined, lang: InboxLang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (lang === "ja") {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((p) => [p.type, p.value]));
    return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
  }
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).replace(",", "");
}

/**
 * Round AB: the card's company line, "Vedanta · 22 Oct 14:31" (JA "Vedanta · 10/22 14:31"). The sender COMPANY, else the
 * sender's name from the From header. The subject has its own line now (full, wrapping).
 */
export function cardWhoLine(m: Pick<InboxMessage, "from" | "company" | "date">, lang: InboxLang): string {
  const who = (m.company ?? "").trim() || senderName(m.from);
  const when = whenCard(m.date, lang);
  return [who, when || null].filter(Boolean).join(" · ");
}

/**
 * The ONE line of the opened email's title (round AA pop-up): "From Vedanta · 22 Oct 14:31 · RE: Request for Extension…"
 * (JA: "Vedanta から · 10/22 14:31 · 件名…"). The sender COMPANY, else the sender's name from the From header.
 */
export function cardFromLine(m: Pick<InboxMessage, "from" | "company" | "date" | "subject">, lang: InboxLang): string {
  const who = (m.company ?? "").trim() || senderName(m.from);
  const when = whenCard(m.date, lang);
  const subject = trimSubject(m.subject);
  const head = lang === "ja" ? `${who} から` : `From ${who}`;
  return [head, when || null, subject].filter(Boolean).join(" · ");
}

/** The subject in full for the card, whitespace collapsed; "(no subject)" when empty. */
export const fullSubject = (subject: string | null | undefined): string => (subject ?? "").replace(/\s+/g, " ").trim() || "(no subject)";

/**
 * Round AB: the muted one-line summary under the company line — the stored summary (made once when the email was
 * triaged), else the first line of the email's own text (the preview), else nothing. Display text only.
 */
export function cardSummary(m: Pick<InboxMessage, "summary" | "preview">, max = 160): string | null {
  const stored = (m.summary ?? "").replace(/\s+/g, " ").trim();
  const line = stored || (m.preview ?? "").replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export const optionKey = (o: { orderId: string; shipmentId: string | null }) => `${o.orderId}:${o.shipmentId ?? ""}`;

/** AIMS's LIKELY records: the card's options in their order, deduped by orderId:shipmentId. */
export function likelyOptions(q: Pick<InboxQuestion, "options"> | null | undefined): InboxQuestionOption[] {
  const seen = new Set<string>();
  const out: InboxQuestionOption[] = [];
  for (const o of q?.options ?? []) {
    const k = optionKey(o);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  return out;
}

/** What the person chose in the dialog — shipments ticked, or one of the text options. */
export type ChooseSelection = { kind: "shipments"; targets: Array<{ orderId: string; shipmentId: string | null }> } | { kind: "not_shipment" } | { kind: "later" };

/**
 * The answer payload Confirm sends. Several shipments → `targets` (+ the first as orderId / shipmentId for the old
 * shape); one → the same; "Not about a shipment" → not_deal on a NEW_DEAL card, else not_shipment; "Ask later" →
 * later. Null when nothing is chosen.
 */
export function answerFor(sel: ChooseSelection, questionKind: InboxQuestion["kind"]): InboxAnswer | null {
  if (sel.kind === "later") return { kind: "later" };
  if (sel.kind === "not_shipment") return { kind: questionKind === "NEW_DEAL" ? "not_deal" : "not_shipment" };
  const seen = new Set<string>();
  const targets = sel.targets.filter((t) => {
    const k = optionKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!targets.length) return null;
  return { kind: "record", orderId: targets[0].orderId, shipmentId: targets[0].shipmentId, targets };
}
