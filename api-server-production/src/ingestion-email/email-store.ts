/**
 * Store-only email intake (EmailIngestConfig.routingMode = 'STORE'; ADH Japan
 * first). Same Cloudflare worker, webhook and docs+{orgId}@ address as the AI
 * pipeline, but nothing is classified or created: every email is kept as its
 * .eml plus its attachments in S3, and its EmailIngestLog row (status STORED)
 * records from / to / subject / date / Message-ID / attachment names + keys.
 *
 * The worker sends the original MIME as `rawBase64` when it fits the request
 * size; older workers (or a larger message) don't, and the .eml is then
 * rebuilt from the parsed fields — headers, text body and attachments — and
 * flagged `emlSource: 'reconstructed'` (header X-AIMS-Reconstructed).
 */

export type StoredAttachment = { name: string; contentType: string; size: number; key: string };

export type StoredEmailMeta = {
  mode: 'STORE';
  to: string;
  envelopeFrom: string | null;
  date: string | null;
  messageId: string;
  emlKey: string;
  emlSource: 'raw' | 'reconstructed';
  emlSize: number;
  attachmentNames: Array<string | null>;
  attachments: StoredAttachment[];
  skippedAttachments: Array<{ filename: string | null; size?: number; reason?: string }>;
  /** Triage inputs (worker headers + the text body), removed when the email is purged. */
  headerTo?: string[];
  cc?: string[];
  inReplyTo?: string | null;
  references?: string[];
  bodyText?: string;
};

/** A file name safe as an S3 key segment (keeps Japanese characters, drops path / control chars). */
export function safeKeyName(name: string | null | undefined, fallback: string): string {
  const cleaned = String(name ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\?#%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback;
}

/** email-intake/{org}/{yyyy}/{mm}/{logId}/ — one folder per email. */
export function emailFolder(organizationId: string, logId: string, at: Date): string {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `email-intake/${organizationId}/${yyyy}/${mm}/${logId}/`;
}

/** The email's own Date header as ISO, else null. */
export function parseMailDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** RFC 2047 encoded-word for a header value that isn't plain ASCII. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');

/**
 * Rebuild a valid multipart/mixed .eml from the parsed webhook payload (used
 * when the worker didn't send the raw MIME). Marked X-AIMS-Reconstructed.
 */
export function reconstructEml(p: {
  from: string;
  to: string;
  subject?: string;
  date?: string | null;
  messageId: string;
  text?: string;
  attachments: Array<{ contentType: string; contentBase64: string; filename?: string }>;
}): Buffer {
  const boundary = `aims-${Buffer.from(p.messageId).toString('hex').slice(0, 24)}-mixed`;
  const head = [
    `From: ${encodeHeader(p.from || '')}`,
    `To: ${encodeHeader(p.to || '')}`,
    `Subject: ${encodeHeader(p.subject || '')}`,
    `Date: ${p.date ? new Date(p.date).toUTCString() : new Date().toUTCString()}`,
    `Message-ID: ${p.messageId.startsWith('<') ? p.messageId : `<${p.messageId}>`}`,
    'MIME-Version: 1.0',
    'X-AIMS-Reconstructed: true',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts: string[] = [
    [`--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(p.text || '', 'utf8').toString('base64'))].join('\r\n'),
  ];
  for (const a of p.attachments) {
    const name = encodeHeader(a.filename || 'attachment');
    parts.push(
      [
        `--${boundary}`,
        `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${name}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${name}"`,
        '',
        wrap76(a.contentBase64 || ''),
      ].join('\r\n'),
    );
  }
  return Buffer.from(`${head.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--\r\n`, 'utf8');
}
