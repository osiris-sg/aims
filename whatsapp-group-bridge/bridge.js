/**
 * AIMS WhatsApp GROUP BRIDGE  —  ⚠️ UNOFFICIAL (whatsapp-web.js linked device).
 *
 * WHY THIS EXISTS: WhatsApp groups are NOT on the official Cloud API. To let
 * the PA reply *inside a group* (which 1:1 Cloud API can't do), we run this
 * separate worker as a linked device on the SAME number. It ONLY handles GROUP
 * messages; all 1:1 traffic stays on the official Cloud API (no overlap, no
 * double-reply). On a group message that contains the trigger, it asks the
 * AIMS agent (via /whatsapp/group-agent) for an on-brand reply and posts it.
 *
 * ⚠️ RISK: this rides WhatsApp Web's protocol, against Meta ToS. The linked
 * number can be banned. Run it only on a number the operator accepts is
 * at-risk. NOT deployed with the main app — run on a persistent host.
 *
 *   cp .env.example .env   # fill in the values
 *   node bridge.js         # prints qr.png on first run; scan from the phone
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Clear stale Chromium singleton locks left by an unclean shutdown (e.g. a
// superseded Render deploy). Otherwise the next boot fails with "profile
// appears to be in use by another Chromium process" and the browser won't launch.
function clearChromiumLocks(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) clearChromiumLocks(p);
    else if (/^Singleton(Lock|Cookie|Socket)$/.test(e.name)) {
      try {
        fs.rmSync(p, { force: true });
        console.log('  cleared stale Chromium lock:', p);
      } catch {
        /* ignore */
      }
    }
  }
}

const API_BASE = process.env.AIMS_API_BASE || 'http://localhost:4040';
const ORG_ID = process.env.AIMS_ORG_ID; // which org's trained agent to use
const BRIDGE_TOKEN = process.env.AIMS_GROUP_BRIDGE_TOKEN;
const TRIGGER = new RegExp(process.env.TRIGGER || '@pa\\b', 'i');
const MIN_REPLY_GAP_MS = Number(process.env.MIN_REPLY_GAP_MS || 4000); // gentle self-throttle
// Delay before sending a template Q&A reply, so a human can answer first and
// the PA feels less robotic. Intro replies are NOT delayed. Default 5 min.
const REPLY_DELAY_MS = Number(process.env.REPLY_DELAY_MS || 5 * 60 * 1000);

// Extra numbers to treat as "staff" (never the client) — e.g. Denzel's own
// number — so the intro never greets them. Comma-separated digits in .env.
const STAFF_NUMBERS = (process.env.STAFF_NUMBERS || '')
  .split(',')
  .map((s) => s.replace(/\D/g, ''))
  .filter(Boolean);

// Group allowlist: if set, the PA ONLY acts in these group ids and ignores
// every other group. Empty = all groups. Comma-separated @g.us ids in .env.
const ALLOWED_GROUPS = (process.env.ALLOWED_GROUPS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Fixed PA intro. {name} is filled with the client's name, resolved from the
// group (the participant who is neither the PA nor whoever asked for the intro).
const INTRO_TEMPLATE = `Hi {name}! 😊

This is San, Denzel's PA. Pleasure to meet you!

I'll be supporting Denzel to ensure everything runs smoothly for you, whether it's portfolio-related queries, scheduling, or any other assistance you may need along the way.

Feel free to reach out to me here or in the group anytime and I'll be happy to help. We'll do our best to make sure you continue receiving the level of care and responsiveness you're used to 🙏🏻`;

// Resolve the client's name from the group: exclude the bot itself, whoever
// asked, and any configured staff numbers — the remaining participant is the
// client. Returns a best-known name, or null if it can't be determined.
async function resolveClientName(chatId, senderId) {
  try {
    const chat = await client.getChatById(chatId);
    const parts = chat.participants || chat.groupMetadata?.participants || [];
    const botDigits = (client.info?.wid?.user || '').replace(/\D/g, '');
    const senderDigits = (senderId || '').replace(/\D/g, '').replace(/@.*/, '');
    const excluded = new Set([botDigits, senderDigits, ...STAFF_NUMBERS]);

    const candidates = parts
      .map((p) => (p.id?._serialized || p.id?.user || '').toString())
      .map((s) => ({ serialized: s, digits: s.replace(/\D/g, '').replace(/@.*/, '') }))
      .filter((p) => p.digits && !excluded.has(p.digits));
    if (!candidates.length) return null;

    const target = candidates[0];
    const contact = await client.getContactById(
      target.serialized.includes('@') ? target.serialized : `${target.digits}@c.us`,
    );
    const name = contact.pushname || contact.name || contact.shortName || null;
    // Use only a first name if it's a full name, to keep the greeting warm.
    return name ? name.split(' ')[0] : null;
  } catch (e) {
    console.warn('   ⚠️ could not resolve client name:', e && e.message ? e.message : e);
    return null;
  }
}

if (!ORG_ID || !BRIDGE_TOKEN) {
  console.error('❌ Set AIMS_ORG_ID and AIMS_GROUP_BRIDGE_TOKEN in .env');
  process.exit(1);
}

let lastReplyAt = 0;

// SESSION_DIR lets a hosted deploy point the session at a persistent disk so it
// survives restarts/redeploys (Render worker mounts a disk here). Local default
// keeps it in the folder. PUPPETEER_EXECUTABLE_PATH points at the OS Chromium
// on hosts where puppeteer's bundled build isn't present (the Docker image).
const SESSION_DIR = process.env.SESSION_DIR || './.wwebjs_auth';
clearChromiumLocks(SESSION_DIR); // remove stale locks before Chromium launches
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
});

client.on('qr', async (qr) => {
  // On a headless host (Render) there's no screen — render the QR straight into
  // the logs so it can be scanned from the log viewer. Also emit the raw string
  // (marker-prefixed) so it can be re-rendered into a clean PNG off the logs.
  const ascii = await qrcode.toString(qr, { type: 'terminal', small: true });
  console.log('\n📱 Scan this QR from the number that will run in groups (Linked devices → Link a device):\n' + ascii);
  console.log('QR_RAW::' + qr);
  try {
    await qrcode.toFile(__dirname + '/qr.png', qr, { width: 480, margin: 2 });
  } catch {
    /* read-only fs on the host — logs QR is enough */
  }
});
client.on('authenticated', () => console.log('🔐 authenticated'));
let BOT_IDS = []; // phone + LID digit-forms used to recognise an @mention of us
client.on('ready', () => {
  const me = client.info?.wid?.user || 'unknown';
  const name = client.info?.pushname || '';
  const lid = client.info?.lid?.user || client.info?.me?.lid?.user || '';
  BOT_IDS = [me, lid].map((s) => (s || '').replace(/\D/g, '')).filter(Boolean);
  console.log(
    `✅ Group bridge live — linked as +${me} ${name ? '(' + name + ')' : ''}` +
      `${lid ? ' [lid ' + lid + ']' : ''} for org ${ORG_ID}. Trigger: @mention or ${TRIGGER}`,
  );
});
client.on('disconnected', (r) => console.warn('⚠️ disconnected:', r));

async function askAgent(groupId, from, body) {
  const res = await fetch(`${API_BASE}/whatsapp/group-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Group-Bridge-Token': BRIDGE_TOKEN },
    body: JSON.stringify({ organizationId: ORG_ID, groupId, from, body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `agent ${res.status}`);
  // API wraps responses as { success, data } — unwrap if present.
  return json?.data ?? json;
}

// Digit-forms of every id mentioned in the message (handles @lid and @c.us).
function mentionedDigits(msg) {
  return (msg.mentionedIds || []).map((id) => ((id && (id._serialized || id.user || id)) + '').replace(/\D/g, ''));
}

// True when the linked number (by phone OR LID) was @mentioned.
function botMentioned(msg) {
  const mentions = mentionedDigits(msg);
  return mentions.some((m) => BOT_IDS.some((b) => b && (m === b || m.includes(b) || b.includes(m))));
}

// Pull the client name(s) out of an intro line like "hi @san this is Esther"
// or "this is Guru and Heimen". Greets each person by first name; stops at a
// comma/period (so "this is Marcus, my new client" → "Marcus").
function nameFromIntro(body) {
  const m = (body || '').match(/this\s+is\s+([^,.\n!?]+)/i);
  if (!m) return null;
  const names = m[1]
    .split(/\s+(?:and|&|\+)\s+/i) // multiple people
    .map((part) => (part.trim().match(/[A-Za-z][A-Za-z'’.\-]*/) || [])[0]) // first name of each
    .filter(Boolean)
    .slice(0, 4);
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

client.on('message_create', async (msg) => {
  try {
    const chatId = msg.from;
    if (!(typeof chatId === 'string' && chatId.endsWith('@g.us'))) return; // GROUPS ONLY
    if (ALLOWED_GROUPS.length && !ALLOWED_GROUPS.includes(chatId)) return; // only allowlisted groups
    const from = (msg.author || msg.from || '').split('@')[0];
    const who = from + (msg.fromMe ? ' (linked phone)' : '');
    const mentions = mentionedDigits(msg);
    console.log(`👥 [${chatId}] ${who}: ${msg.body}${mentions.length ? '  «mentions ' + mentions.join(',') + '»' : ''}`);

    const mentioned = botMentioned(msg);
    const introName = nameFromIntro(msg.body);
    // Intro summon: our number is @mentioned + "this is <name>" — but because
    // WhatsApp masks numbers as LIDs, also accept ANY @mention paired with the
    // "this is <name>" phrase (that shape is unambiguously an intro to the PA).
    const isIntro = introName && (mentioned || mentions.length > 0 || TRIGGER.test(msg.body || ''));
    // General summon (for template Q&A): @mention of us, or the legacy @pa text.
    const summoned = mentioned || TRIGGER.test(msg.body || '');

    if (!isIntro && !summoned) return;

    if (Date.now() - lastReplyAt < MIN_REPLY_GAP_MS) {
      console.log('   ⏳ throttled (too soon since last reply)');
      return;
    }

    // Intro is a fixed template; name taken from the message (fallback: group).
    if (isIntro || /\bintro\b/i.test(msg.body)) {
      const name = introName || (await resolveClientName(chatId, msg.author));
      const intro = INTRO_TEMPLATE.replace('{name}', name || 'there');
      await client.sendMessage(chatId, intro);
      lastReplyAt = Date.now();
      console.log(`   🤖 intro sent (client: ${name || 'unknown'})`);
      return;
    }

    const { reply, reason } = await askAgent(chatId, from, msg.body);
    if (!reply) {
      console.log(`   🤖 no reply (${reason || 'held/empty'})`);
      return;
    }
    // Template Q&A replies are delayed (human-first). Fire-and-forget timer.
    const mins = Math.round(REPLY_DELAY_MS / 60000);
    console.log(`   ⏲  reply scheduled in ${mins}m: ${reply.slice(0, 70)}…`);
    setTimeout(async () => {
      try {
        await client.sendMessage(chatId, reply);
        lastReplyAt = Date.now();
        console.log(`   🤖 delayed reply sent: ${reply.slice(0, 70)}…`);
      } catch (e) {
        console.error('   ✖ delayed send failed:', e && e.message ? e.message : e);
      }
    }, REPLY_DELAY_MS);
  } catch (e) {
    console.error('handler error:', e && e.message ? e.message : e);
  }
});

client.initialize();
