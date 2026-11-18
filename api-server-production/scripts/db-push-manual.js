#!/usr/bin/env node
/* Guard for HAND schema pushes to shared databases (npm run db:push:prod / db:push:staging).
 *
 *   dotenv -e .env.production -- node scripts/db-push-manual.js prod [--accept-data-loss]
 *
 * Runs the same pre-check as the build (scripts/db-push.js: prints the diff SQL, refuses
 * destructive changes not named in prisma/allow-destructive.txt, Neon snapshot when
 * NEON_API_KEY is set), then makes you TYPE the target's project name before pushing.
 *   - refuses to run without an interactive terminal (no piping "yes" into it);
 *   - refuses --accept-data-loss unless ALLOW_DATA_LOSS_PUSH=1 is also set, and even then the
 *     typed confirmation is still required (blocked statements are listed above the prompt).
 * Plain `npm run db:push` (dev) does not go through this.
 */
'use strict';
const readline = require('readline');
const { main } = require('./db-push');

const PROJECTS = { prod: 'aims-prod', staging: 'aims-staging' };

function ask(question, { stdin = process.stdin, stdout = process.stdout } = {}) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function run({ argv = process.argv.slice(2), env = process.env, stdin = process.stdin, stdout = process.stdout, mainImpl = main, askImpl = ask, io = console } = {}) {
  const [target, ...rest] = argv;
  const project = PROJECTS[target];
  if (!project) { io.error(`usage: db-push-manual.js <${Object.keys(PROJECTS).join('|')}> [--accept-data-loss]`); return 2; }
  const unknown = rest.filter((a) => a !== '--accept-data-loss');
  if (unknown.length) { io.error(`✖ unknown argument(s): ${unknown.join(' ')} — refusing.`); return 2; }
  const acceptDataLoss = rest.includes('--accept-data-loss');
  if (acceptDataLoss && env.ALLOW_DATA_LOSS_PUSH !== '1') {
    io.error('✖ --accept-data-loss is refused unless ALLOW_DATA_LOSS_PUSH=1 is set in the environment.');
    return 1;
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    io.error(`✖ db:push:${target} needs an interactive terminal (typed confirmation) — refusing to run non-interactively.`);
    return 1;
  }
  return mainImpl({
    env,
    acceptDataLoss,
    confirm: async ({ blocked }) => {
      if (acceptDataLoss) {
        io.error(`\n⚠ --accept-data-loss: ${blocked.length ? 'the DESTRUCTIVE changes listed above WILL be applied' : 'Prisma will not stop on data-loss warnings'}.`);
      }
      const answer = await askImpl(`\nType "${project}" to push the changes above to ${target.toUpperCase()}: `, { stdin, stdout });
      return String(answer).trim() === project;
    },
  });
}

module.exports = { run, PROJECTS };

if (require.main === module) {
  run().then((code) => process.exit(code), (e) => { console.error(`✖ ${e && e.message}`); process.exit(1); });
}
