/**
 * AIMS WhatsApp POST bridge (unofficial whatsapp-web.js linked device).
 *
 * POST-ONLY. It never reads, answers or reacts to any message: DMs stay with
 * the official Cloud API on the same number, so nothing is ever answered twice.
 * All it does:
 *   - post signed deliveries into WhatsApp groups (caption, photos, signed DO
 *     PDF), from AIMS's delivery group post queue;
 *   - report the groups this number is in (the portal's group dropdowns);
 *   - a heartbeat every 60 s (AIMS rings the office bell after 5 min of silence).
 *
 * Never double-posts: AIMS hands a post to exactly one claimer (atomic claim
 * with a lease), and this worker journals every part it has sent on the
 * persistent disk BEFORE acknowledging. A post re-offered after a crash resumes
 * after the last part sent, so nothing is posted twice.
 *
 *   cp .env.example .env   # fill in the values
 *   node bridge.js         # prints the QR in the log; scan it from the phone
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_BASE = (process.env.AIMS_API_BASE || 'http://localhost:4040').replace(/\/+$/, '');
const TOKEN = process.env.AIMS_POST_TOKEN || '';
// Kill switch: false = still reports groups and heartbeats, posts NOTHING.
const POST_ENABLED = /^(1|true|yes)$/i.test(process.env.POST_ENABLED || '');
const POLL_MS = Number(process.env.POLL_MS || 30 * 1000);
const MEDIA_GAP_MS = Number(process.env.MEDIA_GAP_MS || 2000); // paced, never a burst
const GROUPS_REPORT_MS = Number(process.env.GROUPS_REPORT_MS || 10 * 60 * 1000);
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const SESSION_DIR = process.env.SESSION_DIR || './.wwebjs_auth';
const STATE_DIR = process.env.STATE_DIR || path.dirname(path.resolve(SESSION_DIR));
const JOURNAL_FILE = path.join(STATE_DIR, 'post-journal.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The poster (exported so it can be tested without a phone) ───────────────

/**
 * @param {object} o
 * @param {(chatId: string, content: any, options?: object) => Promise<any>} o.send  sends one message, returns the sent message
 * @param {(mime: string, b64: string, filename: string) => any} o.makeMedia  builds a MessageMedia
 * @param {string} o.api   AIMS API base
 * @param {string} o.token post bridge token
 * @param {string} o.journalFile
 * @param {number} [o.gapMs]
 * @param {number} [o.partAttempts]   tries per part before the post is reported failed (default 3)
 * @param {number[]} [o.partBackoffMs] waits between those tries
 * @param {(m: string) => void} [o.log]
 */
function createPoster(o) {
  const log = o.log || console.log;
  const gap = o.gapMs ?? MEDIA_GAP_MS;
  const partAttempts = o.partAttempts ?? 3;
  const partBackoff = o.partBackoffMs ?? [2000, 5000];

  const api = async (method, p, body) => {
    const res = await fetch(`${o.api}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Post-Bridge-Token': o.token },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || `${p} ${res.status}`);
    return json?.data ?? json;
  };

  // Journal: jobId -> { sent: parts already posted, ids: WhatsApp message ids }.
  // Written (and fsynced) after EVERY part, before anything is acknowledged.
  const readJournal = () => {
    try {
      return JSON.parse(fs.readFileSync(o.journalFile, 'utf8')) || {};
    } catch {
      return {};
    }
  };
  const writeJournal = (j) => {
    const tmp = `${o.journalFile}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, JSON.stringify(j));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, o.journalFile);
  };
  const prune = (j) => {
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    for (const [k, v] of Object.entries(j)) if (v.done && v.at < cutoff) delete j[k];
    return j;
  };

  const fetchMedia = async (url, filename) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${filename}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_MEDIA_BYTES) throw new Error(`${filename} is ${buf.length} bytes, over the limit`);
    const mime = (res.headers.get('content-type') || '').split(';')[0] || (filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
    return o.makeMedia(mime, buf.toString('base64'), filename);
  };

  /** Post one job. Returns 'sent' | 'resumed' | 'skipped' | 'failed'. */
  async function processJob(job) {
    const parts = [
      { kind: 'text', text: job.caption },
      ...(job.photos || []).map((p) => ({ kind: 'photo', ...p })),
      ...(job.documents || []).map((d) => ({ kind: 'doc', ...d })),
    ];
    const claim = await api('POST', `/wa-post/jobs/${job.id}/claim`, {});
    if (!claim?.claimed) return 'skipped';
    const journal = prune(readJournal());
    const entry = journal[job.id] || { sent: 0, ids: [], at: Date.now() };
    const resumed = entry.sent > 0;
    if (entry.sent >= parts.length) {
      // Everything went out before a crash/timeout; only the ack was lost.
      await api('POST', `/wa-post/jobs/${job.id}/done`, { ok: true, resumed: true, messageIds: entry.ids });
      entry.done = true;
      journal[job.id] = entry;
      writeJournal(journal);
      log(`   ↺ post ${job.id.slice(0, 8)} already sent before a restart: acknowledged, not re-sent`);
      return 'resumed';
    }
    try {
      for (let i = entry.sent; i < parts.length; i++) {
        const part = parts[i];
        // Retry THIS part only, a few times, before giving up on the post.
        // Parts already sent are behind `entry.sent` and are never repeated.
        let msg;
        for (let attempt = 1; ; attempt++) {
          try {
            if (part.kind === 'text') msg = await o.send(job.groupId, part.text);
            else if (part.kind === 'photo') msg = await o.send(job.groupId, await fetchMedia(part.url, part.filename));
            else msg = await o.send(job.groupId, await fetchMedia(part.url, part.filename), { sendMediaAsDocument: true });
            break;
          } catch (e) {
            const err = e && e.message ? e.message : String(e);
            if (attempt >= partAttempts) throw new Error(`part ${i + 1}/${parts.length} (${part.kind}${part.filename ? ` ${part.filename}` : ''}): ${err}`);
            log(`   ↻ part ${i + 1}/${parts.length} (${part.kind}) failed, retrying: ${err}`);
            await sleep(partBackoff[attempt - 1] ?? partBackoff[partBackoff.length - 1]);
          }
        }
        entry.sent = i + 1;
        entry.at = Date.now();
        const id = msg?.id?._serialized || msg?.id?.id;
        if (id) entry.ids.push(String(id));
        journal[job.id] = entry;
        writeJournal(journal);
        if (i < parts.length - 1) await sleep(gap);
      }
      await api('POST', `/wa-post/jobs/${job.id}/done`, { ok: true, messageIds: entry.ids, ...(resumed ? { resumed: true } : {}) });
      entry.done = true;
      journal[job.id] = entry;
      writeJournal(journal);
      log(`   ✅ posted delivery ${job.id.slice(0, 8)} to ${job.groupName || job.groupId} (${parts.length} parts${resumed ? ', resumed' : ''})`);
      return 'sent';
    } catch (e) {
      const err = e && e.message ? e.message : String(e);
      log(`   ✖ post ${job.id.slice(0, 8)} failed after ${entry.sent}/${parts.length} parts: ${err}`);
      // The journal keeps what did go out, so a retry continues from there.
      await api('POST', `/wa-post/jobs/${job.id}/done`, { ok: false, error: err }).catch(() => null);
      return 'failed';
    }
  }

  async function pollOnce() {
    const res = await api('GET', '/wa-post/jobs');
    const out = [];
    for (const job of res?.jobs || []) out.push(await processJob(job));
    return out;
  }

  return { processJob, pollOnce, api, readJournal };
}

module.exports = { createPoster };

// ── The worker ──────────────────────────────────────────────────────────────

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

function main() {
  if (!TOKEN) {
    console.error('❌ Set AIMS_POST_TOKEN (a key of WA_POST_BRIDGES on the API)');
    process.exit(1);
  }
  const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
  const qrcode = require('qrcode');
  clearChromiumLocks(SESSION_DIR);
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const WA_WEB_VERSION = process.env.WA_WEB_VERSION;
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    ...(WA_WEB_VERSION
      ? { webVersionCache: { type: 'remote', remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${WA_WEB_VERSION}.html` } }
      : {}),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  const poster = createPoster({
    api: API_BASE,
    token: TOKEN,
    journalFile: JOURNAL_FILE,
    send: (chatId, content, options) => client.sendMessage(chatId, content, options),
    makeMedia: (mime, b64, filename) => new MessageMedia(mime, b64, filename),
  });

  let ready = false;
  let polling = false;

  client.on('qr', async (qr) => {
    const ascii = await qrcode.toString(qr, { type: 'terminal', small: true });
    console.log('\n📱 Scan this QR from the posting number (WhatsApp Business → Linked devices → Link a device):\n' + ascii);
    console.log(`QR_RAW:: ${qr}`); // one line, so it can be copied out of the log
  });
  client.on('authenticated', () => console.log('🔐 authenticated'));
  client.on('disconnected', (r) => {
    ready = false;
    console.warn('⚠️ disconnected:', r);
  });
  // Deliberately NO 'message' / 'message_create' handlers: this worker only posts.

  async function listGroups() {
    try {
      return await client.pupPage.evaluate(() => {
        const coll = window.require('WAWebCollections').Chat;
        const models = coll.getModelsArray?.() || coll.models || [];
        return models
          .filter((c) => String(c?.id?._serialized || '').endsWith('@g.us'))
          .map((c) => ({ id: c.id._serialized, name: c.formattedTitle || c.name || c.subject || c.groupMetadata?.subject || null }))
          .filter((g) => g.name);
      });
    } catch (e) {
      console.error('   ✖ listGroups failed:', e && e.message ? e.message : e);
      return [];
    }
  }

  async function reportGroups() {
    if (!ready) return;
    const groups = await listGroups();
    if (!groups.length) return;
    try {
      await poster.api('POST', '/wa-post/groups', { groups });
      console.log(`📋 reported ${groups.length} groups`);
      if (/^(1|true|yes)$/i.test(process.env.LIST_GROUPS || '')) for (const g of groups) console.log(`GROUP:: ${g.name} -> ${g.id}`);
    } catch (e) {
      console.error('   ✖ group report failed:', e && e.message ? e.message : e);
    }
  }

  async function heartbeat() {
    if (!ready) return; // a logged-out device goes quiet so AIMS raises the alarm
    await poster.api('POST', '/wa-post/heartbeat', {}).catch((e) => console.error('   ✖ heartbeat failed:', e && e.message ? e.message : e));
  }

  async function poll() {
    if (!ready || !POST_ENABLED || polling) return;
    polling = true;
    try {
      await poster.pollOnce();
    } catch (e) {
      console.error('poll failed:', e && e.message ? e.message : e);
    } finally {
      polling = false;
    }
  }

  client.on('ready', () => {
    ready = true;
    console.log(`ACCOUNT:: ${client.info?.wid?.user || 'unknown'} (${client.info?.pushname || ''})`);
    console.log(`✅ Post bridge live. Posting ${POST_ENABLED ? 'ON' : 'OFF (POST_ENABLED is not true)'}; polling every ${POLL_MS / 1000}s.`);
    setTimeout(reportGroups, 20 * 1000);
    heartbeat();
  });

  setInterval(heartbeat, 60 * 1000);
  setInterval(reportGroups, GROUPS_REPORT_MS);
  setInterval(poll, POLL_MS);
  client.initialize();
}

if (require.main === module) main();
