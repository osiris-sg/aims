/**
 * CIEL INTERIOR — bi-weekly finance backfill (guru 2026-09-02).
 *
 * Source: ~/Downloads/"Bi-weekly Finance" — parsed by the accompanying python
 * step into scripts/ciel-biweekly-payments.json:
 *   bills[]  supplier invoices Apr–Aug (per-invoice, deduped across cycles,
 *            retention % → discount) + Feb/Mar folder-name aggregates
 *   misc[]   designer advances/commissions, designer-reimbursed purchases,
 *            utilities — direct journals, not AP
 *   janFiles January invoice PDFs/images → AI-extracted here (cached in
 *            scripts/ciel-jan-extract.json so extraction runs once)
 *
 * Writes exactly what the app writes:
 *   BILL Document (bills.service config shape, billStatus POSTED/PAID)
 *   SIN journal  Dr expense/purchases  / Cr CL001 Trade Payables   (SPR reversed)
 *   P/V journal  Dr CL001 total / Cr CA600 cash paid / Cr IC010 retention kept
 *   BillPayment  (cash amount, bank CA600, linked P/V)
 *   misc J/V     Dr expense / Cr CA600
 *
 * Accounts created if missing: EX100 Commissions & Designer Advances,
 * EX204 Utilities, IC010 Discounts Received.
 *
 * Idempotent: bills matched by (supplier, billNumber); misc/jan journals by
 * reference. Dry-run by default:
 *   npx dotenv -e .env -- npx ts-node scripts/import-ciel-biweekly-finance.ts
 *   npx dotenv -e .env -- npx ts-node scripts/import-ciel-biweekly-finance.ts --apply
 */
import { PrismaClient, Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ORG_NAME = 'CIEL INTERIOR PTE. LTD.';
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'ciel-biweekly-payments.json'), 'utf8'));
const JAN_CACHE = path.join(__dirname, 'ciel-jan-extract.json');
const ROUND = (n: number) => Math.round(n * 100) / 100;
const log = (m: string) => console.log(`${APPLY ? '' : '[dry] '}${m}`);

const NEW_ACCOUNTS = [
  { code: 'EX100', name: 'Commissions & Designer Advances', accountType: 'EXPENSE', category: 'PNL' },
  { code: 'EX204', name: 'Utilities', accountType: 'EXPENSE', category: 'PNL' },
  { code: 'IC010', name: 'Discounts Received', accountType: 'INCOME', category: 'PNL' },
];
const BANK_CODE = 'CA600';
const AP_CODE = 'CL001';

// ── Jan extraction ─────────────────────────────────────────────────────────
async function extractJan(): Promise<Array<{ file: string; supplier: string; billNumber: string; billDate: string; total: number }>> {
  if (fs.existsSync(JAN_CACHE)) return JSON.parse(fs.readFileSync(JAN_CACHE, 'utf8'));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing — cannot extract January invoices');
  const client = new Anthropic({ apiKey });
  const out: any[] = [];
  for (const file of DATA.janFiles as string[]) {
    const ext = path.extname(file).toLowerCase();
    const media = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg';
    const data = fs.readFileSync(file).toString('base64');
    const block: any =
      media === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: media, data } };
    try {
      const res = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system:
          'Extract from this supplier invoice addressed to CIEL INTERIOR. Output ONLY strict JSON: {"supplierName": string, "billNumber": string, "billDate": "YYYY-MM-DD" or null, "totalAmount": number}. totalAmount = final payable total.',
        messages: [{ role: 'user', content: [block, { type: 'text', text: 'Extract.' }] }],
      });
      const text = res.content.find((b) => b.type === 'text') as any;
      const m = (text?.text || '').match(/\{[\s\S]*\}/);
      const j = m ? JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')) : null;
      if (j?.supplierName && j?.totalAmount) {
        out.push({ file: path.basename(file), supplier: j.supplierName, billNumber: String(j.billNumber || path.basename(file)), billDate: j.billDate || '2026-01-10', total: Number(j.totalAmount) });
        console.log(`  ✓ ${path.basename(file)} → ${j.supplierName} ${j.billNumber} $${j.totalAmount}`);
      } else console.log(`  ⚠ ${path.basename(file)} → could not extract, SKIPPED (add manually)`);
    } catch (e: any) {
      console.log(`  ⚠ ${path.basename(file)} → ${e.message} — SKIPPED`);
    }
  }
  fs.writeFileSync(JAN_CACHE, JSON.stringify(out, null, 1));
  return out;
}

// Same canonicalization as the parser (Jan supplier names come from the AI).
const CANON: Array<[RegExp, string]> = [
  [/hua\s*khian|huakhian/i, 'Hua Khian Company Pte Ltd'],
  [/hue\s*work/i, 'Hue Workz Pte Ltd'],
  [/daco|cowboy/i, 'Daco Interior Pte Ltd'],
  [/bona/i, 'Bona Design Pte Ltd'],
  [/ymf/i, 'YMF Group Pte Ltd'],
  [/j\s*&\s*i\b/i, 'J&I Facilities'],
  [/song\s*aik/i, 'Song Aik Timber'],
  [/yan\s*ho/i, 'Yan Ho Aluminium'],
  [/priropep|prp/i, 'Priropep'],
];
const canon = (n: string) => {
  for (const [re, c] of CANON) if (re.test(n)) return c;
  return n.replace(/\s+/g, ' ').trim();
};

// ── short reference: "site · trade" so a bill reads at one glance ────────
const VENDOR_TRADE: Array<[RegExp, string]> = [
  [/daco|bona/i, 'Tiling/Hacking'],
  [/hue\s*work/i, 'Electrical'],
  [/hua\s*khian/i, 'Sanitary/Materials'],
  [/hafary|soon bee huat/i, 'Tiles'],
  [/dynaglass/i, 'Glass'],
  [/yan\s*ho/i, 'Aluminium'],
  [/pd door|smart door|ether space/i, 'Doors'],
  [/song aik/i, 'Timber'],
  [/j&i/i, 'Cleaning'],
  [/plumbing/i, 'Plumbing'],
  [/yong\s*li|electrical/i, 'Electrical'],
  [/carpentry/i, 'Carpentry'],
  [/aubo|vk3d|cooptech|erdeve/i, '3D Render'],
  [/visual impact/i, 'Photography'],
  [/window film/i, 'Window Film'],
  [/pest/i, 'Pest Control'],
  [/curtain/i, 'Curtains'],
  [/wonderbath/i, 'Bathroom'],
  [/vlux/i, 'Lighting'],
  [/keding/i, 'Boards'],
  [/better guys|bg glass/i, 'Glass'],
  [/temax/i, 'Hardware'],
  [/innostruct/i, 'Works'],
];
const TRADE_KEYWORDS: Array<[RegExp, string]> = [
  [/hack/i, 'Hacking'], [/tiling/i, 'Tiling'], [/carpentry|wardrobe/i, 'Carpentry'],
  [/plumb/i, 'Plumbing'], [/electric/i, 'Electrical'], [/glass|shower/i, 'Glass'],
  [/vinyl/i, 'Vinyl'], [/table\s*top/i, 'Tabletop'], [/door/i, 'Doors'],
  [/paint/i, 'Painting'], [/clean/i, 'Cleaning'], [/curtain/i, 'Curtains'],
  [/3d|render/i, '3D Render'], [/photo|video/i, 'Photography'], [/aircon/i, 'Aircon'],
  [/epoxy|expoxy/i, 'Epoxy'], [/insect|mesh/i, 'Insect Mesh'], [/light/i, 'Lighting'],
  [/moving/i, 'Moving'], [/showroom/i, 'Showroom'],
];
function shortRef(supplier: string, description: string | null | undefined): string | null {
  let d = String(description || '');
  // Feb/Mar payment-batch aggregates → "Feb batch · Trade" (site regex would
  // otherwise bite the "(aggregate of N docs)" tail).
  const batch = d.match(/^Bi-weekly batch (\d{4})-(\d{2})-\d{2}/);
  if (batch) {
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(batch[2]) - 1];
    let trade: string | null = null;
    for (const [re, t] of TRADE_KEYWORDS) if (re.test(d)) { trade = t; break; }
    if (!trade) for (const [re, t] of VENDOR_TRADE) if (re.test(supplier)) { trade = t; break; }
    return [`${mon} batch`, trade].filter(Boolean).join(' · ');
  }
  // site: leading block + street words — "532B BISHAN ST 14 #15-124" → "532B Bishan"
  let site: string | null = null;
  const m = d.match(/(\d{1,4}[A-Z]?)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/);
  if (m && !/invoice|payment|company|statement|batch/i.test(m[2])) {
    const w = m[2].split(/\s+/).map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase());
    site = `${m[1]} ${w.join(' ')}`.replace(/\s+(St|Street|Rd|Road|Dr|Drive|Ave|Lane|Walk|Central|Field|Way|Ctrl)$/i, '');
  }
  if (/showroom/i.test(d)) site = site || 'Showroom';
  let trade: string | null = null;
  for (const [re, t] of TRADE_KEYWORDS) if (re.test(d)) { trade = t; break; }
  if (!trade) for (const [re, t] of VENDOR_TRADE) if (re.test(supplier)) { trade = t; break; }
  const parts = [site, trade].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return d ? d.slice(0, 40) : null;
}

// Known duplicates the sheets carry (same invoice listed twice) — never import.
// jan-0 = Bona BINV-2510-006 (also in the April sheet); xl-72 = DINV-2605-021
// under Daco (their remark: invoice reassigned to Bona Design).
const SKIP_SOURCE_ROWS = new Set(['jan-0', 'xl-72']);

async function main() {
  const org = await prisma.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true } });
  if (!org) throw new Error(`${ORG_NAME} not found`);
  const orgId = org.id;

  // ── accounts ───────────────────────────────────────────────────────────
  const wantedCodes = ['CS001', 'EX001', 'EX203', AP_CODE, BANK_CODE, ...NEW_ACCOUNTS.map((a) => a.code)];
  const acc = new Map<string, { id: string }>();
  for (const a of NEW_ACCOUNTS) {
    const existing = await prisma.chartOfAccount.findFirst({ where: { organizationId: orgId, code: a.code } });
    if (existing) acc.set(a.code, existing);
    else if (APPLY) {
      acc.set(a.code, await prisma.chartOfAccount.create({ data: { organizationId: orgId, code: a.code, name: a.name, description: a.name, accountType: a.accountType, category: a.category, normalBalance: a.accountType === 'INCOME' ? 'CREDIT' : 'DEBIT', isActive: true } as any }));
      log(`account created: ${a.code} ${a.name}`);
    } else log(`would create account ${a.code} ${a.name}`);
  }
  for (const code of wantedCodes) {
    if (acc.has(code)) continue;
    const row = await prisma.chartOfAccount.findFirst({ where: { organizationId: orgId, code } });
    if (!row) { if (!APPLY && NEW_ACCOUNTS.some((a) => a.code === code)) continue; throw new Error(`Account ${code} missing`); }
    acc.set(code, row);
  }
  const A = (code: string) => { const r = acc.get(code); if (!r) throw new Error(`account ${code} unresolved (dry run: will exist after --apply)`); return r.id; };

  // ── bill template ──────────────────────────────────────────────────────
  let tmpl = await prisma.documentTemplate.findFirst({ where: { organizationId: orgId, type: 'BILL' }, orderBy: { createdAt: 'asc' } });
  if (!tmpl && APPLY) {
    tmpl = await prisma.documentTemplate.create({ data: { organizationId: orgId, name: 'Bill', type: 'BILL', isActive: true, templateVariant: 'Default', designName: 'Default', config: { tableColumnOrder: ['description', 'quantity', 'unitPrice', 'taxAmount', 'amount'], columnLabels: { description: 'Description', quantity: 'Qty', unitPrice: 'Unit Price', taxAmount: 'Tax', amount: 'Amount' }, formFields: [] } as any } });
    log('bill template created');
  }

  // ── journal numbering ──────────────────────────────────────────────────
  const rows = await prisma.$queryRawUnsafe<Array<{ maxseq: number | null }>>(
    `SELECT MAX(CAST(SUBSTRING("journalNumber" FROM 4) AS BIGINT)) AS maxseq FROM "JournalEntry" WHERE "organizationId" = $1 AND "journalNumber" ~ '^JV-[0-9]+$'`,
    orgId,
  );
  let seq = Number(rows[0]?.maxseq || 0);
  const nextJv = () => `JV-${String(++seq).padStart(6, '0')}`;

  const postJE = async (o: { entryDate: string; type: string; reference: string; description: string; sourceDocumentId?: string; lines: Array<{ accountId: string; debit: number; credit: number; description: string }> }) => {
    const totalDebit = ROUND(o.lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = ROUND(o.lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > 0.005) throw new Error(`Unbalanced JE ${o.reference}: ${totalDebit} vs ${totalCredit}`);
    if (!APPLY) return { id: `dry-${o.reference}` } as any;
    return prisma.journalEntry.create({
      data: {
        organizationId: orgId, journalNumber: nextJv(), entryDate: new Date(o.entryDate), type: o.type,
        reference: o.reference, description: o.description, currency: 'SGD', sourceDocumentId: o.sourceDocumentId,
        totalDebit, totalCredit, isUnconfirmed: false, status: 'POSTED', postedAt: new Date(),
        lines: { create: o.lines.map((l, i) => ({ accountId: l.accountId, lineNumber: i + 1, description: l.description, debit: l.debit, credit: l.credit })) },
      },
    });
  };

  // ── suppliers ──────────────────────────────────────────────────────────
  const supplierIds = new Map<string, string>();
  const ensureSupplier = async (name: string) => {
    if (supplierIds.has(name)) return supplierIds.get(name)!;
    let s = await prisma.supplier.findFirst({ where: { organizationId: orgId, name } });
    if (!s && APPLY) s = await prisma.supplier.create({ data: { organizationId: orgId, name, currency: 'SGD' } });
    const id = s?.id || `dry-${name}`;
    supplierIds.set(name, id);
    return id;
  };

  // ── bills (excel/folders + january) ────────────────────────────────────
  console.log('— January extraction —');
  const jan = await extractJan();
  const janBills = jan.map((j, i) => ({
    id: `jan-${i}`, supplier: canon(j.supplier), billNumber: j.billNumber, description: `January invoice (${j.file})`,
    billDate: j.billDate || '2026-01-10', amount: ROUND(j.total), kind: 'SIN', account: 'CS001',
    payDate: DATA.janPayDate, cash: ROUND(j.total), discount: 0, source: 'jan-ai',
  }));

  const allBills = [...DATA.bills, ...janBills];
  let created = 0, skipped = 0, payments = 0;
  const stats = { billTotal: 0, cash: 0, discount: 0, openAp: 0, spr: 0 };

  for (const b of allBills) {
    const supplierName = canon(b.supplier);
    const supplierId = await ensureSupplier(supplierName);
    const billNumber = String(b.billNumber).trim();
    if (SKIP_SOURCE_ROWS.has(b.id)) { skipped++; continue; }
    const ref = shortRef(supplierName, b.description);
    const exists = await prisma.document.findFirst({
      where: { organizationId: orgId, type: 'BILL', config: { path: ['inboundMeta', 'sourceRow'], equals: b.id } },
      select: { id: true, config: true },
    });
    if (exists) {
      // Already imported — just stamp the short reference if it's missing.
      const storedRef = (exists.config as any)?.reference;
      if (APPLY && ref && (!storedRef || /^\d+ Docs/.test(storedRef))) {
        await prisma.document.update({ where: { id: exists.id }, data: { config: { ...(exists.config as any), reference: ref } as unknown as Prisma.InputJsonValue } });
      }
      skipped++; continue;
    }

    const amount = ROUND(b.amount);
    const isSpr = b.kind === 'SPR';
    const paid = !!b.payDate;
    const cash = paid ? ROUND(b.cash ?? amount) : 0;
    const discount = paid ? ROUND(b.discount || 0) : 0;
    if (paid && Math.abs(cash + discount - amount) > 0.01) {
      // Retention rounding drift: absorb into discount.
      (b as any).discount = ROUND(amount - cash);
    }
    stats.billTotal += isSpr ? -amount : amount;
    if (paid && !isSpr) { stats.cash += cash; stats.discount += ROUND(amount - cash); }
    if (!paid && !isSpr) stats.openAp += amount;
    if (isSpr) stats.spr += amount;

    const billStatus = paid ? 'PAID' : 'POSTED';
    const config: any = {
      supplierId, supplier: { id: supplierId, name: supplierName },
      billDate: b.billDate, date: b.billDate, dueDate: null,
      reference: ref, description: b.description || null, currency: 'SGD',
      subtotal: amount, taxAmount: 0, totalAmount: amount, amountPaid: paid ? amount : 0,
      amountsAre: 'NO_TAX',
      documentInfo: { taxCode: null, gstPercent: null, absorbTax: false },
      lines: [{ description: b.description || billNumber, quantity: 1, unitPrice: amount, amount, accountId: acc.get(b.account)?.id || null }],
      items: [{ description: b.description || billNumber, quantity: 1, unitPrice: amount, amount, accountId: acc.get(b.account)?.id || null }],
      billStatus, kind: isSpr ? 'SPR' : 'SIN', sourcePoId: null,
      inboundChannel: 'MANUAL', inboundMeta: { backfill: 'biweekly-finance-2026-09', sourceRow: b.id, origin: b.source },
    };

    if (!APPLY) { created++; continue; }

    // Two suppliers can share an invoice number (e.g. Dynaglass and Hafary
    // both issued "260622") but Document.name is unique per org+template —
    // suffix the vendor when another supplier already holds the name.
    let docName = billNumber;
    const clash = await prisma.document.findFirst({ where: { organizationId: orgId, type: 'BILL', name: docName }, select: { id: true } });
    if (clash) {
      docName = `${billNumber} · ${supplierName.split(' ')[0]}`;
      const clash2 = await prisma.document.findFirst({ where: { organizationId: orgId, type: 'BILL', name: docName }, select: { id: true } });
      if (clash2) { console.log(`  ⚠ ${docName} already exists — skipped`); skipped++; continue; }
    }

    const doc = await prisma.document.create({
      data: { organizationId: orgId, documentTemplateId: tmpl!.id, type: 'BILL', name: docName, status: 'confirmed', config: config as unknown as Prisma.InputJsonValue },
    });

    // SIN journal (SPR reversed)
    const sinLines = [
      { accountId: A(b.account), debit: amount, credit: 0, description: b.description || `Bill ${billNumber}` },
      { accountId: A(AP_CODE), debit: 0, credit: amount, description: `Bill ${billNumber}` },
    ];
    const je = await postJE({
      entryDate: b.billDate, type: 'BILL', reference: `${isSpr ? 'SPR' : 'SIN'} ${billNumber}`,
      description: `${isSpr ? 'Supplier credit note' : 'Bill'} — ${supplierName}${b.description ? ` (${b.description})` : ''}`,
      sourceDocumentId: doc.id,
      lines: isSpr ? sinLines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) : sinLines,
    });
    await prisma.document.update({ where: { id: doc.id }, data: { config: { ...config, journalEntryId: je.id } as unknown as Prisma.InputJsonValue } });

    if (paid) {
      payments++;
      if (isSpr) {
        // Credit note settled by paying that much less in the batch → cash back in.
        await postJE({
          entryDate: b.payDate, type: 'PAYMENT', reference: `P/V ${billNumber}`,
          description: `Credit applied — ${supplierName} ${billNumber}`, sourceDocumentId: doc.id,
          lines: [
            { accountId: A(BANK_CODE), debit: amount, credit: 0, description: `Credit netted in payment run` },
            { accountId: A(AP_CODE), debit: 0, credit: amount, description: `Apply ${billNumber}` },
          ],
        });
      } else {
        const disc = ROUND(amount - cash);
        const pvLines = [
          { accountId: A(AP_CODE), debit: amount, credit: 0, description: `Settle AP — ${billNumber}` },
          { accountId: A(BANK_CODE), debit: 0, credit: cash, description: `transfer — bi-weekly run` },
        ];
        if (disc > 0.004) pvLines.push({ accountId: A('IC010'), debit: 0, credit: disc, description: `Retention/discount kept — ${billNumber}` });
        const pv = await postJE({ entryDate: b.payDate, type: 'PAYMENT', reference: `P/V ${billNumber}`, description: `Payment voucher — bill ${billNumber}`, sourceDocumentId: doc.id, lines: pvLines });
        await prisma.billPayment.create({
          data: { organizationId: orgId, billId: doc.id, supplierId, amount: cash, paymentDate: new Date(b.payDate), paymentMethod: 'transfer', reference: `Bi-weekly run ${b.payDate}`, bankAccountId: A(BANK_CODE), journalEntryId: pv.id, createdBy: 'backfill' } as any,
        });
      }
    }
    created++;
  }

  // ── misc journals (advances / comms / reimbursements / utilities) ──────
  let miscCreated = 0, miscSkipped = 0, miscTotal = 0;
  for (const m of DATA.misc) {
    const ref = `J/V CIEL-BF-${m.id}`;
    const exists = await prisma.journalEntry.findFirst({ where: { organizationId: orgId, reference: ref }, select: { id: true } });
    if (exists) { miscSkipped++; continue; }
    const amount = ROUND(Math.abs(m.amount));
    if (amount < 0.01) continue;
    miscTotal += m.amount < 0 ? -amount : amount;
    if (!APPLY) { miscCreated++; continue; }
    const lines = [
      { accountId: A(m.account), debit: amount, credit: 0, description: `${m.who} — ${m.description || ''}`.trim() },
      { accountId: A(BANK_CODE), debit: 0, credit: amount, description: `transfer — bi-weekly run` },
    ];
    await postJE({
      entryDate: m.date, type: 'MANUAL', reference: ref,
      description: `${m.who}: ${m.description || 'bi-weekly payment'}`,
      lines: m.amount < 0 ? lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) : lines,
    });
    miscCreated++;
  }

  console.log(`\n${APPLY ? '' : '[DRY RUN] '}bills: ${created} created, ${skipped} already present, ${payments} payments`);
  console.log(`misc journals: ${miscCreated} created, ${miscSkipped} already present, total $${ROUND(miscTotal)}`);
  console.log(`gross bills $${ROUND(stats.billTotal)} · cash paid $${ROUND(stats.cash)} · discounts kept $${ROUND(stats.discount)} · open AP $${ROUND(stats.openAp)} · credit notes $${ROUND(stats.spr)}`);

  // ── GL verification ────────────────────────────────────────────────────
  if (APPLY) {
    const tb = await prisma.$queryRawUnsafe<Array<{ code: string; name: string; debit: number; credit: number }>>(
      `SELECT c.code, c.name, COALESCE(SUM(l.debit),0)::float AS debit, COALESCE(SUM(l.credit),0)::float AS credit
         FROM "JournalEntryLine" l JOIN "JournalEntry" e ON e.id = l."journalEntryId" JOIN "ChartOfAccount" c ON c.id = l."accountId"
        WHERE e."organizationId" = $1 AND e.status = 'POSTED' GROUP BY c.code, c.name ORDER BY c.code`,
      orgId,
    );
    let d = 0, c = 0;
    console.log('\nTRIAL BALANCE (posted):');
    for (const r of tb) {
      d += r.debit; c += r.credit;
      const bal = ROUND(r.debit - r.credit);
      console.log(`  ${r.code.padEnd(6)} ${r.name.padEnd(36)} ${bal >= 0 ? 'DR' : 'CR'} ${Math.abs(bal).toFixed(2)}`);
    }
    console.log(`  TOTAL DR ${ROUND(d).toFixed(2)}  CR ${ROUND(c).toFixed(2)}  →  ${Math.abs(ROUND(d - c)) < 0.01 ? '✅ BALANCED' : `❌ OFF BY ${ROUND(d - c)}`}`);
    const ap = tb.find((r) => r.code === AP_CODE);
    if (ap) console.log(`  AP control balance: ${ROUND(ap.credit - ap.debit).toFixed(2)} (should equal open AP above)`);
  }
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
