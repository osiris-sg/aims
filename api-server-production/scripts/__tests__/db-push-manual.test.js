// npm run test:pushguard  — the hand-push guard (db:push:prod / :staging).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, PROJECTS } = require('../db-push-manual');

const tty = { isTTY: true };
const io = () => { const e = []; return { errors: e, error: (m) => e.push(m), log: () => {} }; };

test('refuses non-TTY', async () => {
  const o = io();
  let ran = false;
  const code = await run({ argv: ['prod'], env: {}, stdin: {}, stdout: tty, io: o, mainImpl: async () => { ran = true; return 0; } });
  assert.equal(code, 1);
  assert.equal(ran, false);
  assert.match(o.errors[0], /interactive terminal/);
});

test('refuses --accept-data-loss without ALLOW_DATA_LOSS_PUSH=1, and unknown args', async () => {
  const mainImpl = async () => 0;
  assert.equal(await run({ argv: ['prod', '--accept-data-loss'], env: {}, stdin: tty, stdout: tty, io: io(), mainImpl }), 1);
  assert.equal(await run({ argv: ['prod', '--force-reset'], env: {}, stdin: tty, stdout: tty, io: io(), mainImpl }), 2);
  assert.equal(await run({ argv: ['production'], env: {}, stdin: tty, stdout: tty, io: io(), mainImpl }), 2);
});

test('typed project name gates the push; data-loss flag passes through only with the env', async () => {
  let opts;
  const mainImpl = async (o) => { opts = o; return (await o.confirm({ blocked: [] })) ? 0 : 1; };
  assert.equal(await run({ argv: ['prod'], env: {}, stdin: tty, stdout: tty, io: io(), mainImpl, askImpl: async () => 'yes' }), 1);
  assert.equal(await run({ argv: ['prod'], env: {}, stdin: tty, stdout: tty, io: io(), mainImpl, askImpl: async () => ` ${PROJECTS.prod}\n` }), 0);
  assert.equal(opts.acceptDataLoss, false);
  assert.equal(await run({ argv: ['staging'], env: {}, stdin: tty, stdout: tty, io: io(), mainImpl, askImpl: async () => PROJECTS.prod }), 1);
  assert.equal(await run({ argv: ['prod', '--accept-data-loss'], env: { ALLOW_DATA_LOSS_PUSH: '1' }, stdin: tty, stdout: tty, io: io(), mainImpl, askImpl: async () => 'aims-prod' }), 0);
  assert.equal(opts.acceptDataLoss, true);
});
