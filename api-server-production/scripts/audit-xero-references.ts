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
import { grossOf } from '../src/common/document-money';

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
  type Row = { id: string; name: string; type: string; ref: string; xeroId: string | null; date: string; gross: number | null };
  const linked: Row[] = [];
  let unlinked = 0;
  for (const d of docs) {
    const c: any = d.config || {};
    const date = String(c.date ?? '');
    if (FROM && date && date < FROM) continue;
    const xeroId = c.xeroInvoiceId || c.xeroCreditNoteId || c.xeroBillId || null;
    if (!xeroId && !d.name) continue;
    if (!xeroId) { unlinked++; continue; }
    linked.push({ id: d.id, name: d.name || '', type: d.type, ref: refOf(c), xeroId: String(xeroId), date, gross: grossOf(c) });
  }

  console.log(`\nAIMS documents of type ${types.join('/')}${FROM ? ` dated >= ${FROM}` : ''}: ${docs.length}`);
  console.log(`  linked to Xero: ${linked.length}     not linked (AIMS-only, nothing to compare): ${unlinked}\n`);

  console.log('Pulling Xero references…');
  const xero = new Map<string, { ref: string; number: string; total: number }>();
  for (const inv of await pullAll('/Invoices', 'Invoices'))
    xero.set(String(inv.InvoiceID), {
      ref: String(inv.Reference ?? ''),
      number: String(inv.InvoiceNumber ?? ''),
      total: Number(inv.Total ?? 0),
    });
  for (const cn of await pullAll('/CreditNotes', 'CreditNotes'))
    xero.set(String(cn.CreditNoteID), {
      ref: String(cn.Reference ?? ''),
      number: String(cn.CreditNoteNumber ?? ''),
      total: Number(cn.Total ?? 0),
    });
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

  // ---- Is the LINK itself sound? --------------------------------------
  // Everything below compares the reference of an AIMS document against the
  // reference of the Xero document it claims to be. That comparison is only
  // meaningful if the link is 1:1 and points at the same invoice number. The
  // first prod run showed two AIMS invoices resolving to one Xero reference,
  // so check the link before reading anything into the text.
  const byXeroId = new Map<string, Row[]>();
  for (const r of linked) {
    const list = byXeroId.get(r.xeroId!) || [];
    list.push(r);
    byXeroId.set(r.xeroId!, list);
  }
  const shared = Array.from(byXeroId.values()).filter((g) => g.length > 1);
  // Xero's InvoiceNumber is often the same number with trailing space, or
  // with a note appended after a separator ("JP2605120044 · BIPL-JPSG-INV-…").
  // Neither is a renumbering, so compare the leading segment only.
  const headNumber = (n: string) => n.trim().split(/\s*[·|]\s*/)[0].trim();
  const renumbered = linked.filter((r) => {
    const x = xero.get(r.xeroId!);
    return x && x.number && r.name && headNumber(x.number) !== headNumber(r.name);
  });

  console.log('Link health — before comparing any text');
  console.log('  ' + '-'.repeat(78));
  console.log(`  AIMS documents sharing one Xero document   ${String(shared.reduce((n, g) => n + g.length, 0)).padStart(6)}   in ${shared.length} group(s)`);
  console.log(`  AIMS number != Xero invoice number         ${String(renumbered.length).padStart(6)}`);
  console.log('  ' + '-'.repeat(78));
  if (shared.length) {
    console.log(`\n  Same Xero document claimed by several AIMS documents (showing ${Math.min(SHOW, shared.length)}):`);
    for (const g of shared.slice(0, SHOW))
      console.log(`    Xero ${xero.get(g[0].xeroId!)?.number || g[0].xeroId}  ←  ${g.map((r) => r.name).join(' , ')}`);
  }
  if (renumbered.length) {
    console.log(`\n  AIMS document number differs from the Xero invoice it is linked to (showing ${Math.min(SHOW, renumbered.length)}):`);
    for (const r of renumbered.slice(0, SHOW))
      console.log(`    AIMS ${r.name.padEnd(18)} →  Xero ${xero.get(r.xeroId!)?.number}`);
  }
  if (shared.length || renumbered.length)
    console.log(
      `\n  ⚠ Until these are resolved the reference comparison below is not\n` +
        `    trustworthy for the affected rows: a "different reference" may just\n` +
        `    be the reference of a different invoice, correctly stored.\n`,
    );

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

  // Xero total per invoice number — the tie-breaker. When AIMS quotes another
  // document's reference, the money says which document AIMS actually IS.
  const xeroTotalByNumber = new Map<string, number>();
  for (const x of Array.from(xero.values())) if (x.number) xeroTotalByNumber.set(headNumber(x.number), x.total);

  type Note = { belongsTo: string; xeroNamesOther: string; aimsShared: number; money: string };
  const noteFor = (r: Row & { xref?: string }): Note => {
    const owners = (xeroRefOwner.get(norm(r.ref)) || []).filter((n) => headNumber(n) !== headNumber(r.name));
    const lead = leadingNumber(r.xref || '');
    // Does AIMS's amount match the Xero document it is LINKED to, or the one
    // whose reference text it is carrying? That decides whether the reference
    // is wrong or the link is.
    let money = '';
    const linkedTotal = xero.get(r.xeroId!)?.total;
    if (r.gross != null && linkedTotal != null) {
      const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
      const other = owners[0] ? xeroTotalByNumber.get(headNumber(owners[0])) : undefined;
      if (near(r.gross, linkedTotal))
        money = `amount ${r.gross.toFixed(2)} matches the linked Xero doc — the LINK is right, the reference text is wrong`;
      else if (other != null && near(r.gross, other))
        money = `amount ${r.gross.toFixed(2)} matches ${owners[0]}, not the linked doc (${linkedTotal.toFixed(2)}) — the LINK is wrong`;
      else money = `amount ${r.gross.toFixed(2)} vs linked Xero ${linkedTotal.toFixed(2)} — neither matches`;
    }
    return {
      belongsTo: owners.slice(0, 3).join(', '),
      xeroNamesOther: lead && headNumber(lead) !== headNumber(r.name) ? lead : '',
      aimsShared: aimsRefCount.get(norm(r.ref)) || 0,
      money,
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
      if (n.money) console.log(`     $ ${n.money}`);
    }
  };
  const verdict = { refWrong: 0, linkWrong: 0, neither: 0, unknown: 0 };
  for (const r of differs) {
    const m = noteFor(r).money;
    if (!m) verdict.unknown++;
    else if (m.includes('LINK is right')) verdict.refWrong++;
    else if (m.includes('LINK is wrong')) verdict.linkWrong++;
    else verdict.neither++;
  }
  console.log(`\nWhat the amounts say about the ${differs.length} "different text" rows:`);
  console.log(`  link right, reference text wrong   ${String(verdict.refWrong).padStart(6)}   ← safe to copy from Xero`);
  console.log(`  link wrong (amount is another doc) ${String(verdict.linkWrong).padStart(6)}   ← fix the link, do NOT copy text`);
  console.log(`  neither amount matches             ${String(verdict.neither).padStart(6)}   ← look by hand`);
  console.log(`  no amount stamped in AIMS          ${String(verdict.unknown).padStart(6)}`);

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
  const suspectLink = new Set<string>();
  for (const g of shared) for (const r of g) suspectLink.add(r.id);
  for (const r of renumbered) suspectLink.add(r.id);
  const isUnsafe = (r: Row & { xref?: string }) => !!noteFor(r).xeroNamesOther || suspectLink.has(r.id);
  const unsafe = candidates.filter(isUnsafe);
  const fixable = FORCE ? candidates : candidates.filter((r) => !isUnsafe(r));
  if (unsafe.length)
    console.log(
      `\n${unsafe.length} row(s) held back — the link is suspect, or Xero's reference opens with another document's number` +
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
