// Round T — the email view's safety helpers (pure; node-tested in helpers/emailHtml.test.mjs).
//
// An email's HTML is untrusted data. The API already removed scripts / forms / meta / link and turned every
// remote src into data-aims-src. On the client it is (1) sanitised again with DOMPurify (an allowlist of
// formatting tags, no event handlers, no forms, no external resources), (2) rendered in an <iframe sandbox="">
// (no scripts, no forms, no top-navigation, no same-origin), and (3) remote images stay blocked until the
// person clicks "Load images", which restores data-aims-src → src for https images only.

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
export const FRAME_SANDBOX = "";

/** Plain text → safe HTML for the frame (links stay text; line breaks kept). */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre style="white-space:pre-wrap;word-break:break-word;font:14px/1.5 system-ui,sans-serif;margin:0">${esc}</pre>`;
}

/** The frame document: a base that blocks navigation + the body; colours follow the host theme. */
export function frameDocument(bodyHtml: string, dark: boolean): string {
  const fg = dark ? "#e6e6e6" : "#1a1a1a";
  const bg = dark ? "#121212" : "#ffffff";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid: https:; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{margin:12px;color:${fg};background:${bg};font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,'Hiragino Sans','Noto Sans JP',sans-serif;word-break:break-word}img{max-width:100%;height:auto}table{max-width:100%}a{color:${dark ? "#8ab4f8" : "#1a5fb4"}}blockquote{border-left:3px solid ${dark ? "#444" : "#ccc"};margin:8px 0;padding-left:10px;color:${dark ? "#aaa" : "#555"}}</style></head><body>${bodyHtml}</body></html>`;
}

/** Humanised size for the attachment list. */
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
