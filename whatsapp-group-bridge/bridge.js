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
// How often to check AIMS for appointment reminders that have come due.
const REMINDER_POLL_MS = Number(process.env.REMINDER_POLL_MS || 5 * 60 * 1000);

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

// Who receives internal PA notifications (handoff alerts, scheduled-send
// reports). Comma-separated so Denzel and anyone else who should be kept in
// the loop both get them.
const DENZEL_NUMBERS = (process.env.DENZEL_NUMBER || '')
  .split(',')
  .map((s) => s.replace(/\D/g, ''))
  .filter(Boolean);

// Friendly labels and invite links per group id, supplied by config because
// this whatsapp-web.js build cannot construct Chat objects against the current
// WhatsApp Web (both msg.getChat() and getChatById() throw), so the group's
// name and invite code are unreachable through the library.
//   GROUP_LABELS=<id>=<Name>,<id>=<Name>
//   GROUP_LINKS=<id>=<https://chat.whatsapp.com/...>
function parseMap(raw) {
  const out = {};
  for (const entry of String(raw || '').split(',')) {
    const i = entry.indexOf('=');
    if (i <= 0) continue;
    const key = entry.slice(0, i).trim();
    const val = entry.slice(i + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}
const GROUP_LABELS = parseMap(process.env.GROUP_LABELS);
const GROUP_LINKS = parseMap(process.env.GROUP_LINKS);

// Fixed PA intro. {name} is filled with the client's name, resolved from the
// group (the participant who is neither the PA nor whoever asked for the intro).
const INTRO_TEMPLATE = `Hi {name}! This is San, Denzel's PA. It's a pleasure to meet you! 😊

I'll be supporting Denzel and helping to ensure everything runs smoothly for you, whether it's with portfolio-related queries, scheduling, or anything else you may need along the way.

Feel free to reach out to me anytime, either directly or in the group, and I'll be more than happy to assist.

We're glad to have you on board, and we look forward to supporting you every step of the way! 🙏🏻`;

// Resolve the client's name from the group: exclude the bot itself, whoever
// asked, and any configured staff numbers — the remaining participant is the
// client. Returns a best-known name, or null if it can't be determined.
async function resolveClientName(chatId, senderId) {
  try {
    const botDigits = (client.info?.wid?.user || '').replace(/\D/g, '');
    const senderDigits = (senderId || '').replace(/\D/g, '').replace(/@.*/, '');
    const excluded = [botDigits, senderDigits, ...STAFF_NUMBERS].filter(Boolean);

    // Read participants and their display names straight from WhatsApp's own
    // collections. The library's getChatById()/getContactById() both throw on
    // this build (its Chat/Contact serializers are broken against the current
    // WhatsApp Web), but the underlying models are intact.
    const name = await client.pupPage.evaluate(
      (id, excludedDigits) => {
        const wid = window.require('WAWebWidFactory').createWid(id);
        const collections = window.require('WAWebCollections');
        const chat = collections.Chat.get(wid);
        const parts = chat?.groupMetadata?.participants;
        const list = parts?.getModelsArray?.() || parts?.models || parts || [];

        const isExcluded = (digits) =>
          !digits || excludedDigits.some((e) => digits === e || digits.endsWith(e) || e.endsWith(digits));

        for (const p of list) {
          // Never greet ourselves. The bot's own id in a group is a LID, which
          // never matches the phone number in client.info, so rely on the
          // participant's own isMe flag instead.
          if (p?.isMe) continue;
          const serialized = String(p?.id?._serialized || p?.id || '');
          const digits = serialized.replace(/\D/g, '');
          if (isExcluded(digits)) continue;
          // Prefer the saved contact name, then whatever they call themselves.
          const c = collections.Contact?.get(p.id) || null;
          const label =
            c?.name || c?.formattedName || c?.pushname || c?.verifiedName || c?.notifyName || null;
          if (label) return label;
        }
        return null;
      },
      chatId,
      excluded,
    );

    // A first name keeps the greeting warm; skip anything that looks like a
    // bare phone number rather than a real name.
    if (!name) return null;
    const first = String(name).trim().split(/\s+/)[0];
    return /^[+\d]/.test(first) ? null : first;
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

// WhatsApp Web ships breaking changes faster than whatsapp-web.js can follow.
// When the live build outruns the library, the library's Store injection fails
// and every chat/contact/group lookup dies (getChat() throws, window.Store is
// undefined) even though messages still flow. Pinning the web build to a known
// snapshot restores those APIs. Set WA_WEB_VERSION to a version from
// https://github.com/wppconnect-team/wa-version (html/<version>.html).
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
  BOT_IDS = [me, lid, process.env.BOT_LID].map((s) => (s || '').replace(/\D/g, '')).filter(Boolean);
  console.log(
    `✅ Group bridge live — linked as +${me} ${name ? '(' + name + ')' : ''}` +
      `${lid ? ' [lid ' + lid + ']' : ''} for org ${ORG_ID}. Trigger: @mention or ${TRIGGER}`,
  );
  // Prove whether group titles are readable from the in-page Store (the
  // library's own getChat() is broken on this build).
  probeGroupTitles();
  // Appointment reminders are posted INTO groups, which only this linked device
  // can do, so the bridge polls AIMS for ones that have come due.
  deliverDueReminders();
  setInterval(deliverDueReminders, REMINDER_POLL_MS);
  // One-shot: preview a notification format on the real device without waiting
  // for the triggering event. Set DEMO_NOTIFY to the message body.
  if (process.env.DEMO_NOTIFY) {
    dmDenzel(process.env.DEMO_NOTIFY).then(() => console.log('   (demo notification sent)'));
  }
});

/** Learn our own LID from a group's member list (client.info omits it here). */
async function discoverBotLid(groupIds) {
  for (const gid of groupIds) {
    for (const m of await groupMembers(gid)) {
      if (m.isMe) {
        const digits = String(m.id).replace(/\D/g, '');
        if (digits && !BOT_IDS.includes(digits)) {
          BOT_IDS.push(digits);
          console.log(`   🪪 own LID discovered: ${digits}`);
        }
        return;
      }
    }
  }
}

async function probeGroupTitles() {
  try {
    const diag = await client.pupPage.evaluate(() => {
      const out = { total: 0, groups: 0, sample: [] };
      try {
        const coll = window.require('WAWebCollections').Chat;
        const models = coll.getModelsArray?.() || coll.models || [];
        out.total = models.length;
        const groups = models.filter((c) => String(c?.id?._serialized || '').endsWith('@g.us'));
        out.groups = groups.length;
        out.sample = groups.slice(0, 5).map((c) => ({
          id: c.id._serialized,
          title: c.formattedTitle || c.name || c.subject || c.groupMetadata?.subject || null,
        }));
      } catch (e) {
        out.err = String(e && e.message ? e.message : e);
      }
      return out;
    });
    console.log(`🔎 chat probe: ${diag.total} chats, ${diag.groups} groups${diag.err ? ' | err ' + diag.err : ''}`);
    // Needed before any mention of us can be recognised.
    await discoverBotLid(diag.sample.map((g) => g.id));
    diag.sample.forEach((g) => console.log(`   • ${g.title || '(no title)'}  [${g.id}]`));
    // Confirm participant/contact name resolution works too (it powers the
    // intro greeting and appointment reminders).
    for (const gid of ALLOWED_GROUPS.length ? ALLOWED_GROUPS : diag.sample.slice(0, 1).map((g) => g.id)) {
      const who = await resolveClientName(gid, '');
      console.log(`   name probe [${gid}] -> ${who || '(unresolved)'}`);
      // List members with their LIDs. In groups WhatsApp identifies people by
      // LID, not phone number, so STAFF_NUMBERS must hold LIDs to match — this
      // is how we find the advisor's.
      for (const m of await groupMembers(gid)) {
        console.log(`      ${String(m.id).padEnd(22)} ${m.isMe ? '(this bot) ' : ''}${m.name || '(no name)'}`);
      }
    }
  } catch (e) {
    console.log(`🔎 store probe failed: ${e && e.message ? e.message : e}`);
  }
}
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

/**
 * Every member of a group with their id and best-known display name. Groups
 * identify people by LID rather than phone number, so this is how the advisor's
 * LID is discovered for STAFF_NUMBERS.
 */
async function groupMembers(chatId) {
  try {
    return await client.pupPage.evaluate((id) => {
      const wid = window.require('WAWebWidFactory').createWid(id);
      const collections = window.require('WAWebCollections');
      const chat = collections.Chat.get(wid);
      const parts = chat?.groupMetadata?.participants;
      const list = parts?.getModelsArray?.() || parts?.models || parts || [];
      return list.map((p) => {
        const serialized = String(p?.id?._serialized || p?.id || '');
        const c = collections.Contact?.get(p.id) || null;
        return {
          id: serialized,
          name: c?.name || c?.formattedName || c?.pushname || c?.verifiedName || null,
          isMe: !!p?.isMe,
        };
      });
    }, chatId);
  } catch (e) {
    console.log(`   ⤷ member list unavailable: ${e && e.message ? e.message : e}`);
    return [];
  }
}

/** Shared helper for the token-gated bridge endpoints. */
async function callBridgeApi(path, { method = 'POST', body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const res = await fetch(`${API_BASE}${path}${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Group-Bridge-Token': BRIDGE_TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `${path} ${res.status}`);
  return json?.data ?? json;
}

/**
 * Cheap pre-filter for appointment posts. Running every staff message through
 * the AI extractor would be wasteful, so we only bother when the text smells
 * like a booking: a date-ish token plus a scheduling word.
 */
function looksLikeAppointment(text) {
  const t = String(text || '');
  if (t.length < 12) return false;
  const hasDate =
    /\b\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t) ||
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i.test(t) ||
    /\b\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b/.test(t) ||
    /\b(today|tomorrow|tmr|next (mon|tue|wed|thu|fri|sat|sun))/i.test(t);
  const hasSchedulingWord = /(date|time|venue|appointment|appt|meet|meeting|session|zoom|call)\b/i.test(t);
  return hasDate && hasSchedulingWord;
}

/** Ask AIMS to parse and store an appointment the advisor just posted. */
async function captureAppointment(msg, chatId, group, clientName) {
  try {
    const appt = await callBridgeApi('/whatsapp/group-appointment', {
      body: {
        organizationId: ORG_ID,
        groupId: chatId,
        groupName: group?.name,
        body: msg.body,
        clientName,
        createdBy: (msg.author || '').split('@')[0],
      },
    });
    if (!appt?.id) return false; // not an appointment after all
    const when = new Date(appt.startsAt).toLocaleString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Singapore',
    });
    const remind = new Date(appt.remindAt).toLocaleString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Singapore',
    });
    console.log(`   📅 appointment ${appt.updated ? 'updated' : 'captured'} ${appt.id} (${when})`);
    await dmDenzel(
      `📅 ${appt.updated ? 'Updated' : 'Noted'}: ${appt.topic || 'appointment'}${appt.venue ? ` at ${appt.venue}` : ''}\n` +
        `${when}${appt.tentative ? ' (tentative)' : ''}\n` +
        `Chat: ${group?.name || chatId}\n\n` +
        `I'll remind ${clientName || 'them'} in the group on ${remind} 🙏`,
    );
    return true;
  } catch (e) {
    console.error('   ✖ appointment capture failed:', e && e.message ? e.message : e);
    return false;
  }
}

/** Post any reminders that have come due into their groups. */
async function deliverDueReminders() {
  try {
    const due = await callBridgeApi('/whatsapp/group-reminders/due', {
      method: 'GET',
      query: { organizationId: ORG_ID },
    });
    if (!Array.isArray(due) || !due.length) return;
    for (const r of due) {
      // Respect the same allowlist that gates replies.
      if (ALLOWED_GROUPS.length && !ALLOWED_GROUPS.includes(r.groupId)) continue;
      try {
        await client.sendMessage(r.groupId, r.message);
        await callBridgeApi(`/whatsapp/group-reminders/${r.id}/sent`, { body: { organizationId: ORG_ID } });
        console.log(`   🔔 reminder posted for ${r.id} in ${r.groupId}`);
      } catch (e) {
        const err = e && e.message ? e.message : String(e);
        console.error(`   ✖ reminder ${r.id} failed:`, err);
        await callBridgeApi(`/whatsapp/group-reminders/${r.id}/sent`, {
          body: { organizationId: ORG_ID, error: err },
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('reminder poll failed:', e && e.message ? e.message : e);
  }
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

/** Phrases the PA uses when it has handed something to Denzel. When a reply
 *  contains one, Denzel gets a heads-up DM — the client was just promised he'd
 *  follow up, so that promise can't depend on him happening to read the group. */
const DENZEL_HANDOFF = /(let me get denzel|denzel will|denzel would|denzel to confirm|denzel's attention|check with denzel|come back to you|denzel sends)/i;

function needsDenzel(reply) {
  return DENZEL_HANDOFF.test(reply || '');
}

/** Resolve a friendly group name and, when possible, a tappable invite link so
 *  Denzel can jump straight into the conversation instead of hunting for it.
 *  getInviteCode only works when the PA is a group admin, so the link is
 *  best-effort and the name alone is a fine fallback. */
/**
 * Read a group's title straight from WhatsApp Web's in-page Store.
 * whatsapp-web.js 1.34.7 cannot build Chat objects against the current web
 * build (getChat() throws), but the Store itself is still populated, so this
 * works where the library's own API does not, and needs no per-group config.
 */
async function storeGroupTitle(chatId) {
  try {
    return await client.pupPage.evaluate((id) => {
      // Read the RAW chat straight from WhatsApp's collection. The library's
      // Chat model serializer (WWebJS.getChatModel) is what throws on this
      // build, so we deliberately skip it and take the title off the model.
      const wid = window.require('WAWebWidFactory').createWid(id);
      const c = window.require('WAWebCollections').Chat.get(wid);
      if (!c) return null;
      return c.formattedTitle || c.name || c.subject || c.groupMetadata?.subject || null;
    }, chatId);
  } catch (e) {
    console.log(`   ⤷ title lookup failed: ${e && e.message ? e.message : e}`);
    return null;
  }
}

/** Invite link via WhatsApp's own module (needs the PA to be a group admin). */
async function storeGroupInviteLink(chatId) {
  try {
    const code = await client.pupPage.evaluate(async (id) => {
      const wid = window.require('WAWebWidFactory').createWid(id);
      const mod =
        window.require('WAWebGroupInviteJob') ||
        window.require('WAWebGroupQueryJob') ||
        null;
      const fn = mod?.queryGroupInviteCode || mod?.sendQueryGroupInviteCode;
      if (!fn) return null;
      const res = await fn(wid);
      return typeof res === 'string' ? res : res?.code || null;
    }, chatId);
    return code ? `https://chat.whatsapp.com/${code}` : null;
  } catch (e) {
    console.log(`   ⤷ invite link unavailable: ${e && e.message ? e.message : e}`);
    return null;
  }
}

async function groupInfo(msg, chatId) {
  // Config wins when present (lets an operator override any title), then the
  // in-page Store, which scales to every group without per-group setup.
  // Config overrides win; otherwise read live from WhatsApp so this scales to
  // every group with no per-group setup.
  const info = { name: GROUP_LABELS[chatId] || null, link: GROUP_LINKS[chatId] || null };
  if (!info.name) info.name = await storeGroupTitle(chatId);
  if (!info.link) info.link = await storeGroupInviteLink(chatId);
  if (!info.name) info.name = chatId;
  return info;
}

/** DM Denzel. Uses the linked device, so unlike the Cloud API this is NOT
 *  restricted by WhatsApp's 24-hour customer-service window. */
async function dmDenzel(text) {
  if (!DENZEL_NUMBERS.length) {
    console.log('   ⤷ DENZEL_NUMBER not set, skipping notification');
    return;
  }
  // Send to each recipient independently so one bad number cannot stop the rest.
  for (const number of DENZEL_NUMBERS) {
    try {
      await client.sendMessage(`${number}@c.us`, text);
      console.log(`   📨 notified ${number}`);
    } catch (e) {
      console.error(`   ✖ notification to ${number} failed:`, e && e.message ? e.message : e);
    }
  }
}

async function notifyDenzel(group, clientMsg, reply) {
  const where = group.link ? `${group.name}\n👉 ${group.link}` : group.name;
  await dmDenzel(
    `🔔 Heads up, a client needs you.\n\n` +
      `Chat: ${where}\n\n` +
      `They said:\n"${String(clientMsg || '').slice(0, 200)}"\n\n` +
      `I replied:\n"${String(reply || '').slice(0, 250)}"\n\n` +
      `Please follow up with them personally 🙏`,
  );
}

client.on('message_create', async (msg) => {
  try {
    const chatId = msg.from;
    if (!(typeof chatId === 'string' && chatId.endsWith('@g.us'))) return; // GROUPS ONLY
    if (ALLOWED_GROUPS.length && !ALLOWED_GROUPS.includes(chatId)) return; // only allowlisted groups
    const from = (msg.author || msg.from || '').split('@')[0];
    const senderDigits = from.replace(/\D/g, '');
    // Staff = the PA's own phone, or any configured STAFF_NUMBERS (Denzel).
    // Everyone else in the group is a client whose messages the PA answers.
    const isStaff =
      !!msg.fromMe || STAFF_NUMBERS.some((s) => s && senderDigits && (senderDigits.includes(s) || s.includes(senderDigits)));
    const who = from + (msg.fromMe ? ' (linked phone)' : isStaff ? ' (staff)' : ' (client)');
    const mentions = mentionedDigits(msg);
    console.log(`👥 [${chatId}] ${who}: ${msg.body}${mentions.length ? '  «mentions ' + mentions.join(',') + '»' : ''}`);

    const mentioned = botMentioned(msg);
    const introName = nameFromIntro(msg.body);
    // Intro summon: our number is @mentioned + "this is <name>" — but because
    // WhatsApp masks numbers as LIDs, also accept ANY @mention paired with the
    // "this is <name>" phrase (that shape is unambiguously an intro to the PA).
    // Intro requires a genuine @mention of the PA's own number. Text like
    // "@pa" is not enough: the advisor tags real people constantly, and any
    // looser rule made the PA introduce itself into client conversations.
    const isIntro = introName && mentioned;
    // Explicit summon: @mention of us, or the legacy @pa text.
    const summoned = mentioned || TRIGGER.test(msg.body || '');

    // A CLIENT never has to tag the PA — every message they send is considered
    // for a templated answer (the agent's template gate decides whether to
    // reply at all). Staff messages are only acted on when they summon the PA
    // explicitly or send the intro.
    // Staff posting a booking: capture it and remind the client later. This is
    // checked before the summon gate because the advisor may just drop the
    // details in without tagging the PA.
    if (isStaff && !isIntro && looksLikeAppointment(msg.body)) {
      const group = await groupInfo(msg, chatId);
      const clientName = await resolveClientName(chatId, msg.author);
      const captured = await captureAppointment(msg, chatId, group, clientName);
      if (captured) return;
    }

    if (!isIntro && !summoned && isStaff) {
      console.log('   ⤷ ignored: staff message, not a summon');
      return;
    }

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
    const group = await groupInfo(msg, chatId);
    setTimeout(async () => {
      try {
        await client.sendMessage(chatId, reply);
        lastReplyAt = Date.now();
        console.log(`   🤖 delayed reply sent: ${reply.slice(0, 70)}…`);
        // If the PA just promised that Denzel would follow up, tell Denzel —
        // otherwise the promise silently depends on him reading the group.
        if (needsDenzel(reply)) await notifyDenzel(group, msg.body, reply);
      } catch (e) {
        console.error('   ✖ delayed send failed:', e && e.message ? e.message : e);
      }
    }, REPLY_DELAY_MS);
  } catch (e) {
    console.error('handler error:', e && e.message ? e.message : e);
  }
});

client.initialize();
