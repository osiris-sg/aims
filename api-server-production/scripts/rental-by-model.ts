/**
 * How much of one MODEL was billed as rental in a period? (guru 2026-11-05,
 * "the amount of LION 375 being rented out in Oct".)
 *
 * READ-ONLY — it opens nothing but SELECTs.
 *
 * Biofuel's rental invoices are written in BLOCKS: a 0-amount descriptor line
 * naming the equipment ("1). Rental of one unit Micro-Grid System … Model:
 * LION375 … S/No.: MG20250111") followed by the priced line that carries the
 * money ("1a). Rental for the period from 01/02/2026 - 28/02/2026"). Sometimes
 * the priced line names the model itself instead. So each amount is attributed
 * to the model named ON that line, or failing that the last model named above
 * it — which is how a human reads the invoice.
 *
 * Only ISSUED invoices count — paid, pending_payment, confirmed. Drafts and
 * unconfirmed rows are listed separately at the end rather than silently added:
 * on dev a single 209k draft was five times the whole month's real rental, and
 * a total that moves when someone saves a draft is not a figure to report.
 * Pass --include-drafts to fold them into the total anyway.
 *
 * Usage (dev):
 *   TENANCY_MODE= npx ts-node --transpile-only scripts/rental-by-model.ts \
 *     --model=LION375 --from=2026-10-01 --to=2026-11-01 --schema=org_biofuel
 *
 * Usage (prod — schema is public):
 *   ./node_modules/.bin/dotenv -e .env.production -- \
 *     npx ts-node --transpile-only scripts/rental-by-model.ts \
 *     --model=LION375 --from=2026-10-01 --to=2026-11-01 --schema=public
 */
import { createScriptPrisma } from './xero-migration/_common';
const prisma = createScriptPrisma();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d);

const SCHEMA = arg('schema', 'org_biofuel');
const TARGET = arg('model', 'LION375').toUpperCase();
const FROM = new Date(`${arg('from', '2026-10-01')}T00:00:00Z`);
const TO = new Date(`${arg('to', '2026-11-01')}T00:00:00Z`);

const MODEL = /Model:\s*([A-Z0-9.\-]+)/i;
const SERIAL = /S\/No\.?:\s*([A-Z0-9\-]+)/i;
const m = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name, status, config FROM "${SCHEMA}"."Document"
      WHERE type = 'INVOICE' AND config::text ILIKE $1`, `%${TARGET}%`);

  const ISSUED = new Set(['paid', 'pending_payment', 'confirmed', 'partially_paid', 'overdue']);
  const INCLUDE_DRAFTS = process.argv.includes('--include-drafts');

  let net = 0, tax = 0, voided = 0;
  const serials = new Set<string>();
  const hits: string[] = [];
  const pending: string[] = [];

  for (const r of rows) {
    const c: any = r.config || {};
    const d = c.date ? new Date(c.date) : null;
    if (!d || isNaN(+d) || d < FROM || d >= TO) continue;
    if (c.voided === true || String(c.xeroStatus).toUpperCase() === 'VOIDED' || String(r.status).toLowerCase() === 'void') { voided++; continue; }

    let model: string | null = null, serial: string | null = null, iNet = 0, iTax = 0;
    for (const it of c.items || []) {
      const desc = String(it.description || '');
      const found = MODEL.exec(desc);
      if (found) { model = found[1].toUpperCase(); const s = SERIAL.exec(desc); serial = s ? s[1] : null; }
      const amt = Number(it.amount) || 0;
      if (amt === 0) continue;                       // descriptor line, no money
      if ((found ? found[1].toUpperCase() : model) !== TARGET) continue;
      iNet += amt; iTax += Number(it.taxAmount) || 0;
      if (serial) serials.add(serial);
    }
    if (iNet === 0) continue;
    const line = `  ${String(r.name).padEnd(14)} ${d.toISOString().slice(0, 10)}  ${String(c.customer?.name ?? '(no customer)').slice(0, 32).padEnd(32)} ${m(iNet).padStart(12)}  ${r.status}`;
    if (!ISSUED.has(String(r.status).toLowerCase()) && !INCLUDE_DRAFTS) { pending.push(line); continue; }
    net += iNet; tax += iTax;
    hits.push(line);
  }

  console.log(`\n${TARGET} rental billed ${FROM.toISOString().slice(0, 10)} → ${TO.toISOString().slice(0, 10)}   [schema ${SCHEMA}]`);
  console.log(`invoices: ${hits.length}${voided ? `   (${voided} voided, excluded)` : ''}\n`);
  for (const h of hits) console.log(h);
  console.log(`\n  Rental (before GST) : ${m(net).padStart(14)}`);
  console.log(`  GST                 : ${m(tax).padStart(14)}`);
  console.log(`  Total               : ${m(net + tax).padStart(14)}`);
  console.log(`  Units billed        : ${serials.size}${serials.size ? `   ${Array.from(serials).sort().join(', ')}` : ''}`);
  if (pending.length) {
    console.log(`\n  NOT COUNTED — ${pending.length} draft/unconfirmed invoice(s) in this period:`);
    for (const p of pending) console.log(p);
    console.log('  (--include-drafts folds these into the total.)');
  }
  console.log('');
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
