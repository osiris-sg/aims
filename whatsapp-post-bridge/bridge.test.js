// Run: node --test (no phone, no network). The poster against a fake AIMS API and a fake WhatsApp send.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPoster } = require('./bridge');

function harness({ failOn = {}, hungOn = null } = {}) {
  const sent = [];
  const acks = [];
  const sleeps = [];
  const journalFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-post-')), 'journal.json');
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://s3/')) return { ok: true, headers: { get: () => (u.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg') }, arrayBuffer: async () => Buffer.from(u) };
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (u.endsWith('/claim')) return { ok: true, json: async () => ({ claimed: true }) };
    if (u.endsWith('/done')) acks.push(body);
    return { ok: true, json: async () => ({}) };
  };
  let hungCalls = 0;
  const poster = createPoster({
    api: 'https://aims',
    token: 't',
    journalFile,
    gapMs: 1,
    batchPauseMs: 99,
    partBackoffMs: [0, 0],
    log: () => {},
    makeMedia: (mime, b64, filename) => ({ mime, filename }),
    send: async (chatId, content) => {
      const name = typeof content === 'string' ? `text:${content}` : content.filename;
      if (hungOn === name) throw new Error('Runtime.callFunctionOn timed out. Increase the protocolTimeout setting');
      if (failOn[name] > 0) {
        failOn[name]--;
        throw new Error('network blip');
      }
      sent.push(name);
      return { id: { _serialized: `m${sent.length}` } };
    },
    onHung: async () => {
      hungCalls++;
    },
  });
  return { poster, sent, acks, sleeps, journalFile, hungCalls: () => hungCalls };
}

const job = (photos) => ({
  id: 'job-1',
  groupId: 'g@g.us',
  caption: 'Delivery #95',
  documents: [{ url: 'https://s3/DO.pdf', filename: 'DO202611099-signed.pdf' }],
  photos: Array.from({ length: photos }, (_, i) => ({ url: `https://s3/p${i + 1}.jpg`, filename: `photo-${i + 1}.jpg` })),
});

test('caption, then the signed DO, then the photos in order', async () => {
  const h = harness();
  assert.equal(await h.poster.processJob(job(3)), 'sent');
  assert.deepEqual(h.sent, ['text:Delivery #95', 'DO202611099-signed.pdf', 'photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg']);
  assert.equal(h.acks.at(-1).ok, true);
});

test('a longer pause after every 10th photo', async () => {
  const h = harness();
  const waits = [];
  const real = global.setTimeout;
  global.setTimeout = (fn, ms) => {
    waits.push(ms);
    return real(fn, 0);
  };
  try {
    await h.poster.processJob(job(25));
  } finally {
    global.setTimeout = real;
  }
  // 27 parts, 26 waits: after photo 10 and photo 20 the batch pause, every other gap 1 ms.
  assert.equal(waits.length, 26);
  assert.deepEqual(waits.map((w, i) => (w === 99 ? i : null)).filter((x) => x !== null), [11, 21]);
});

test('a blip is retried in place and nothing is sent twice', async () => {
  const h = harness({ failOn: { 'photo-2.jpg': 2 } });
  assert.equal(await h.poster.processJob(job(3)), 'sent');
  assert.deepEqual(h.sent, ['text:Delivery #95', 'DO202611099-signed.pdf', 'photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg']);
});

test('a hung page hands the post back and restarts; the restart resumes after the last part sent', async () => {
  const h = harness({ hungOn: 'photo-2.jpg' });
  assert.equal(await h.poster.processJob(job(3)), 'restarting');
  assert.equal(h.hungCalls(), 1);
  assert.equal(h.acks.at(-1).ok, false);
  assert.match(h.acks.at(-1).error, /^bridge restarting: part 4\/5 \(photo photo-2\.jpg\)/);
  assert.deepEqual(h.sent, ['text:Delivery #95', 'DO202611099-signed.pdf', 'photo-1.jpg']);

  // The restarted worker (same journal on disk) gets the post again.
  const again = harness();
  const resumed = createPoster({ ...{ api: 'https://aims', token: 't', journalFile: h.journalFile, gapMs: 1, log: () => {} }, makeMedia: (m, b, f) => ({ filename: f }), send: async (c, content) => (again.sent.push(typeof content === 'string' ? content : content.filename), { id: { _serialized: 'x' } }) });
  assert.equal(await resumed.processJob(job(3)), 'sent');
  assert.deepEqual(again.sent, ['photo-2.jpg', 'photo-3.jpg']);
});
