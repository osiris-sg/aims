/**
 * Round T — read a stored .eml for display: headers (From / To / Cc / Date / Subject), the text and HTML
 * bodies, and the attachment parts' names. Pure and defensive: it only DECODES (quoted-printable, base64,
 * RFC 2047 headers, charsets incl. ISO-2022-JP / Shift_JIS); it never evaluates or follows anything.
 * The HTML it returns is RAW and untrusted — the portal sanitises it (DOMPurify + a sandboxed frame) and
 * `blockRemoteContent` below rewrites remote images / stylesheets to data attributes so nothing loads
 * until a person clicks "Load images".
 */

export interface MimePart {
  headers: Record<string, string>;
  contentType: string;
  charset: string | null;
  encoding: string;
  filename: string | null;
  disposition: string | null;
  body: Buffer;
  parts: MimePart[];
}

export interface ParsedEmail {
  headers: { from: string; to: string; cc: string; date: string | null; subject: string; messageId: string | null };
  text: string | null;
  html: string | null;
  /** Attachment parts in order (name + type + size); their bytes stay in the .eml / S3. */
  attachments: Array<{ name: string; contentType: string; size: number }>;
}

const CRLF = /\r?\n/;

/** Raw header block → map (lowercase names, folded lines joined). */
export function parseHeaders(block: string): Record<string, string> {
  const h: Record<string, string> = {};
  let cur = '';
  for (const line of block.split(CRLF)) {
    if (/^[ \t]/.test(line) && cur) {
      h[cur] += ' ' + line.trim();
      continue;
    }
    const i = line.indexOf(':');
    if (i <= 0) continue;
    cur = line.slice(0, i).trim().toLowerCase();
    h[cur] = (h[cur] ? h[cur] + ' ' : '') + line.slice(i + 1).trim();
  }
  return h;
}

/** "=?UTF-8?B?...?=" / "=?ISO-2022-JP?Q?...?=" words → text (RFC 2047). */
export function decodeHeader(v: string | null | undefined): string {
  const s = v ?? '';
  return s
    .replace(/\?=\s+=\?/g, '?==?') // adjacent encoded words: the whitespace between them is not text
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs: string, enc: string, data: string) => {
      try {
        const bytes = /b/i.test(enc) ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
        return decodeBytes(bytes, cs);
      } catch {
        return data;
      }
    });
}

/** Bytes in a charset → string (UTF-8 by default; Japanese charsets via TextDecoder; unknown → UTF-8). */
export function decodeBytes(bytes: Buffer, charset: string | null | undefined): string {
  const cs = (charset ?? 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
  const name = cs === 'utf8' ? 'utf-8' : cs === 'cp932' || cs === 'windows-31j' || cs === 'ms932' ? 'shift_jis' : cs;
  try {
    return new TextDecoder(name as any, { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

export function decodeQuotedPrintable(s: string): Buffer {
  const out: number[] = [];
  const t = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) {
      out.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(t.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

const param = (headerValue: string, name: string): string | null => {
  // name="value" / name=value / RFC 2231 name*=charset''value (one segment)
  const re = new RegExp(`${name}\\*?\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i');
  const m = re.exec(headerValue);
  if (!m) return null;
  let v = (m[1] ?? m[2] ?? '').trim();
  const ext = /^([^']*)'[^']*'(.*)$/.exec(v);
  if (ext) {
    try {
      v = decodeBytes(Buffer.from(decodeURIComponent(ext[2]), 'latin1'), ext[1] || 'utf-8');
    } catch {
      v = ext[2];
    }
  }
  return decodeHeader(v);
};

/** Split one MIME entity (headers + body) into a part tree. Depth-limited; a bad boundary just yields one part. */
export function parseMime(raw: Buffer | string, depth = 0): MimePart {
  const text = Buffer.isBuffer(raw) ? raw.toString('latin1') : raw;
  const sep = text.search(/\r?\n\r?\n/);
  // A bare body (no "Name: value" first line) has no header block at all.
  const hasHeaders = /^[A-Za-z][\w-]*:/.test(text);
  const headBlock = !hasHeaders ? '' : sep >= 0 ? text.slice(0, sep) : text;
  const bodyText = !hasHeaders ? text : sep >= 0 ? text.slice(sep).replace(/^\r?\n\r?\n/, '') : '';
  const headers = parseHeaders(headBlock);
  const ct = headers['content-type'] ?? 'text/plain';
  const contentType = (ct.split(';')[0] ?? 'text/plain').trim().toLowerCase();
  const charset = param(ct, 'charset');
  const encoding = (headers['content-transfer-encoding'] ?? '7bit').trim().toLowerCase();
  const disposition = (headers['content-disposition'] ?? '').split(';')[0].trim().toLowerCase() || null;
  const filename = param(headers['content-disposition'] ?? '', 'filename') ?? param(ct, 'name');
  const part: MimePart = { headers, contentType, charset, encoding, filename, disposition, body: Buffer.alloc(0), parts: [] };
  const boundary = param(ct, 'boundary');
  if (contentType.startsWith('multipart/') && boundary && depth < 8) {
    const pieces = bodyText.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*(?=\\r?\\n|$)`));
    for (const piece of pieces.slice(1)) {
      if (!piece.trim() || /^--/.test(piece.trim())) continue;
      part.parts.push(parseMime(piece.replace(/^\r?\n/, ''), depth + 1));
    }
    return part;
  }
  const bytes = encoding === 'base64' ? Buffer.from(bodyText.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64') : encoding === 'quoted-printable' ? decodeQuotedPrintable(bodyText) : Buffer.from(bodyText, 'latin1');
  part.body = bytes;
  return part;
}

/** Walk the tree: the best text/plain and text/html bodies, and the attachment parts. */
export function parseEmail(raw: Buffer | string): ParsedEmail {
  const root = parseMime(raw);
  const h = root.headers;
  let text: string | null = null;
  let html: string | null = null;
  const attachments: ParsedEmail['attachments'] = [];
  const walk = (p: MimePart) => {
    if (p.parts.length) {
      // multipart/alternative: prefer html for html, plain for text — both are kept when present.
      for (const c of p.parts) walk(c);
      return;
    }
    const isAttachment = p.disposition === 'attachment' || (!!p.filename && !p.contentType.startsWith('text/'));
    if (isAttachment) {
      attachments.push({ name: p.filename ?? 'attachment', contentType: p.contentType, size: p.body.length });
      return;
    }
    if (p.contentType === 'text/plain' && text === null) text = decodeBytes(p.body, p.charset);
    else if (p.contentType === 'text/html' && html === null) html = decodeBytes(p.body, p.charset);
    else if (p.filename) attachments.push({ name: p.filename, contentType: p.contentType, size: p.body.length });
  };
  walk(root);
  const mid = /<[^<>\s]+>/.exec(h['message-id'] ?? '')?.[0] ?? null;
  return { headers: { from: decodeHeader(h['from']), to: decodeHeader(h['to']), cc: decodeHeader(h['cc']), date: h['date'] ? new Date(h['date']).toISOString() || null : null, subject: decodeHeader(h['subject']), messageId: mid }, text, html, attachments };
}

/**
 * Defuse remote content in untrusted HTML BEFORE the portal sanitises it: every src / href-to-stylesheet /
 * srcset / background / url(...) that points off-page becomes data-aims-src (restored only by the "Load images"
 * button, which the person clicks). Scripts, iframes, objects, forms and event handlers are removed outright
 * here too; DOMPurify on the client is the second line, the sandboxed frame (no scripts, no forms) the third.
 */
export function blockRemoteContent(html: string): { html: string; blocked: number } {
  let blocked = 0;
  let out = html
    .replace(/<\s*(script|iframe|object|embed|applet|form|meta|base|link)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, () => '')
    .replace(/<\s*(script|iframe|object|embed|applet|form|meta|base|link)\b[^>]*\/?>/gi, () => '')
    .replace(/<\s*\/\s*(form)\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\s)(src|srcset|background|poster)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, sp: string, attr: string, val: string) => {
      const v = val.replace(/^["']|["']$/g, '');
      if (/^(cid:|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(v)) return m;
      blocked++;
      return `${sp}data-aims-${attr}=${val}`;
    })
    .replace(/url\(\s*(['"]?)(https?:|\/\/)[^)]*\)/gi, () => {
      blocked++;
      return 'url()';
    })
    .replace(/(href\s*=\s*["']?)\s*javascript:[^"'>\s]*/gi, '$1#');
  return { html: out, blocked };
}
