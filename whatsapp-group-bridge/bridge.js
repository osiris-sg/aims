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
require('dotenv').config();

const API_BASE = process.env.AIMS_API_BASE || 'http://localhost:4040';
const ORG_ID = process.env.AIMS_ORG_ID; // which org's trained agent to use
const BRIDGE_TOKEN = process.env.AIMS_GROUP_BRIDGE_TOKEN;
const TRIGGER = new RegExp(process.env.TRIGGER || '@pa\\b', 'i');
const MIN_REPLY_GAP_MS = Number(process.env.MIN_REPLY_GAP_MS || 4000); // gentle self-throttle

if (!ORG_ID || !BRIDGE_TOKEN) {
  console.error('❌ Set AIMS_ORG_ID and AIMS_GROUP_BRIDGE_TOKEN in .env');
  process.exit(1);
}

let lastReplyAt = 0;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});

client.on('qr', async (qr) => {
  await qrcode.toFile(__dirname + '/qr.png', qr, { width: 480, margin: 2 });
  console.log('\n📱 QR saved to qr.png — scan it from the number that will run in groups.\n');
});
client.on('authenticated', () => console.log('🔐 authenticated'));
client.on('ready', () => console.log(`✅ Group bridge live for org ${ORG_ID}. Trigger: ${TRIGGER}`));
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

client.on('message_create', async (msg) => {
  try {
    const chatId = msg.from;
    if (!(typeof chatId === 'string' && chatId.endsWith('@g.us'))) return; // GROUPS ONLY
    const from = (msg.author || msg.from || '').split('@')[0];
    const who = from + (msg.fromMe ? ' (linked phone)' : '');
    console.log(`👥 [${chatId}] ${who}: ${msg.body}`);

    if (!TRIGGER.test(msg.body || '')) return; // summon-only

    if (Date.now() - lastReplyAt < MIN_REPLY_GAP_MS) {
      console.log('   ⏳ throttled (too soon since last reply)');
      return;
    }

    const { reply, reason } = await askAgent(chatId, from, msg.body);
    if (!reply) {
      console.log(`   🤖 no reply (${reason || 'held/empty'})`);
      return;
    }
    await client.sendMessage(chatId, reply);
    lastReplyAt = Date.now();
    console.log(`   🤖 replied: ${reply.slice(0, 80)}…`);
  } catch (e) {
    console.error('handler error:', e && e.message ? e.message : e);
  }
});

client.initialize();
