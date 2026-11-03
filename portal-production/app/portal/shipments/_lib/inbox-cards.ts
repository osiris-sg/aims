// Round W (2026-10-22) — the question cards, the result box and the thread timeline, in words. Pure, no React,
// tested in helpers/inboxCards.test.mjs. English + Japanese follow the browser (uiLang).
import type { CardChoice, CardEvidence, InboxAnswer, InboxBatch, InboxLang, InboxLinkedFile, InboxMessage, InboxQuestion, InboxQuestionOption, InboxThread } from "./api";

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
    // Round AF: the step-by-step Answer flow.
    isShipmentQ: "Is this email about a shipment?",
    yes: "Yes",
    no: "No",
    whatThen: "What is it then?",
    existingShipment: "It's about an existing shipment",
    askMeLater: "Ask me later",
    whichShipment: "Which shipment?",
    next: "Next",
    back: "Back",
    confirmLink: (n: number, refs: string) => `Link this email${n > 1 ? ` (${n} emails in the thread)` : ""} to ${refs}?`,
    confirmNot: (n: number) => `Mark ${n > 1 ? `these ${n} emails` : "this email"} as not about a shipment?`,
    confirmNotDeal: (n: number) => `Mark ${n > 1 ? `these ${n} emails` : "this email"} as not a deal?`,
    threadFiles: (n: number) => `All files in this thread (${n})`,
    noThreadFiles: "No files in this thread.",
    notForwarded: "Earlier emails in this thread weren't forwarded to AIMS, so their attachments aren't here.",
    preview: "Preview",
    download: "Download",
    // Round AR: several shipments, a target per file, general issues.
    searchShipmentsCast: "Search by #n-s, B/L, cast or bundle no., customer, grade",
    castHits: (k: string) => `On the packing list / COA: ${k}`,
    castNone: (k: string) => `No shipment's packing list / COA has ${k}.`,
    castSearching: "Looking up the cast no.…",
    generalIssue: "Not one shipment: general issue",
    generalIssueHint: "A supplier / customer process or policy change (e.g. a new rule from September supplies)",
    generalProposed: (t: string) => `AIMS's reading: ${t}`,
    whereFiles: "Where does each file go?",
    loadingFiles: "Reading the files…",
    noFiles: "This email has no files.",
    fileTargets: "Shipments",
    fileSlot: "Document",
    dontFile: "Don't file",
    aimsPick: (refs: string, why: string) => `AIMS: ${refs} — ${why}`,
    noMatch: "No exact match — pick the shipment.",
    onSeveral: (refs: string) => `On ${refs} — pick the right one.`,
    outsidePick: "Not one of the shipments you picked",
    inlineImage: "Image in the email body",
    unplaced: (n: number) => (n === 1 ? "1 file still needs a shipment (or Don't file)" : `${n} files still need a shipment (or Don't file)`),
    issueStep: "General issue",
    issueTitle: "Title",
    issueSummaryEn: "Summary (English)",
    issueSummaryJa: "Summary (Japanese)",
    issueOwner: "Supplier / customer",
    issueEffective: "Effective from",
    issueCoaBanner: "Show as a banner on step 4 COA",
    issueLinkPicked: "Link it to the shipments picked",
    issueDrafting: "AIMS is drafting the issue from the email…",
    issueNeedOwner: "Pick the supplier or customer",
    confirmTitle: "Confirm",
    confirmLinkTo: "Link the email to",
    confirmFiles: "Files",
    confirmIssue: "New issue",
    notFiled: "not filed",
    confirmNote: "Nothing is applied until Confirm. Files can be undone; the issue stays on the profile (set it Resolved there).",
    supplier: "Supplier",
    customer: "Customer",
    // Round AS: a file kept waiting.
    keepWaiting: (keys: string) => `Keep it waiting: propose it when a packing list / COA with ${keys} arrives`,
    keptWaiting: "not filed · kept waiting",
    waitingAttach: (name: string, ref: string) => `Attach "${name}" to ${ref}?`,
    waitingAttachNote: "Only this file is filed (in its document slot). Undo takes back just this file.",
    waitingKeep: (ref: string) => `Keep the file waiting? ${ref} won't be proposed again.`,
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
    isShipmentQ: "このメールは出荷の件ですか？",
    yes: "はい",
    no: "いいえ",
    whatThen: "では何の件ですか？",
    existingShipment: "既存の出荷の件",
    askMeLater: "後で聞いてください",
    whichShipment: "どの出荷ですか？",
    next: "次へ",
    back: "戻る",
    confirmLink: (n: number, refs: string) => `このメール${n > 1 ? `（スレッドのメール ${n} 件）` : ""}を ${refs} に紐付けますか？`,
    confirmNot: (n: number) => `${n > 1 ? `この ${n} 件のメール` : "このメール"}を「出荷の件ではない」にしますか？`,
    confirmNotDeal: (n: number) => `${n > 1 ? `この ${n} 件のメール` : "このメール"}を「案件ではない」にしますか？`,
    threadFiles: (n: number) => `このスレッドのすべてのファイル（${n}）`,
    noThreadFiles: "このスレッドにファイルはありません。",
    notForwarded: "このスレッドの以前のメールはAIMSに転送されていないため、その添付はここにありません。",
    preview: "プレビュー",
    download: "ダウンロード",
    searchShipmentsCast: "#番号・B/L・キャスト／バンドル番号・顧客・グレードで検索",
    castHits: (k: string) => `パッキングリスト／COAに記載：${k}`,
    castNone: (k: string) => `${k} を含むパッキングリスト／COAはありません。`,
    castSearching: "キャスト番号を検索中…",
    generalIssue: "特定の出荷ではない：全般的な課題",
    generalIssueHint: "サプライヤー／顧客の手順・方針の変更（例：9月供給分からの新ルール）",
    generalProposed: (t: string) => `AIMSの読み取り：${t}`,
    whereFiles: "各ファイルの登録先は？",
    loadingFiles: "ファイルを読み込み中…",
    noFiles: "このメールにファイルはありません。",
    fileTargets: "出荷",
    fileSlot: "書類",
    dontFile: "登録しない",
    aimsPick: (refs: string, why: string) => `AIMS：${refs} — ${why}`,
    noMatch: "完全一致なし — 出荷を選んでください。",
    onSeveral: (refs: string) => `${refs} に記載 — 正しい方を選んでください。`,
    outsidePick: "選択した出荷以外です",
    inlineImage: "本文内の画像",
    unplaced: (n: number) => `出荷が未選択のファイルが ${n} 件あります（または「登録しない」）`,
    issueStep: "全般的な課題",
    issueTitle: "タイトル",
    issueSummaryEn: "概要（英語）",
    issueSummaryJa: "概要（日本語）",
    issueOwner: "サプライヤー／顧客",
    issueEffective: "適用開始",
    issueCoaBanner: "ステップ4（COA）にバナー表示",
    issueLinkPicked: "選択した出荷に紐付ける",
    issueDrafting: "AIMSがメールから課題を作成中…",
    issueNeedOwner: "サプライヤーまたは顧客を選んでください",
    confirmTitle: "確認",
    confirmLinkTo: "メールの紐付け先",
    confirmFiles: "ファイル",
    confirmIssue: "新しい課題",
    notFiled: "登録しない",
    confirmNote: "確定するまで何も反映されません。ファイルは元に戻せます。課題はプロフィールに残ります（そこで「解決済み」にします）。",
    supplier: "サプライヤー",
    customer: "顧客",
    keepWaiting: (keys: string) => `待機させる：${keys} を含むパッキングリスト／COAが届いたら提案`,
    keptWaiting: "登録しない · 待機中",
    waitingAttach: (name: string, ref: string) => `「${name}」を ${ref} に添付しますか？`,
    waitingAttachNote: "このファイルだけを書類スロットに登録します。元に戻すとこのファイルだけが外れます。",
    waitingKeep: (ref: string) => `ファイルを待機のままにしますか？ ${ref} は今後提案されません。`,
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
const DOC_PLAIN_JA: Record<string, string> = {
  CI: "コマーシャルインボイス（CI）",
  PI: "プロフォーマインボイス（PI）",
  PL: "パッキングリスト",
  COA: "COA",
  BL: "船荷証券（B/L）",
  BL_DRAFT: "B/Lドラフト",
  ARRIVAL_NOTICE: "到着案内",
  IMPORT_PERMIT: "輸入許可書",
  DELIVERY_NOTE: "納品書",
  BUNDLE_LIST: "バンドルリスト（NO.取りリスト）",
  TELEX_RELEASE: "テレックスリリース",
  CONTRACT: "売買契約書",
  COO: "原産地証明書",
  INSURANCE: "保険証券",
  CONTAINER_PL: "コンテナパッキングリスト",
  DELIVERY_SCHEDULE: "納入スケジュール",
  PAYMENT_PROOF: "支払証明",
  VENDOR_INVOICE: "仕入先請求書",
  SHIPPING_INSTRUCTIONS: "出庫・納入依頼書",
  OTHER: "その他の書類",
};
export const docPlainName = (f: Pick<InboxLinkedFile, "docType" | "docLabel">, lang: InboxLang = "en"): string =>
  f.docLabel || (f.docType ? ((lang === "ja" ? DOC_PLAIN_JA : DOC_PLAIN)[f.docType] ?? f.docType) : lang === "ja" ? "書類" : "Document");

export interface ResultLine {
  text: string;
  href: string | null;
}
export interface ResultBox {
  tone: "done" | "link" | "wait" | "off";
  headline: string;
  lines: ResultLine[];
}

const orderHref = (orderId: string | null | undefined, shipmentId?: string | null, stepId?: string | null, file?: string | null): string | null => {
  if (!orderId) return null;
  const p = new URLSearchParams();
  if (shipmentId) p.set("shipment", shipmentId);
  if (stepId) p.set("step", stepId);
  if (file) p.set("file", file); // round AF: the order page highlights this file in the opened step
  const q = p.toString();
  return `/portal/shipments/orders/${orderId}${q ? `?${q}` : ""}`;
};

/** "22AA198GX06003.pdf → Bundle list (NO.取りリスト), step 9" — clickable into the slot on the order page. */
export const fileLine = (f: InboxLinkedFile, lang: InboxLang, orderId: string | null): ResultLine => ({
  text: `${f.name} → ${docPlainName(f, lang)}${f.stepNo ? `, ${L[lang].step(f.stepNo)}` : ""}`,
  href: orderHref(f.ownerKind === "order" ? f.ownerId : orderId, f.ownerKind !== "order" ? f.ownerId : null, f.stepId, f.name),
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
      for (const f of filed) byType.set(docPlainName(f, lang), (byType.get(docPlainName(f, lang)) ?? 0) + 1);
      const docs = [...byType.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
      return { text: `${when(m.date)} → ${m.linked!.ref}${docs ? ` · ${docs}` : lang === "ja" ? " · 紐付けのみ" : " · link only"}`, href: orderHref(m.linked!.orderId, m.linked!.shipmentId, filed[0]?.stepId ?? null, filed[0]?.name ?? null) };
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

/** Round AD (owner: no "…" anywhere): the subject in full, whitespace collapsed; "(no subject)" when empty. The `max` is ignored. */
export function trimSubject(subject: string | null | undefined, _max = 50, lang: InboxLang = "en"): string {
  const s = (subject ?? "").replace(/\s+/g, " ").trim();
  return s || (lang === "ja" ? "（件名なし）" : "(no subject)");
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
export const fullSubject = (subject: string | null | undefined, lang: InboxLang = "en"): string => (subject ?? "").replace(/\s+/g, " ").trim() || (lang === "ja" ? "（件名なし）" : "(no subject)");

/**
 * Round AB: the muted one-line summary under the company line — the stored summary (made once when the email was
 * triaged), else the first line of the email's own text (the preview), else nothing. Display text only.
 */
export function cardSummary(m: Pick<InboxMessage, "summary" | "preview">, _max = 160): string | null {
  const stored = (m.summary ?? "").replace(/\s+/g, " ").trim();
  const line = stored || (m.preview ?? "").replace(/\s+/g, " ").trim();
  return line || null; // round AD: never cut — the card wraps
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

// ── Round BB: the card's best guess, evidence and batches ────────────────────────────────────────────────────────

/** One piece of an evidence line: plain, or the highlighted `mark`. */
export type EvidencePart = { text: string; mark: boolean };

/**
 * An evidence line split around its `mark` (the first exact match, else the first case-insensitive one) so the card
 * can highlight it. No mark, or a mark not in the text → the whole text, unhighlighted. Empty pieces are dropped.
 */
export function evidenceParts(text: string, mark: string | null | undefined): EvidencePart[] {
  const m = (mark ?? "").trim();
  if (!text) return [];
  let at = m ? text.indexOf(m) : -1;
  if (m && at < 0) at = text.toLowerCase().indexOf(m.toLowerCase());
  if (at < 0) return [{ text, mark: false }];
  return [
    { text: text.slice(0, at), mark: false },
    { text: text.slice(at, at + m.length), mark: true },
    { text: text.slice(at + m.length), mark: false },
  ].filter((p) => p.text.length > 0);
}

/** The file chip of an evidence line: the attachment name when the text doesn't already say it. */
export const evidenceFile = (e: Pick<CardEvidence, "text" | "file">): string | null => {
  const f = (e.file ?? "").trim();
  return f && !e.text.includes(f) ? f : null;
};

/** What answering a choice does: send an answer, open the dialog (normally / on a new shipment for an order), or the order form. */
export type ChoiceAction = { do: "answer"; answer: InboxAnswer } | { do: "choose" } | { do: "new_shipment"; orderId: string } | { do: "create_order" };

/**
 * Round BB: "Yes" (or an alternative) on a card. A record → linked at once; a new shipment → the dialog opens on
 * "Which shipment?" with the new-shipment form for that order; a general issue → the dialog (it pre-ticks AIMS's
 * issue); not a shipment → answered at once; a new deal → the order form. A record / new shipment without an order
 * falls back to the dialog.
 */
export function choiceAction(c: Pick<CardChoice, "kind" | "orderId" | "shipmentId">): ChoiceAction {
  switch (c.kind) {
    case "record":
      return c.orderId ? { do: "answer", answer: { kind: "record", orderId: c.orderId, shipmentId: c.shipmentId, targets: [{ orderId: c.orderId, shipmentId: c.shipmentId }] } } : { do: "choose" };
    case "new_shipment":
      return c.orderId ? { do: "new_shipment", orderId: c.orderId } : { do: "choose" };
    case "not_shipment":
      return { do: "answer", answer: { kind: "not_shipment" } };
    case "new_deal":
      return { do: "create_order" };
    default:
      return { do: "choose" };
  }
}

/** The card's headline: the concrete question, else the old title. */
export const cardHeadline = (q: Pick<InboxQuestion, "title" | "headline">): string => (q.headline ?? "").trim() || q.title;

/** One block of the question list: a single card, or a batch of similar cards answered together. */
export type QuestionSegment<T> = { kind: "one"; t: T } | { kind: "batch"; key: string; title: string; threads: T[] };

/**
 * Round BB: the question list in order. Cards handed to the admins come FIRST for an admin (they are the admin's to
 * answer) and LAST for everyone else (they wait on the admins); otherwise the API's order. A batch renders where its
 * first card would, holding its cards in list order; a batch with fewer than 2 cards in the list renders them as
 * single cards.
 */
export function questionSegments<T extends { id: string; question?: Pick<InboxQuestion, "asked"> | null }>(threads: T[], batches: InboxBatch[] | null | undefined, admin: boolean): Array<QuestionSegment<T>> {
  const asked = (t: T) => !!t.question?.asked;
  const ordered = [...threads].sort((a, b) => (admin ? Number(asked(b)) - Number(asked(a)) : Number(asked(a)) - Number(asked(b))));
  const present = new Set(ordered.map((t) => t.id));
  const batchOf = new Map<string, InboxBatch>();
  for (const b of batches ?? []) {
    const ids = b.threadIds.filter((id) => present.has(id) && !batchOf.has(id));
    if (ids.length < 2) continue;
    for (const id of ids) batchOf.set(id, b);
  }
  const out: Array<QuestionSegment<T>> = [];
  const done = new Set<string>();
  for (const t of ordered) {
    const b = batchOf.get(t.id);
    if (!b) {
      out.push({ kind: "one", t });
      continue;
    }
    if (done.has(b.key)) continue;
    done.add(b.key);
    out.push({ kind: "batch", key: b.key, title: b.title, threads: ordered.filter((x) => batchOf.get(x.id) === b) });
  }
  return out;
}

/** A batch card is ticked by default (and tickable at all) when AIMS's guess is an existing record with an order and the viewer may answer it (a card handed to the admins waits for them). */
export const batchTickable = (q: Pick<InboxQuestion, "guess" | "asked"> | null | undefined, admin: boolean): boolean => !!q?.guess && q.guess.kind === "record" && !!q.guess.orderId && (admin || !q.asked);
