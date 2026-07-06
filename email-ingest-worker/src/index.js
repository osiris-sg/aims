// Cloudflare Email Worker: inbound email → AIMS ingestion webhook.
//
// Email Routing delivers the raw MIME message to email(); we parse it with
// postal-mime, build the webhook DTO the Nest endpoint expects (same shape as
// bills-inbound), and POST it with the shared secret header.
//
// Failure contract:
//   - Webhook 2xx (including business rejections like {ok:false, reason})  → done, log only.
//   - Webhook 4xx (bad secret / bad request = misconfiguration)            → log loudly, do NOT throw
//     (retrying can't fix config; throwing would bounce mail at the sender).
//   - Webhook 5xx or network failure                                       → throw, so Cloudflare
//     retries delivery / signals a transient error to the sending server.

import PostalMime from 'postal-mime';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // mirror the webhook's per-attachment cap

/** ArrayBuffer/Uint8Array/string → base64, chunked to keep the call stack sane. */
function toBase64(content) {
  if (typeof content === 'string') {
    // Text attachment — encode the UTF-8 bytes, not UTF-16 code units.
    content = new TextEncoder().encode(content);
  }
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function byteLength(content) {
  if (typeof content === 'string') return content.length; // close enough for a cap check
  return content instanceof Uint8Array ? content.byteLength : (content?.byteLength ?? 0);
}

export default {
  async email(message, env) {
    if (!env.AIMS_API || !env.EMAIL_INGEST_SECRET) {
      // Hard misconfiguration — throwing here would retry forever; log instead.
      console.error('[aims-email-ingest] AIMS_API / EMAIL_INGEST_SECRET secrets not set — dropping message');
      return;
    }

    const parsed = await PostalMime.parse(message.raw);

    const attachments = [];
    const skippedAttachments = [];
    for (const att of parsed.attachments || []) {
      const size = byteLength(att.content);
      if (size > MAX_ATTACHMENT_BYTES) {
        skippedAttachments.push({ filename: att.filename || null, size, reason: '>10MB' });
        continue;
      }
      attachments.push({
        contentType: att.mimeType || 'application/octet-stream',
        contentBase64: toBase64(att.content),
        filename: att.filename || undefined,
      });
    }

    const payload = {
      // `from` = the MIME From: header — the human sender. The SMTP envelope
      // sender gets rewritten by forwarders (Gmail SRS → postmaster@…google.com),
      // which broke the per-org sender allow-list for forwarding chains; the
      // header From survives. Envelope kept alongside for audit.
      from: parsed.from?.address || message.from,
      envelopeFrom: message.from,
      // `to` stays the envelope recipient — it carries the docs+{orgId}@…
      // routing address even when the header To: points at the pre-forward inbox.
      to: message.to,
      subject: parsed.subject || undefined,
      text: parsed.text || undefined,
      messageId: message.headers.get('message-id') || parsed.messageId || undefined,
      attachments,
      // Extra field the webhook tolerates; keeps skips observable server-side.
      ...(skippedAttachments.length ? { meta: { skippedAttachments } } : {}),
    };

    const res = await fetch(env.AIMS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': env.EMAIL_INGEST_SECRET,
      },
      body: JSON.stringify(payload),
    }); // network failure throws → Cloudflare retries delivery

    const body = await res.text();
    console.log(
      `[aims-email-ingest] from=${message.from} to=${message.to} ` +
        `attachments=${attachments.length}${skippedAttachments.length ? ` skipped=${skippedAttachments.length}` : ''} ` +
        `-> HTTP ${res.status}: ${body.slice(0, 500)}`,
    );

    if (res.status >= 500) {
      throw new Error(`AIMS webhook returned ${res.status} — retrying delivery`);
    }
    if (res.status >= 400) {
      // 401 bad secret / 400 bad payload: retrying can't help — surface in tail.
      console.error(`[aims-email-ingest] MISCONFIGURATION: webhook rejected with ${res.status}: ${body.slice(0, 300)}`);
    }
  },
};
