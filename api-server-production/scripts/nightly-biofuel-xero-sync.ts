/**
 * Nightly Biofuel Xero → AIMS sync + reconciliation (temporary, ~2 weeks).
 *
 * Runs the hardened import chain, then the reconciliation. Designed for a
 * Render cron service (always-on, prod env vars injected):
 *   command: cd api-server-production && npx ts-node --transpile-only scripts/nightly-biofuel-xero-sync.ts
 *   env:     DATABASE_URL (prod), XERO_CLIENT_ID, XERO_CLIENT_SECRET
 *
 * Strategy per night:
 *   1. 02/03/04  — upsert-refresh invoices / bills / credit notes (statuses,
 *                  balances, new docs; voided ones are skipped by design).
 *   2. GL        — FAST PATH: append-only (--resume) journal sync. Xero
 *                  journals are immutable so append covers everything except
 *                  journals *removed* by late voids — which step 4 catches.
 *   3. balances  — true-up per-invoice AmountDue/AmountPaid.
 *   4. reconcile — independent Xero vs AIMS diff (GL / AR / AP).
 *                  If it reports drift, we assume a removed/changed journal:
 *                  run ONE full GL wipe-and-reload, then reconcile again.
 *   5. exit 0 only if the final reconcile is clean → Render marks the run
 *                  failed otherwise, which is the alert signal.
 *
 * Contact persons (05) are NOT nightly — run manually when contacts change.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";

const STAGES_DIR = __dirname;
const CACHE_FILE_GLOB = "/tmp/xero-journals-cache-"; // per-org suffix added by sync script

function run(label: string, script: string, args: string[] = []): boolean {
  console.log(`\n===== ${label} — ${new Date().toISOString()} =====`);
  const res = spawnSync("npx", ["ts-node", "--transpile-only", script, ...args], {
    cwd: `${STAGES_DIR}/..`,
    stdio: "inherit",
    env: process.env,
  });
  const ok = res.status === 0;
  if (!ok) console.error(`✗ ${label} exited ${res.status}`);
  return ok;
}

function clearJournalCache() {
  // Force the GL script to pull fresh (full reload must not trust the cache).
  for (const f of fs.readdirSync("/tmp")) {
    if (`/tmp/${f}`.startsWith(CACHE_FILE_GLOB)) fs.unlinkSync(`/tmp/${f}`);
  }
}

async function main() {
  const startedAt = Date.now();
  let ok =
    run("[1/4] sales invoices (AR)", "scripts/xero-migration/02-sales-invoices.ts") &&
    run("[2/4] purchase bills (AP)", "scripts/xero-migration/03-purchase-bills.ts") &&
    run("[3/4] credit notes", "scripts/xero-migration/04-credit-notes.ts");
  if (!ok) process.exit(1);

  // Fast-path GL: append-only.
  if (!run("[GL fast] journal append (--resume)", "scripts/sync-gl-from-xero.ts", ["--resume"])) process.exit(1);
  if (!run("[balances] AR true-up", "scripts/update-invoice-balances-from-xero.ts")) process.exit(1);

  // Independent verification.
  if (run("[reconcile] Xero vs AIMS", "scripts/reconcile-xero-biofuel.ts")) {
    console.log(`\n✓ NIGHTLY SYNC CLEAN in ${Math.round((Date.now() - startedAt) / 60000)} min`);
    process.exit(0);
  }

  // Drift found — likely a late-voided doc whose journal Xero removed and the
  // append-only pass kept. Do one full wipe-and-reload, then re-verify.
  console.warn("\n⚠ reconcile found drift — running FULL GL reload then re-verifying...");
  clearJournalCache();
  if (!run("[GL full] wipe-and-reload", "scripts/sync-gl-from-xero.ts")) process.exit(1);
  if (!run("[balances] AR true-up (post-reload)", "scripts/update-invoice-balances-from-xero.ts")) process.exit(1);

  if (run("[reconcile 2nd] Xero vs AIMS", "scripts/reconcile-xero-biofuel.ts")) {
    console.log(`\n✓ NIGHTLY SYNC CLEAN (after full reload) in ${Math.round((Date.now() - startedAt) / 60000)} min`);
    process.exit(0);
  }

  console.error("\n✗ NIGHTLY SYNC: drift persists after full reload — investigate (see reconcile output above).");
  process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e?.message || e);
  process.exit(2);
});
