// Round T — the email view's safety helpers (pure; node-tested in helpers/emailHtml.test.mjs).
// Round W (Part C.1) — emails render in OUR style, not the sender's: `restyleEmailHtml` strips the email's
// own CSS / colours / fonts / layout, removes client junk (Outlook sender banners, [EXTERNAL] tags, tracking
// pixels, spacer tables) and splits the signature / disclaimer off, so the text follows the app theme in dark
// and light. "Show original" renders the sanitised HTML as it came (styles kept) on a white page.
//
// An email's HTML is untrusted data. The API already removed scripts / forms / meta / link and turned every
// remote src into data-aims-src. On the client it is (1) sanitised again with DOMPurify (an allowlist of
// formatting tags, no event handlers, no forms, no external resources), (2) rendered in an <iframe sandbox="">
// (no scripts, no forms, no top-navigation, no same-origin), and (3) remote images stay blocked until the
// person clicks "Load images", which restores data-aims-src → src for https images only.
//
// Links: the frame is sandboxed with NO allowances, so a click inside it can never navigate or open a popup —
// nothing inside the email is followed. The cleaned view therefore prints the link's hostname in small muted
// text after the link (a reader sees where it points), and `restyleEmailHtml` also returns the external links
// so the host page can list them under the email and open one only after a confirm ("Open example.com?").
// That is the simplest approach that gives a real confirm without running any script inside the frame.
//
// Everything here works on the HTML STRING (no DOMParser / jsdom) so the node tests run on plain node.

/** DOMPurify config: formatting + tables + inline images only. */
export const PURIFY_CONFIG = {
  ALLOWED_TAGS: ["a", "b", "strong", "i", "em", "u", "s", "p", "br", "div", "span", "blockquote", "pre", "code", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "img", "hr", "font", "small", "sub", "sup", "center"],
  ALLOWED_ATTR: ["href", "title", "alt", "src", "width", "height", "style", "colspan", "rowspan", "align", "valign", "border", "cellpadding", "cellspacing", "bgcolor", "color", "size", "face", "data-aims-src", "data-aims-srcset", "data-aims-background"],
  ALLOWED_URI_REGEXP: /^(?:(?:https|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp);base64,|cid:|#)/i,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "meta", "link", "base", "svg", "math"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "formaction", "action", "srcdoc"],
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: true,
} as const;

/** "Load images": restore blocked https images (never javascript:, never http on a https page, never file:). */
export function restoreRemoteImages(html: string): string {
  return html.replace(/data-aims-(src|srcset)=("([^"]*)"|'([^']*)')/gi, (m, attr: string, _q: string, d: string, s: string) => {
    const v = (d ?? s ?? "").trim();
    return /^https:\/\//i.test(v) || (attr === "srcset" && /^https:\/\//i.test(v)) ? `${attr}="${v.replace(/"/g, "")}"` : m;
  });
}

/** Attributes left on the iframe: nothing allowed at all (no scripts, no forms, no popups, no same-origin). */
// Round AF (owner: one scroll bar): the frame runs ONE script of ours (nonce-bound by the frame's CSP) that reports its
// content height, so the frame grows to its content and the dialog keeps the single scroll. No same-origin, no forms,
// no popups, no navigation — the email's own scripts never survive DOMPurify, and the CSP allows only our nonce.
export const FRAME_SANDBOX = "allow-scripts";

/** Plain text → safe HTML for the frame (links stay text; line breaks kept). */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre style="white-space:pre-wrap;word-break:break-word;font:14px/1.5 system-ui,sans-serif;margin:0">${esc}</pre>`;
}

/** The app's reading font stack: system UI first, then the Japanese faces (macOS, Noto, Windows). */
export const FRAME_FONT_STACK = "system-ui,-apple-system,'Segoe UI',Roboto,'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',Meiryo,sans-serif";

/**
 * The frame document: a base that blocks navigation + the body. The cleaned view follows the host theme and
 * carries our typography / table style; `original: true` ("Show original") keeps the email's own styles and
 * always uses a white page, because the sender's colours were designed for one (black text on our dark
 * background was the bug this replaces).
 */
export function frameDocument(bodyHtml: string, dark: boolean, opts?: { original?: boolean; frameId?: string }): string {
  const original = !!opts?.original;
  const nonce = opts?.frameId ? `n${opts.frameId.replace(/[^a-z0-9]/gi, "")}` : null;
  const resize = nonce ? `<script nonce="${nonce}">(function(){var id=${JSON.stringify(opts!.frameId)};function send(){try{parent.postMessage({type:"aims-email-frame",id:id,height:Math.ceil(document.documentElement.scrollHeight)},"*")}catch(e){}}if(window.ResizeObserver){new ResizeObserver(send).observe(document.documentElement)}window.addEventListener("load",send);setTimeout(send,50);setTimeout(send,400);send()})()</script>` : "";
  const d = dark && !original;
  const fg = d ? "#e6e6e6" : "#1a1a1a";
  const bg = d ? "#121212" : "#ffffff";
  const link = d ? "#8ab4f8" : "#1a5fb4";
  const divider = d ? "#3a3a3a" : "#d9d9d9";
  const muted = d ? "#9a9a9a" : "#6b6b6b";
  const base = `body{margin:12px;color:${fg};background:${bg};font:14px/1.6 ${FRAME_FONT_STACK};word-break:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:${link}}blockquote{border-left:3px solid ${divider};margin:8px 0;padding-left:10px;color:${muted}}`;
  const ours = original
    ? ""
    : `p{margin:0 0 .5em}h1,h2,h3,h4,h5,h6{margin:.6em 0 .3em;font-weight:600;line-height:1.3}h1{font-size:1.3em}h2{font-size:1.2em}h3{font-size:1.1em}h4,h5,h6{font-size:1em}ul,ol{margin:.3em 0 .6em;padding-left:1.4em}pre{white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}hr{border:0;border-top:1px solid ${divider};margin:.8em 0}table{border-collapse:collapse;width:auto}td,th{padding:2px 8px 2px 0;vertical-align:top;text-align:left}th{font-weight:600}table.aims-grid td,table.aims-grid th{border-bottom:1px solid ${divider};padding:4px 8px}a{text-decoration:underline}.aims-host{font-size:11px;color:${muted};margin-left:4px;white-space:nowrap}.aims-host::before{content:"("}.aims-host::after{content:")"}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid: https:; style-src 'unsafe-inline'; font-src data:${nonce ? `; script-src 'nonce-${nonce}'` : ""}"><base target="_blank"><style>${base}${ours}</style></head><body>${bodyHtml}${resize}</body></html>`;
}

/** Humanised size for the attachment list. */
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ───────────────────────────── Round W: restyling (string-based, pure) ─────────────────────────────

export type EmailLink = { href: string; text: string; host: string };

export type RestyledEmail = {
  /** The body in our style (structure only; links decorated). */
  html: string;
  /** The trailing signature / disclaimer block, restyled, or null when none was found. */
  signatureHtml: string | null;
  /** Human labels of what was cleaned away, e.g. "sender banner", "2 tracking pixels", "signature". */
  removed: string[];
  /** External (http/https) links in the body + signature, in order, deduped — for the host-side list. */
  links: EmailLink[];
};

/** Tags → text (entities decoded, whitespace collapsed). Used for "is this block empty" and line heuristics. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;| /gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/[​‌‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** One attribute's value from an attribute string (`href="x"` / `href='x'` / `href=x`), or null. */
function attrValue(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** From an open tag at `start` (html[start] === "<"), the index just past the matching close tag (nesting-aware; end of string if unclosed). */
function elementEnd(html: string, start: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) {
      depth--;
      if (depth <= 0) return m.index + m[0].length;
    } else if (!/\/>$/.test(m[0])) depth++;
  }
  return html.length;
}

/** The smallest block (td/th/p/div/li, else table) enclosing `idx` whose text is short enough to be the banner itself. */
function enclosingShortBlock(html: string, idx: number, maxText: number): { start: number; end: number } | null {
  const opens: Array<{ start: number; tag: string }> = [];
  const re = /<(td|th|p|div|li|table)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && m.index < idx) opens.push({ start: m.index, tag: m[1].toLowerCase() });
  for (let i = opens.length - 1; i >= 0 && i >= opens.length - 40; i--) {
    const end = elementEnd(html, opens[i].start, opens[i].tag);
    if (end <= idx) continue;
    return stripTags(html.slice(opens[i].start, end)).length <= maxText ? { start: opens[i].start, end } : null;
  }
  return null;
}

/** Remove every element `tag` whose inner text is empty and which holds no image (spacer rows / tables / paragraphs). `replacement` is put in its place. */
function removeEmptyElements(html: string, tag: string, replacement = ""): { html: string; count: number } {
  let count = 0;
  let from = 0;
  const re = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  for (let guard = 0; guard < 5000; guard++) {
    re.lastIndex = from;
    const m = re.exec(html);
    if (!m) break;
    const end = elementEnd(html, m.index, tag);
    const inner = html.slice(m.index + m[0].length, end);
    if (!stripTags(inner) && !/<img\b/i.test(inner)) {
      html = html.slice(0, m.index) + replacement + html.slice(end);
      count++;
      from = m.index;
    } else from = m.index + 1;
  }
  return { html, count };
}

/** A 1×1 / ≤2px / hidden image is a tracking pixel (or a spacer), not content. */
export function isTrackingPixel(imgTag: string): boolean {
  const style = attrValue(imgTag, "style") ?? "";
  const dim = (name: string): number | null => {
    const a = attrValue(imgTag, name);
    const fromAttr = a != null && /^\s*\d+(\.\d+)?(px)?\s*$/i.test(a) ? parseFloat(a) : null;
    const s = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "i").exec(style);
    return fromAttr ?? (s ? parseFloat(s[1]) : null);
  };
  const w = dim("width");
  const h = dim("height");
  if ((w != null && w <= 2) || (h != null && h <= 2)) return true;
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

const BANNER_RES: RegExp[] = [
  /You don(?:'|’|&#39;|&rsquo;|&#8217;)t often get email from/i,
  /Some people who received this message don(?:'|’|&#39;|&rsquo;|&#8217;)t often get email from/i,
  /aka\.ms\/LearnAboutSenderIdentification/i,
  /このメールの送信者からメールを受け取ることはあまりありません/,
  /この送信者からメールを受け取ることはあまりありません/,
  /CAUTION:?\s*This (?:e-?mail|message) (?:originated|was sent|came) from outside/i,
];

const EXTERNAL_TAG_RE = /\[\s*(?:EXTERNAL|EXT|External|external|外部)\s*\]\s*|【\s*外部(?:メール)?\s*】\s*|\[\s*EXTERNAL\s+(?:EMAIL|SENDER)\s*\]\s*/g;

/**
 * Remove client junk: Outlook "You don't often get email from …" banners (en + ja) and "CAUTION: external"
 * banners (the enclosing block goes), "[EXTERNAL]" / "【外部】" tags, tracking pixels, spacer tables / empty
 * rows, and runs of &nbsp;-only paragraphs (each becomes one line break; runs collapse).
 */
export function stripClientJunk(html: string): { html: string; removed: string[] } {
  const removed: string[] = [];
  let h = html.replace(/<!--[\s\S]*?-->/g, "");

  // Sender / external banners: delete the smallest short block around the phrase (else the sentence to the next break).
  let banners = 0;
  for (const re of BANNER_RES) {
    for (let guard = 0; guard < 20; guard++) {
      const m = re.exec(h);
      if (!m) break;
      const block = enclosingShortBlock(h, m.index, 400);
      if (block) h = h.slice(0, block.start) + h.slice(block.end);
      else {
        const stop = /<br\s*\/?>|<\/(?:p|div|td|tr|table|li)>/gi;
        stop.lastIndex = m.index;
        const s = stop.exec(h);
        h = h.slice(0, m.index) + h.slice(s ? s.index : h.length);
      }
      banners++;
    }
  }
  if (banners) removed.push("sender banner");

  // [EXTERNAL] / 【外部】 tags.
  const tags = (h.match(EXTERNAL_TAG_RE) ?? []).length;
  if (tags) {
    h = h.replace(EXTERNAL_TAG_RE, "");
    removed.push("external tag");
  }

  // Tracking pixels / hidden images.
  let pixels = 0;
  h = h.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!isTrackingPixel(tag)) return tag;
    pixels++;
    return "";
  });
  if (pixels) removed.push(pixels === 1 ? "tracking pixel" : `${pixels} tracking pixels`);

  // Spacer rows / tables (text-less, image-less), then empty paragraphs → one line break; runs collapse.
  let spacers = 0;
  let paras = 0;
  for (let pass = 0; pass < 3; pass++) {
    let changed = 0;
    for (const tag of ["tr", "table"]) {
      const r = removeEmptyElements(h, tag);
      h = r.html;
      changed += r.count;
      if (tag === "table") spacers += r.count;
    }
    for (const tag of ["p", "div"]) {
      const r = removeEmptyElements(h, tag, "<br>");
      h = r.html;
      changed += r.count;
      paras += r.count;
    }
    if (!changed) break;
  }
  if (spacers) removed.push(spacers === 1 ? "spacer table" : `${spacers} spacer tables`);
  if (paras) removed.push("blank lines");
  h = collapseBreaks(h);
  return { html: h, removed };
}

/** Runs of 3+ line breaks become 2; leading / trailing breaks go. */
export function collapseBreaks(html: string): string {
  return html
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br><br>")
    .replace(/^(?:\s*<br\s*\/?>)+/i, "")
    .replace(/(?:<br\s*\/?>\s*)+$/i, "");
}

/** Attributes we keep per tag in the cleaned view; every other tag keeps none (no style / colour / size / width). */
const KEEP_ATTRS: Record<string, string[]> = {
  a: ["href", "title"],
  img: ["src", "data-aims-src", "data-aims-srcset", "alt", "width", "height", "title"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
};

/**
 * Strip the sender's presentation: every `style` / `bgcolor` / `color` / `face` / `size` / `background` /
 * `border` / `align` / `width` / `height` (width / height stay on images only), `<font>` and `<center>`
 * unwrapped. Tables that look like data (≥ 2 rows and ≥ 2 cells) get `class="aims-grid"` for thin dividers.
 */
export function stripPresentation(html: string): string {
  let h = html.replace(/<\/?(?:font|center)\b[^>]*>/gi, "");
  h = h.replace(/<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g, (_m, tag: string, attrs: string, slash: string) => {
    const t = tag.toLowerCase();
    const keep = KEEP_ATTRS[t];
    const kept: string[] = [];
    if (keep) {
      const re = /([^\s=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
      let a: RegExpExecArray | null;
      while ((a = re.exec(attrs))) {
        const n = a[1].toLowerCase();
        if (keep.includes(n)) kept.push(a[2] != null ? `${n}=${a[2]}` : n);
      }
    }
    return `<${t}${kept.length ? " " + kept.join(" ") : ""}${slash ? "/" : ""}>`;
  });
  return markGridTables(h);
}

/** `<table>` → `<table class="aims-grid">` when it has ≥ 2 rows and its first row has ≥ 2 cells (a data table, not a layout shell). */
function markGridTables(html: string): string {
  let out = "";
  let pos = 0;
  const re = /<table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const end = elementEnd(html, m.index, "table");
    const inner = html.slice(m.index + m[0].length, end);
    const rows = inner.match(/<tr\b/gi)?.length ?? 0;
    const firstRowEnd = inner.search(/<\/tr>/i);
    const firstRow = firstRowEnd >= 0 ? inner.slice(0, firstRowEnd) : inner;
    const cells = firstRow.match(/<t[dh]\b/gi)?.length ?? 0;
    out += html.slice(pos, m.index) + (rows >= 2 && cells >= 2 ? '<table class="aims-grid">' : "<table>");
    pos = m.index + m[0].length;
  }
  return out + html.slice(pos);
}

/** Hostname of an http(s) link, or null for mailto: / tel: / anchors. */
export function linkHost(href: string): string | null {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(href.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Links in our style: every `<a>` opens in a new tab (`target="_blank" rel="noopener noreferrer"`), external
 * links print their hostname after the text in small muted text (unless the text already shows it), anchors
 * without an href are unwrapped. Returns the external links for the host-side list.
 */
export function decorateLinks(html: string): { html: string; links: EmailLink[] } {
  const links: EmailLink[] = [];
  const seen = new Set<string>();
  const out = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
    const href = (attrValue(attrs, "href") ?? "").trim();
    if (!href) return inner;
    const title = attrValue(attrs, "title");
    const safeHref = href.replace(/"/g, "&quot;");
    const a = `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title.replace(/"/g, "&quot;")}"` : ""}>${inner}</a>`;
    const host = linkHost(href);
    if (!host) return a;
    const text = stripTags(inner);
    if (!seen.has(href) && links.length < 100) {
      seen.add(href);
      links.push({ href, text: text || host, host });
    }
    return text.toLowerCase().includes(host) ? a : `${a}<span class="aims-host">${host}</span>`;
  });
  return { html: out, links };
}

// ── signature / disclaimer split ──
type Line = { start: number; text: string };

/** The email as lines: the text between block boundaries (br / hr / closing p, div, td, tr, li, headings…), with where each starts in the html. */
function lines(html: string): Line[] {
  const out: Line[] = [];
  const re = /<br\s*\/?>|<hr\b[^>]*>|<\/(?:p|div|tr|td|th|li|h[1-6]|blockquote|pre|table|ul|ol)>/gi;
  let pos = 0;
  let m: RegExpExecArray | null;
  const push = (s: number, e: number) => {
    const text = stripTags(html.slice(s, e));
    if (text) out.push({ start: s, text });
  };
  while ((m = re.exec(html))) {
    push(pos, m.index);
    if (/^<hr/i.test(m[0])) out.push({ start: m.index, text: "---" });
    pos = m.index + m[0].length;
  }
  push(pos, html.length);
  return out;
}

const SIG_DELIM = /^(?:--|—|–)\s*$/;
const RULE_LINE = /^[-_=*─━＿ー~～]{3,}$/;
const SIGNOFF = /^(?:best regards|kind regards|warm regards|regards|rgds|thanks|thank you|many thanks|sincerely|cheers|よろしくお願い|宜しくお願い|敬具|以上|お疲れ様|ありがとうございます|お世話になっております)/i;
const CONTACT = /(?:\btel\b|\bfax\b|\bphone\b|\bmobile\b|\bmob\b|\bcell\b|\bhp\b|\bext\b|\bdirect\b|電話|携帯|直通|〒|住所|e-?mail|www\.|https?:\/\/|[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d\s\-().]{7,}\d|\bpte\b|\bltd\b|\binc\b|\bllc\b|\bgmbh\b|株式会社|有限会社|\bco\.,?\s*ltd)/i;
const DISCLAIMER = /confidential|機密|このメール|この電子メール|本メール|privileged|intended (?:solely |only )?for|if you (?:are not|have received)|unsubscribe|誤って|破棄|免責|disclaimer/i;

/**
 * Split the trailing signature / disclaimer off the body. Heuristics, in order: a `--` delimiter line; else the
 * trailing run of short lines (≤ 70 chars) / disclaimer sentences that has ≥ 2 contact-ish hits (phone / fax /
 * URL / email / 〒 / 住所 / company suffix) or a disclaimer; a horizontal rule inside that run starts the
 * signature; the sign-off ("Regards," / よろしくお願いいたします) stays in the body. The first line never moves.
 */
export function splitSignature(html: string): { body: string; signature: string | null } {
  const L = lines(html);
  const n = L.length;
  if (n < 3) return { body: html, signature: null };
  let cut = L.findIndex((l, i) => i > 0 && SIG_DELIM.test(l.text));
  if (cut < 0) {
    let i = n - 1;
    let hits = 0;
    let ruleAt = -1;
    while (i > 0) {
      const t = L[i].text;
      if (RULE_LINE.test(t)) {
        ruleAt = i;
        i--;
        continue;
      }
      const disc = DISCLAIMER.test(t);
      // A sentence ends the scan ("Please call me on +65 … to discuss.") — but "Hoei Trading Co., Ltd." is a company line.
      const sentence = /[。！？]$/.test(t) || (/[.!?]$/.test(t) && t.split(/\s+/).length >= 5 && !/\b(?:ltd|inc|co|corp|pte|llc|gmbh|bhd|sdn|kk|k\.k)\.$/i.test(t));
      if (!disc && (t.length > 70 || sentence)) break;
      if (disc || CONTACT.test(t)) hits++;
      i--;
    }
    const tailStart = i + 1;
    const tail = L.slice(tailStart);
    const hasDisc = tail.some((l) => DISCLAIMER.test(l.text));
    if (ruleAt >= tailStart && hits >= 1) cut = ruleAt;
    else if (tail.length >= 2 && (hits >= 2 || (hits >= 1 && hasDisc))) {
      let first = tailStart;
      while (first < n && !CONTACT.test(L[first].text) && !DISCLAIMER.test(L[first].text)) first++;
      cut = Math.max(tailStart, first - 2);
    }
    while (cut > 0 && cut < n && SIGNOFF.test(L[cut].text)) cut++;
  }
  if (cut <= 0 || cut >= n) return { body: html, signature: null };
  const at = L[cut].start;
  return { body: html.slice(0, at), signature: html.slice(at) };
}

/**
 * The cleaned view, in one call: junk out (`stripClientJunk`), signature split off (`splitSignature`), the
 * sender's presentation gone (`stripPresentation`), links decorated (`decorateLinks`). Pure; takes the
 * DOMPurify-sanitised HTML and keeps the data-aims-src markers so "Load images" still works on the result.
 */
export function restyleEmailHtml(html: string): RestyledEmail {
  const junk = stripClientJunk(html);
  const removed = [...junk.removed];
  const split = splitSignature(junk.html);
  const body = decorateLinks(collapseBreaks(stripPresentation(split.body)));
  const links = [...body.links];
  let signatureHtml: string | null = null;
  if (split.signature) {
    const sig = decorateLinks(collapseBreaks(stripPresentation(split.signature)));
    signatureHtml = sig.html;
    for (const l of sig.links) if (!links.some((x) => x.href === l.href)) links.push(l);
    removed.push("signature");
  }
  return { html: body.html, signatureHtml, removed, links };
}

/** The frame cannot report its height (no same-origin), so size it from the text and the block count. */
export function estimateFrameHeight(bodyHtml: string, min = 120, max = 1200): number {
  const text = stripTags(bodyHtml);
  const blocks = bodyHtml.match(/<(?:br|p|div|tr|li|h[1-6]|hr|pre)\b/gi)?.length ?? 0;
  const imgs = bodyHtml.match(/<img\b/gi)?.length ?? 0;
  const lineCount = Math.ceil(text.length / 90) + Math.round(blocks * 0.6);
  return Math.min(max, Math.max(min, Math.round(lineCount * 23 + imgs * 60 + 48)));
}
