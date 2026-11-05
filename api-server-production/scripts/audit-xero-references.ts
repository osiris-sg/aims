/**
 * Does every Xero-linked document still carry Xero's Reference?
 * (guru 2026-11-06: "the sync didnt sync this reference … can ask claude if
 *  all references are sync?")
 *
 * READ-ONLY by default. Nothing is written without --apply.
 *
 * WHY THIS DRIFTS: the one-off importers (02-sales-invoices, 03-purchase-bills,
 * 04-credit-notes) copy Xero's Reference into config.referenceNo at import
 * time. Nothing re-reads it afterwards — XeroSyncService.pullContacts/
 * confirmFromXero never touch the reference. So a Reference edited in Xero
 * AFTER the import keeps the stale text in AIMS forever, and a Reference added
 * in Xero after the import never arrives at all.
 *
 * Usage (prod, report only):
 *   ./node_modules/.bin/dotenv -e .env.production -- \
 *     npx ts-node --transpile-only scripts/audit-xero-references.ts
 *
 *   --org=<id>      default Biofuel
 *   --type=INVOICE  limit to one doc type (INVOICE | BILL | CREDIT_NOTE)
 *   --from=2026-01-01   only documents dated on/after this
 *   --show=40       how many mismatches to print per bucket (default 20)
 *   --apply         COPY Xero's Reference into AIMS for the "differs" and
 *                   "missing in AIMS" buckets. Xero stays the source of truth;
 *                   nothing is ever written back to Xero by this script.
 */
import { createScriptPrisma, getXeroTokens, xeroGet, BIOFUEL_ORG_ID } from './xero-migration/_common';

const prisma = createScriptPrisma();
const arg = (k: string, d = '') =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;

const ORG = arg('org', BIOFUEL_ORG_ID);
const ONLY_TYPE = arg('type', '').toUpperCase();
const FROM = arg('from', '');
const SHOW = parseInt(arg('show', '20'), 10);
const APPLY = process.argv.includes('--apply');

/** The canonical read order (CLAUDE.md: config.referenceNo is canonical, the
 *  rest are legacy keys older rows were written with). */
const refOf = (c: any) =>
  String(
    c?.documentInfo?.referenceNo ?? c?.referenceNo ?? c?.documentInfo?.reference ?? c?.reference ?? c?.xeroReference ?? '',
  ).trim();

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function pullAll(path: string, key: string, extra: Record<string, string> = {}) {
  const out: any[] = [];
  for (let page = 1; ; page++) {
    const j: any = await xeroGet(await tokens, path, { page, summaryOnly: 'true', ...extra });
    const list = j?.[key] || [];
    out.push(...list);
    process.stdout.write(`\r  ${path} page ${page}: ${out.length} so far   `);
    if (list.length < 100) break;
  }
  process.stdout.write('\n');
  return out;
}

let tokens: Promise<any>;

(async () => {
  tokens = getXeroTokens(prisma, ORG);
  await tokens;

  const types = ONLY_TYPE ? [ONLY_TYPE] : ['INVOICE', 'BILL', 'CREDIT_NOTE'];
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: { in: types as any } },
    select: { id: true, name: true, type: true, config: true },
  });

  // Only rows that are actually linked to Xero can be compared at all.
  type Row = { id: string; name: string; type: string; ref: string; xeroId: string | null; date: string };
  const linked: Row[] = [];
  let unlinked = 0;
  for (const d of docs) {
    const c: any = d.config || {};
    const date = String(c.date ?? '');
    if (FROM && date && date < FROM) continue;
    const xeroId = c.xeroInvoiceId || c.xeroCreditNoteId || c.xeroBillId || null;
    if (!xeroId && !d.name) continue;
    if (!xeroId) { unlinked++; continue; }
    linked.push({ id: d.id, name: d.name || '', type: d.type, ref: refOf(c), xeroId: String(xeroId), date });
  }

  console.log(`\nAIMS documents of type ${types.join('/')}${FROM ? ` dated >= ${FROM}` : ''}: ${docs.length}`);
  console.log(`  linked to Xero: ${linked.length}     not linked (AIMS-only, nothing to compare): ${unlinked}\n`);

  console.log('Pulling Xero references…');
  const xero = new Map<string, { ref: string; number: string }>();
  for (const inv of await pullAll('/Invoices', 'Invoices'))
    xero.set(String(inv.InvoiceID), { ref: String(inv.Reference ?? ''), number: String(inv.InvoiceNumber ?? '') });
  for (const cn of await pullAll('/CreditNotes', 'CreditNotes'))
    xero.set(String(cn.CreditNoteID), { ref: String(cn.Reference ?? ''), number: String(cn.CreditNoteNumber ?? '') });
  console.log(`  ${xero.size} Xero documents read\n`);

  const agree: Row[] = [];
  const differs: Array<Row & { xref: string }> = [];
  const missingInAims: Array<Row & { xref: string }> = [];
  const extraInAims: Row[] = [];
  const bothBlank: Row[] = [];
  const notFound: Row[] = [];

  for (const r of linked) {
    const x = xero.get(r.xeroId!);
    if (!x) { notFound.push(r); continue; }
    const a = norm(r.ref);
    const b = norm(x.ref);
    if (!a && !b) bothBlank.push(r);
    else if (a === b) agree.push(r);
    else if (!a) missingInAims.push({ ...r, xref: b });
    else if (!b) extraInAims.push(r);
    else differs.push({ ...r, xref: b });
  }

  const pct = (n: number) => (linked.length ? ((100 * n) / linked.length).toFixed(1) : '0.0');
  console.log('Reference comparison — AIMS vs Xero');
  console.log('  ' + '-'.repeat(78));
  console.log(`  same reference                       ${String(agree.length).padStart(6)}   ${pct(agree.length).padStart(5)}%`);
  console.log(`  blank on both sides                  ${String(bothBlank.length).padStart(6)}   ${pct(bothBlank.length).padStart(5)}%`);
  console.log(`  DIFFERENT text                       ${String(differs.length).padStart(6)}   ${pct(differs.length).padStart(5)}%  ← the BI202608062 case`);
  console.log(`  blank in AIMS, present in Xero       ${String(missingInAims.length).padStart(6)}   ${pct(missingInAims.length).padStart(5)}%  ← never synced`);
  console.log(`  present in AIMS, blank in Xero       ${String(extraInAims.length).padStart(6)}   ${pct(extraInAims.length).padStart(5)}%  (AIMS-authored, never pushed)`);
  console.log(`  linked to a Xero doc that is gone    ${String(notFound.length).padStart(6)}   ${pct(notFound.length).padStart(5)}%`);
  console.log('  ' + '-'.repeat(78));

  const dump = (title: string, rows: Array<Row & { xref?: string }>) => {
    if (!rows.length) return;
    console.log(`\n${title} (${rows.length}, showing ${Math.min(SHOW, rows.length)}):`);
    for (const r of rows.slice(0, SHOW)) {
      console.log(`  ${r.name.padEnd(16)} ${r.type.padEnd(12)} ${r.date}`);
      console.log(`     AIMS : ${cut(r.ref, 90) || '(blank)'}`);
      if (r.xref !== undefined) console.log(`     Xero : ${cut(r.xref, 90) || '(blank)'}`);
    }
  };
  dump('DIFFERENT text', differs);
  dump('Blank in AIMS, present in Xero', missingInAims);
  dump('Present in AIMS, blank in Xero', extraInAims.slice(0, SHOW));

  const fixable = [...differs, ...missingInAims];
  if (!fixable.length) {
    console.log('\nEvery linked reference matches Xero. Nothing to do.\n');
    await prisma.$disconnect();
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — ${fixable.length} document(s) would take Xero's reference.`);
    console.log('Re-run with --apply to write them (AIMS only; Xero is never modified).\n');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n*** APPLY *** copying Xero's reference into ${fixable.length} AIMS document(s)…`);
  let written = 0;
  for (const r of fixable) {
    const current = await prisma.document.findUnique({ where: { id: r.id }, select: { config: true } });
    const c: any = { ...((current?.config as any) || {}) };
    // Write the canonical key and mirror the legacy twins, exactly as the
    // importers do — list views and the editor read different ones on old rows.
    c.referenceNo = r.xref;
    c.xeroReference = r.xref;
    c.documentInfo = { ...(c.documentInfo || {}), referenceNo: r.xref };
    await prisma.document.update({ where: { id: r.id }, data: { config: c } });
    written++;
    if (written % 50 === 0) process.stdout.write(`\r  ${written}/${fixable.length}   `);
  }
  console.log(`\n  ${written} references updated from Xero.\n`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e?.message || e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
