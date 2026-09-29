/**
 * WhatsApp DM bridge — a linked device that relays 1:1 conversations into AIMS.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT whatsapp-group-bridge
 * -------------------------------------------------------
 * Some numbers cannot be connected to the Cloud API at all: Meta answers
 * "already has an existing WhatsApp Business account" on both the new-number
 * and the coexistence signup paths, and there is no way through. For those,
 * a linked device is the only route by which their conversations reach AIMS.
 *
 * The group bridge is a different machine with a different job: it answers
 * clients in GROUP chats from trained templates, holds uncertain drafts for
 * the adviser, captures appointments, and runs the PA conversation. Its rules
 * about who is staff, when to stay silent, and what a mention means are all
 * group rules. Folding a second purpose into it would mean every change to one
 * risks the other — which has already happened once. So this is its own
 * service, and it stays small:
 *
 *   1. link a phone by QR
 *   2. relay 1:1 messages, both directions, to AIMS
 *   3. nothing else
 *
 * It sends NOTHING to WhatsApp. It cannot reply, and cannot post into a group.
 * That is deliberate: a read-only relay cannot embarrass anyone, and automation
 * can be added later once its behaviour is specified.
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const ORG_ID = process.env.AIMS_ORG_ID;
const API_BASE = process.env.AIMS_API_BASE || 'https://aims-ahwy.onrender.com';
const TOKEN = process.env.AIMS_GROUP_BRIDGE_TOKEN;
const SESSION_DIR = process.env.SESSION_DIR || './.wwebjs_auth';
const LABEL = process.env.BRIDGE_LABEL || 'dm-bridge';

if (!ORG_ID || !TOKEN) {
  console.error('❌ Set AIMS_ORG_ID and AIMS_GROUP_BRIDGE_TOKEN');
  process.exit(1);
}

/** Chromium refuses to start if a previous container died holding these. */
function clearChromiumLocks(dir) {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.rmSync(path.join(dir, 'session', name), { force: true, recursive: true });
    } catch {
      /* nothing to clear */
    }
  }
}
clearChromiumLocks(SESSION_DIR);

// Pin the WhatsApp Web build when WA_WEB_VERSION is set.
//
// The group bridge, whose session was established in August, still restores
// and authenticates fine. A FRESH link made today did not complete: the phone
// accepted it, the client never authenticated, and WhatsApp revoked it minutes
// later. Same library, same image, same host — the only difference is old
// session versus new handshake, which points at the web build having moved on.
// Pinning to a known snapshot is the documented remedy. Snapshots:
// https://github.com/wppconnect-team/wa-version (html/<version>.html)
const WA_WEB_VERSION = process.env.WA_WEB_VERSION;
const webVersionCache = WA_WEB_VERSION
  ? {
      type: 'remote',
      remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${WA_WEB_VERSION}.html`,
    }
  : undefined;
if (WA_WEB_VERSION) console.log(`📌 pinning WhatsApp Web to ${WA_WEB_VERSION}`);

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  ...(webVersionCache ? { webVersionCache } : {}),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
});

async function post(pathname, body) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Group-Bridge-Token': TOKEN },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

client.on('qr', async (qr) => {
  // Headless host: render the QR into the logs so it can be scanned from the
  // log viewer, and emit the raw string so it can be re-rendered elsewhere.
  const ascii = await qrcode.toString(qr, { type: 'terminal', small: true });
  console.log(`\n📱 Scan from the phone whose 1:1 chats should reach AIMS (WhatsApp → Linked devices → Link a device):\n${ascii}`);
  console.log('QR_RAW::' + qr);
  // Also push it to AIMS. A QR lives ~20s, and reading it back out of the
  // host's log API costs 40-80s — so the logs can never yield a scannable one.
  post('/whatsapp/dm-bridge/qr', { key: LABEL, qr }).catch(() => null);
});

client.on('authenticated', () => console.log('🔐 authenticated'));
client.on('auth_failure', (m) => console.error('✖ auth failure:', m));
client.on('disconnected', (r) => console.error('✖ disconnected:', r));

client.on('ready', () => {
  const me = client.info?.wid?.user || 'unknown';
  const name = client.info?.pushname || '';
  console.log(`✅ ${LABEL} live — linked as +${me} ${name ? '(' + name + ')' : ''} for org ${ORG_ID}`);
  console.log('   Relaying 1:1 messages only. This bridge never sends.');
});

// message_create fires for BOTH directions, which is what makes the thread
// complete: replies typed by hand on the phone are relayed too, not just
// inbound. A Cloud API connection gets that from smb_message_echoes; here it
// comes for free.
client.on('message_create', async (msg) => {
  try {
    const chatId = String(msg.from || '');
    const toId = String(msg.to || '');
    // Groups belong to the other bridge. Status broadcasts are noise.
    if (chatId.endsWith('@g.us') || toId.endsWith('@g.us')) return;
    if (chatId.startsWith('status@') || toId.startsWith('status@')) return;

    const outbound = !!msg.fromMe;
    const counterparty = (outbound ? toId : chatId).split('@')[0].replace(/\D/g, '');
    if (!counterparty) return;

    const body = String(msg.body || '');
    // Media arrives with an empty body; record the kind so the thread is not
    // full of unexplained blanks.
    const text = body || (msg.type && msg.type !== 'chat' ? `[${msg.type}]` : '');

    const res = await post('/whatsapp/dm-bridge/message', {
      organizationId: ORG_ID,
      direction: outbound ? 'OUTBOUND' : 'INBOUND',
      counterparty,
      body: text,
      waMessageId: msg.id?._serialized || undefined,
      sentAt: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : undefined,
      payload: { type: msg.type, hasMedia: !!msg.hasMedia, from: chatId, to: toId },
    });
    if (res?.stored) {
      console.log(`${outbound ? '→' : '←'} ${counterparty}  ${text.slice(0, 70)}`);
    }
  } catch (e) {
    console.error('✖ relay failed:', e && e.message ? e.message : e);
  }
});

client.initialize();
