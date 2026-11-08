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
 *   3. relay the GROUPS named in WATCH_GROUPS, and nothing else
 *   4. carry the attachments with them
 *
 * Groups were out of scope at first ("this agent wont be in grps so dont
 * worry"). They are in scope now, for one reason: an invoice posted into a
 * client group is work AIMS should see (guru 2026-10-24). They stay OPT-IN per
 * group, because this phone belongs to the company and sits in plenty of chats
 * that are none of AIMS's business. WATCH_GROUPS empty means no groups at all,
 * exactly as before.
 *
 * It sends almost nothing to WhatsApp and never posts into a group. The ONE
 * exception (guru 2026-11-08): when AIMS's reply to a relayed 1:1 message
 * carries an autoReply (the lead flow's name-ask and hand-over confirmation),
 * the bridge sends that exact text back to that chat. All policy lives in
 * AIMS; the bridge stays dumb.
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
/**
 * Wipe the stored session so the next boot asks for a fresh QR.
 *
 * A login that is interrupted part-way — a crash, an OOM kill — can leave the
 * LocalAuth store half-written: enough for the library to try restoring it,
 * not enough to authenticate, so it fails in `inject` on every boot and no QR
 * is ever offered. There is no shell on this host, so recovery has to be a
 * flag: set RESET_SESSION=1, let it boot once, then REMOVE the variable
 * (leaving it set would throw the link away on every future restart).
 */
function resetSession(dir) {
  try {
    fs.rmSync(dir, { force: true, recursive: true });
    console.log(`🧹 RESET_SESSION — cleared ${dir}; a fresh QR follows`);
    console.log('   ⚠ remove RESET_SESSION now, or the next restart unlinks the phone');
  } catch (err) {
    console.error(`⚠ could not clear ${dir}: ${err.message}`);
  }
}
if (process.env.RESET_SESSION === '1') resetSession(SESSION_DIR);
clearChromiumLocks(SESSION_DIR);

// Pin the WhatsApp Web build when WA_WEB_VERSION is set. LEAVE IT UNSET.
//
// It is here only as an escape hatch. The first link attempts failed for a
// reason that had nothing to do with the web build: this service was created
// on the `starter` plan (512Mi) while the group bridge runs `standard` (2GB),
// and Chromium was OOM-killed mid-login every 40-90 seconds — six times in
// four minutes. Render's EVENTS showed `oomKilled { memoryLimit: "512Mi" }`
// the whole time; the LOGS showed only "Instance restarted", which is why the
// crash loop read as a WhatsApp-side revocation and sent the investigation
// after the library and the web build instead.
//
// Pinning a snapshot that disagrees with the live client is not harmless: the
// page reloads under the library and `Client.inject` dies with "Execution
// context was destroyed". If a link will not complete, check the service plan
// and the service events BEFORE touching this.
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

/**
 * Which groups this bridge relays, and how big a file it will carry.
 *
 * WATCH_GROUPS is a comma-separated list of group jids
 * (120363...@g.us) or case-insensitive name fragments ("CIEL INVOICE").
 * Empty means NO groups, which is how this bridge has always behaved: the
 * phone it runs on is in chats that have nothing to do with AIMS, so watching
 * is opt-in per group rather than all-or-nothing.
 */
// Message types that are real conversation. Everything else WhatsApp emits
// (e2e_notification, notification_template, gp2 membership notices, protocol
// messages, calls, polls) is plumbing, not something anyone typed.
const RELAYED_TYPES = new Set([
  'chat', 'image', 'video', 'audio', 'ptt', 'document', 'sticker', 'location', 'vcard', 'multi_vcard',
]);

const WATCH_GROUPS = String(process.env.WATCH_GROUPS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const MAX_MEDIA_BYTES = Number(process.env.MAX_MEDIA_BYTES || 15 * 1024 * 1024);

/** jid -> group name, filled by reportGroups so rows read like the chat does. */
const groupNames = new Map();

function isWatchedGroup(groupId) {
  if (!WATCH_GROUPS.length) return false;
  const name = String(groupNames.get(groupId) || '').toLowerCase();
  return WATCH_GROUPS.some((w) => {
    if (w.endsWith('@g.us')) return w === groupId;
    return name.includes(w.toLowerCase());
  });
}

/**
 * Tell AIMS which groups this phone is in.
 *
 * Saves asking someone to open WhatsApp and read a member list, and it is the
 * only way to learn a group's jid without guessing. Runs at startup and then
 * hourly, since groups get created and renamed.
 */
let linked = false; // set on ready, cleared on disconnect

async function reportGroups(attempt = 1) {
  // AN UNLINKED CLIENT HAS NO CHATS, WHICH IS NOT THE SAME AS NO GROUPS.
  //
  // When the device is logged out this function used to happily report zero,
  // overwriting a known-good list with an empty one. Reading the endpoint then
  // said "this phone is in no groups", which is a confident wrong answer to
  // exactly the question the endpoint exists to settle (2026-11-03).
  if (!linked) {
    console.log('   ↷ group report skipped: device is not linked');
    return;
  }
  try {
    // Read WhatsApp's OWN collection rather than calling getChats().
    //
    // getChats() fails against the current web build with a minified "r: r"
    // thrown from inside the page, and it keeps failing a minute later, so it
    // is broken rather than slow. The group bridge has read the store directly
    // since August on this same library version, so this is the proven path,
    // not a workaround invented here.
    const groups = await client.pupPage.evaluate(() => {
      const coll = window.require('WAWebCollections').Chat;
      const models = coll.getModelsArray?.() || coll.models || [];
      return models
        .filter((c) => String(c?.id?._serialized || '').endsWith('@g.us'))
        .map((c) => ({
          id: c.id._serialized,
          name: c.formattedTitle || c.name || c.subject || c.groupMetadata?.subject || '',
        }));
    });
    for (const g of groups) groupNames.set(g.id, g.name);
    await post('/whatsapp/dm-bridge/groups', { key: LABEL, groups });
    const watched = groups.filter((g) => isWatchedGroup(g.id));
    console.log(
      `👥 ${groups.length} group(s) on this phone; watching ${watched.length}` +
        `${watched.length ? ': ' + watched.map((g) => g.name).join(', ') : ''}`,
    );
    for (const g of groups) console.log(`     ${g.id}  ${g.name}`);
  } catch (e) {
    const detail = e && (e.stack || e.message) ? e.stack || e.message : String(e);
    if (attempt < 5) {
      const wait = attempt * 15_000;
      console.error(`   ↷ group report attempt ${attempt} failed (${String(detail).slice(0, 120)}), retrying in ${wait / 1000}s`);
      setTimeout(() => reportGroups(attempt + 1), wait);
      return;
    }
    console.error('✖ group report failed after 5 attempts:', String(detail).slice(0, 400));
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
client.on('disconnected', (r) => {
  linked = false;
  console.error('✖ disconnected:', r);
});

// BETWEEN 'authenticated' AND 'ready' THERE WAS SILENCE.
//
// A restart on 2026-10-24 logged "🔐 authenticated" and then nothing for half
// an hour: no crash, no OOM, no QR, no error. The client was syncing, which
// is a normal state, but the bridge said nothing while it happened, so a long
// sync and a hung process looked identical from the outside.
//
// whatsapp-web.js reports both. Logging them costs nothing and is the
// difference between "stuck" and "47% through a resync, leave it alone".
client.on('loading_screen', (percent, message) =>
  console.log(`⏳ loading ${percent ?? '?'}% ${message || ''}`.trimEnd()),
);
client.on('change_state', (state) => console.log(`↔ state: ${state}`));
client.on('auth_failure', (m) => console.error('✖ auth failure:', m));

client.on('ready', () => {
  const me = client.info?.wid?.user || 'unknown';
  const name = client.info?.pushname || '';
  linked = true;
  console.log(`✅ ${LABEL} live — linked as +${me} ${name ? '(' + name + ')' : ''} for org ${ORG_ID}`);
  console.log(
    `   Relaying 1:1 messages${WATCH_GROUPS.length ? ` plus ${WATCH_GROUPS.length} watched group pattern(s)` : ' only'}. This bridge never sends.`,
  );
  // Not straight away: the chat store is still filling when 'ready' fires.
  // Hourly after that, to pick up renames and new chats.
  setTimeout(() => reportGroups(), 15_000);
  setInterval(() => reportGroups(), 60 * 60 * 1000);
});

// message_create fires for BOTH directions, which is what makes the thread
// complete: replies typed by hand on the phone are relayed too, not just
// inbound. A Cloud API connection gets that from smb_message_echoes; here it
// comes for free.
client.on('message_create', async (msg) => {
  try {
    const chatId = String(msg.from || '');
    const toId = String(msg.to || '');
    if (chatId.startsWith('status@') || toId.startsWith('status@')) return; // status broadcasts are noise

    // WhatsApp's own housekeeping is not conversation. Linking a device fires
    // a burst of e2e key notices, each of which was landing in CRM as a
    // message from a stranger — 43 such rows on CIEL before this (guru
    // 2026-11-08). Only real chat types are relayed.
    // (The notification_template exception is GONE — incident 2026-11-08: that
    // type is WhatsApp's own e2e housekeeping, bursting for existing chats on
    // every relink. The lead flow now rides the intro going OUT.)
    if (!RELAYED_TYPES.has(String(msg.type || 'chat'))) return;

    const groupId = chatId.endsWith('@g.us') ? chatId : toId.endsWith('@g.us') ? toId : null;
    // GROUPS are opt-in, one at a time. This bridge lives on a company phone
    // that sits in plenty of chats which are none of AIMS's business, so a
    // group is relayed only when WATCH_GROUPS names it. Everything else is
    // dropped exactly as before.
    if (groupId && !isWatchedGroup(groupId)) return;

    const outbound = !!msg.fromMe;
    const counterparty = groupId
      ? groupId
      : (outbound ? toId : chatId).split('@')[0].replace(/\D/g, '');
    if (!counterparty) return;

    const body = String(msg.body || '');
    // Media arrives with an empty body; record the kind so the thread is not
    // full of unexplained blanks.
    const text = body || (msg.type && msg.type !== 'chat' ? `[${msg.type}]` : '');

    // Pull the FILE down, not just its label. An invoice photographed into a
    // group is the reason for watching it, and "[image]" is not an invoice.
    // Big files are skipped rather than held in memory.
    let attachment;
    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media?.data) {
          const bytes = Buffer.byteLength(media.data, 'base64');
          if (bytes > MAX_MEDIA_BYTES) {
            console.log(`   ↷ media skipped (${Math.round(bytes / 1e6)}MB > ${Math.round(MAX_MEDIA_BYTES / 1e6)}MB)`);
          } else {
            attachment = { base64: media.data, mimetype: media.mimetype, filename: media.filename || undefined };
          }
        }
      } catch (e) {
        console.error('   ✖ media download failed:', e && e.message ? e.message : e);
      }
    }

    const res = await post('/whatsapp/dm-bridge/message', {
      organizationId: ORG_ID,
      direction: outbound ? 'OUTBOUND' : 'INBOUND',
      counterparty,
      body: text,
      waMessageId: msg.id?._serialized || undefined,
      sentAt: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : undefined,
      payload: { type: msg.type, hasMedia: !!msg.hasMedia, from: chatId, to: toId },
      ...(groupId
        ? {
            groupId,
            groupName: groupNames.get(groupId) || undefined,
            // In a group the sender is a person, not the chat itself.
            senderPhone: String(msg.author || '').split('@')[0].replace(/\D/g, '') || undefined,
          }
        : {}),
      ...(attachment ? { attachment } : {}),
    });
    // The API wraps every response as { success, data, message }, so the flag
    // lives one level down — reading res.stored was always undefined and this
    // line had never once printed (guru 2026-11-08: the log looked dead while
    // the relay was in fact working).
    const stored = (res && res.data ? res.data : res) || {};
    // AIMS decided this 1:1 message deserves an automated reply (lead flow —
    // e.g. the name-ask that follows the ad's own intro going out).
    if (stored.autoReply && !groupId) {
      const replyTo = msg.fromMe ? toId : chatId;
      try {
        await client.sendMessage(replyTo, String(stored.autoReply));
        console.log('auto-replied to ' + counterparty + ': ' + String(stored.autoReply).slice(0, 60));
      } catch (e) {
        console.error('auto-reply failed:', e && e.message ? e.message : e);
      }
    }
    if (stored.stored) {
      const where = groupId ? `[${groupNames.get(groupId) || groupId}]` : counterparty;
      console.log(`${outbound ? '→' : '←'} ${where}  ${text.slice(0, 60)}${attachment ? `  📎 ${attachment.filename || attachment.mimetype}` : ''}`);
    }
  } catch (e) {
    console.error('✖ relay failed:', e && e.message ? e.message : e);
  }
});

/**
 * Boot, and survive a failed boot.
 *
 * `initialize()` rejecting used to take the whole process down as an unhandled
 * rejection, so one bad startup became a restart loop and the real message was
 * buried under "Instance restarted". Retry with a backoff instead, and clear
 * the Chromium locks each time — a killed container leaves them behind and
 * they are what makes the SECOND attempt fail for a different reason than the
 * first.
 */
let bootAttempt = 0;
async function boot() {
  bootAttempt += 1;
  try {
    await client.initialize();
  } catch (err) {
    const wait = Math.min(60_000, 5_000 * bootAttempt);
    console.error(`✖ initialize failed (attempt ${bootAttempt}): ${err && err.message ? err.message : err}`);
    console.error(`   retrying in ${Math.round(wait / 1000)}s`);
    clearChromiumLocks(SESSION_DIR);
    setTimeout(boot, wait);
  }
}
boot();

// Never let a stray rejection kill a long-lived relay; log it and keep the
// linked device alive.
process.on('unhandledRejection', (err) => {
  console.error('⚠ unhandled rejection:', err && err.message ? err.message : err);
});

/**
 * WHY A REDEPLOY KEPT COSTING THE LINK (guru 2026-11-08: "when i redeploy why
 * must i keep on connecting").
 *
 * The disk, the mount and SESSION_DIR were all correct — the session was
 * being WRITTEN to the right place and still would not restore. The cause was
 * the exit, not the storage: Render sends SIGTERM on every redeploy, Node had
 * no handler, so the process and its Chromium died on the spot. WhatsApp's
 * session lives in a LevelDB profile that is being written continuously; kill
 * it mid-write and what survives on the disk is a torn database. On the next
 * boot the library restores it, WhatsApp rejects it, and the worker falls
 * back to a QR. The persistent disk did its job faithfully — it persisted a
 * broken session.
 *
 * So close Chromium properly and give it time to flush. The hard exit stays as
 * a backstop: if the close hangs we would rather die than be SIGKILLed later
 * at an even worse moment, and Render allows 30s before it stops asking.
 */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n⏻ ${signal} — closing the linked session cleanly so it survives the restart`);
  const hardExit = setTimeout(() => {
    console.error('   ✖ close did not finish in 20s, exiting anyway');
    process.exit(0);
  }, 20_000);
  try {
    await client.destroy();
    console.log('   ✅ session closed; the next boot should restore it without a QR');
  } catch (e) {
    console.error('   ✖ close failed:', e && e.message ? e.message : e);
  }
  clearTimeout(hardExit);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
