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
/** Document-number prefix filters — the series behave differently (the BI
 *  rentals want Xero's text, the JP bills must NOT take Xero's generic
 *  "JP Pass application" over the real JPSG number AIMS holds). */
const ONLY = arg('only', '').toUpperCase();
const SKIP = arg('skip', '').toUpperCase();
const APPLY = process.argv.includes('--apply');
/** Apply even the rows the audit marks unsafe. Off by default. */
const FORCE = process.argv.includes('--force');

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

  // ---- Whose reference is it? ----------------------------------------
  // A reference that went missing and a reference that belongs to a DIFFERENT
  // document are not the same bug. Xero's text is indexed here so a mismatch
  // can say which other document AIMS is quoting (BI202608076 in AIMS holds
  // what Xero files under BI202608079 — the series is shifted, not blank).
  const xeroRefOwner = new Map<string, string[]>();
  for (const x of Array.from(xero.values())) {
    const k = norm(x.ref);
    if (!k) continue;
    const list = xeroRefOwner.get(k) || [];
    list.push(x.number);
    xeroRefOwner.set(k, list);
  }
  // How many AIMS documents share one reference string — the JPSG bills all
  // carry BIPL-JPSG-INV-20260630-0001, which is one bug repeated, not 60.
  const aimsRefCount = new Map<string, number>();
  for (const r of linked) {
    const k = norm(r.ref);
    if (k) aimsRefCount.set(k, (aimsRefCount.get(k) || 0) + 1);
  }
  /** A reference usually opens with the document's own number. When Xero's
   *  opens with a DIFFERENT one, copying it would file the wrong number in
   *  AIMS, so the row is held back unless --force. */
  const leadingNumber = (ref: string) => ref.match(/^([A-Z]{2,}[0-9][A-Z0-9-]*)/i)?.[1] || '';

  type Note = { belongsTo: string; xeroNamesOther: string; aimsShared: number };
  const noteFor = (r: Row & { xref?: string }): Note => {
    const owners = (xeroRefOwner.get(norm(r.ref)) || []).filter((n) => n !== r.name);
    const lead = leadingNumber(r.xref || '');
    return {
      belongsTo: owners.slice(0, 3).join(', '),
      xeroNamesOther: lead && lead !== r.name ? lead : '',
      aimsShared: aimsRefCount.get(norm(r.ref)) || 0,
    };
  };

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

  // Which series are involved — the fix differs per series, so the split
  // matters more than the total.
  const seriesOf = (name: string) => name.match(/^[A-Z]+/i)?.[0].toUpperCase() || '?';
  const bySeries = new Map<string, { differs: number; missing: number; extra: number }>();
  const bump = (name: string, k: 'differs' | 'missing' | 'extra') => {
    const s2 = bySeries.get(seriesOf(name)) || { differs: 0, missing: 0, extra: 0 };
    s2[k]++;
    bySeries.set(seriesOf(name), s2);
  };
  differs.forEach((r) => bump(r.name, 'differs'));
  missingInAims.forEach((r) => bump(r.name, 'missing'));
  extraInAims.forEach((r) => bump(r.name, 'extra'));
  console.log(`\nMismatches by document series:`);
  console.log(`  ${'Series'.padEnd(10)}${'different'.padStart(10)}${'blank in AIMS'.padStart(15)}${'blank in Xero'.padStart(15)}`);
  for (const [k, v] of Array.from(bySeries.entries()).sort((a, b) => b[1].differs - a[1].differs))
    console.log(`  ${k.padEnd(10)}${String(v.differs).padStart(10)}${String(v.missing).padStart(15)}${String(v.extra).padStart(15)}`);

  const dump = (title: string, rows: Array<Row & { xref?: string }>) => {
    if (!rows.length) return;
    console.log(`\n${title} (${rows.length}, showing ${Math.min(SHOW, rows.length)}):`);
    for (const r of rows.slice(0, SHOW)) {
      const n = noteFor(r);
      console.log(`  ${r.name.padEnd(16)} ${r.type.padEnd(12)} ${r.date}`);
      console.log(`     AIMS : ${cut(r.ref, 90) || '(blank)'}`);
      if (r.xref !== undefined) console.log(`     Xero : ${cut(r.xref, 90) || '(blank)'}`);
      if (n.belongsTo) console.log(`     ↳ this AIMS text is Xero's reference for ${n.belongsTo} — the series is SHIFTED, not blank`);
      if (n.xeroNamesOther) console.log(`     ⚠ Xero's own text opens with ${n.xeroNamesOther}, not ${r.name} — Xero is mislabelled here`);
      if (n.aimsShared > 1) console.log(`     ⚠ ${n.aimsShared} AIMS documents share this exact reference`);
    }
  };
  dump('DIFFERENT text', differs);
  dump('Blank in AIMS, present in Xero', missingInAims);
  dump('Present in AIMS, blank in Xero', extraInAims.slice(0, SHOW));

  // ---- What is safe to copy ------------------------------------------
  let candidates = [...differs, ...missingInAims];
  const beforeFilter = candidates.length;
  if (ONLY) candidates = candidates.filter((r) => r.name.toUpperCase().startsWith(ONLY));
  if (SKIP) candidates = candidates.filter((r) => !r.name.toUpperCase().startsWith(SKIP));
  if (ONLY || SKIP)
    console.log(`\nSeries filter (${[ONLY && `only ${ONLY}`, SKIP && `skip ${SKIP}`].filter(Boolean).join(', ')}): ${candidates.length} of ${beforeFilter}`);

  // Held back: Xero's own text names a different document, so copying it
  // would file the wrong number in AIMS. A human has to pick the right text.
  const unsafe = candidates.filter((r) => noteFor(r).xeroNamesOther);
  const fixable = FORCE ? candidates : candidates.filter((r) => !noteFor(r).xeroNamesOther);
  if (unsafe.length)
    console.log(
      `\n${unsafe.length} row(s) held back — Xero's reference opens with another document's number` +
        `${FORCE ? ', but --force was given so they WILL be written' : ' (--force overrides)'}:` +
        `\n  ${unsafe.slice(0, 10).map((r) => `${r.name} → "${cut(r.xref, 40)}"`).join('\n  ')}`,
    );

  if (!fixable.length) {
    console.log('\nNothing left to copy.\n');
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
