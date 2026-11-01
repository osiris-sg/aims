/**
 * WCT customer import (2026-11) from WCT's DP Info debtor export.
 * DRY RUN by default (read-only): cleans the CSV, matches it against the org's
 * current customers and writes a report + DebtorCode mapping next to the CSV.
 *
 *   # prod dry run (read-only)
 *   TENANCY_MODE= DATABASE_URL=<prod> npx ts-node -r tsconfig-paths/register --transpile-only \
 *     scripts/import-wct-customers.ts <path/to/wct-customers-raw.csv> [--out=<dir>]
 *   # apply — only after the owner's go
 *   … scripts/import-wct-customers.ts <csv> --apply --confirm-prod
 *
 * Cleaning/planning rules live in src/customers/wct-import/wct-debtor-clean.ts
 * (unit-tested). Codes come from CustomersService.generateCustomerCode, fed the
 * org's existing codes plus the ones this run has issued. Apply inserts in
 * batched transactions (Customer, CustomerContact, SiteOffice, ContactDetail +
 * one Activity Log row per customer) and appends each committed batch to
 * <out>/wct-customer-mapping.csv. Re-running skips DebtorCodes already in that
 * file and any name that now exists in the org, so it never duplicates.
 * Only creates rows in the WCT org; never updates or deletes anything.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CustomersService } from '../src/customers/customers.service';
import { CleanRow, ExistingCustomer, PlannedCustomer, debtorRowsFromCsv, maskEmail, maskPhone, maskShape, normKey, planImport } from '../src/customers/wct-import/wct-debtor-clean';

const WCT_ORG = '5c700000-0000-4000-8000-5c7000000001';
const ACTOR = 'system:wct-customer-import';
// Being cleaned up separately — never a match target (its code still counts).
const IGNORE_EXISTING = { customerCode: 'CT001', name: 'TEST SiteClock' };
const BATCH = 200;

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) =>
  args
    .find((a) => a.startsWith(`--${n}=`))
    ?.split('=')
    .slice(1)
    .join('=');
const csvPath = args.find((a) => !a.startsWith('--'));
const APPLY = flag('apply');

type Planned = PlannedCustomer & { id: string; customerCode: string };

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',') + '\n';
const MAP_HEADER = ['DebtorCode', 'Status', 'CustomerCode', 'CustomerId', 'MergedWith', 'Name', 'UEN', 'UENStatus', 'AcctOpenDate', 'ExistingCustomerCode'];

/** Deterministic sample (mulberry32). */
function sample<T>(xs: T[], n: number, seed = 20261102): T[] {
  let a = seed;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

const personName = (r: CleanRow) =>
  r.isIndividual
    ? `(individual) ${r.name
        .split(' ')
        .map((w) => `${w[0] ?? ''}.`)
        .join(' ')}`
    : r.name;

async function main() {
  if (!csvPath || !fs.existsSync(csvPath)) throw new Error('usage: import-wct-customers.ts <csv> [--apply --confirm-prod] [--out=<dir>]');
  const url = process.env.DATABASE_URL ?? '';
  if (!url) throw new Error('DATABASE_URL is not set');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (APPLY && !local && !flag('confirm-prod')) throw new Error('--apply on a non-local DB needs --confirm-prod');
  const outDir = path.resolve(opt('out') ?? path.dirname(csvPath));
  const mappingPath = path.join(outDir, 'wct-customer-mapping.csv');
  const tag = APPLY ? 'apply' : 'dryrun';

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const org = await prisma.organization.findUnique({ where: { id: WCT_ORG }, select: { id: true, name: true } });
    if (!org || org.name !== 'WCT') throw new Error(`WCT org ${WCT_ORG} not found on this DB`);

    const existingAll: ExistingCustomer[] = await prisma.customer.findMany({
      where: { organizationId: WCT_ORG },
      select: { id: true, customerCode: true, name: true, email: true, phone: true, address: true },
      orderBy: { createdAt: 'asc' },
    });
    const existing = existingAll.filter((c) => !(c.customerCode === IGNORE_EXISTING.customerCode && c.name === IGNORE_EXISTING.name));

    // DebtorCodes a previous apply already created (the mapping file is the run log).
    const already = new Set<string>();
    if (fs.existsSync(mappingPath)) {
      const [, ...rows] = fs
        .readFileSync(mappingPath, 'utf8')
        .trim()
        .split('\n')
        .map((l) => l.split(','));
      for (const r of rows) if (r[1] === 'created' || r[1] === 'merged') already.add(r[0]);
    }

    const raw = debtorRowsFromCsv(fs.readFileSync(csvPath, 'utf8'));
    const plan = planImport(raw, existing, already);
    // Belt and braces: an email any current customer carries (incl. the ignored one).
    const taken = new Set(existingAll.map((c) => c.email?.toLowerCase()).filter(Boolean));
    for (const c of plan.customers)
      if (c.email && taken.has(c.email)) {
        c.email = null;
        c.emailNulledReason = 'used-by-existing';
      }

    // Codes: the normal generator over existing + already-issued codes.
    const codes = existingAll.map((c) => c.customerCode).filter((c): c is string => !!c);
    const codeSource = {
      customer: {
        findMany: async ({ where }: any) => codes.filter((c) => c.startsWith(where.customerCode.startsWith)).map((customerCode) => ({ customerCode })),
      },
    };
    const gen = new CustomersService(codeSource as any, null as any) as any;
    const planned: Planned[] = [];
    for (const c of plan.customers) {
      const customerCode: string = await gen.generateCustomerCode(c.name, WCT_ORG);
      codes.push(customerCode);
      planned.push({ ...c, id: randomUUID(), customerCode });
    }

    // ── Stats ──
    const createdRows = planned.flatMap((c) => c.rows);
    const allClean = [...createdRows, ...plan.skippedExisting.map((m) => m.row)];
    const contacts = planned.flatMap((c) => c.contacts);
    const unparsed = createdRows.flatMap((r) => r.unparsedPhones.map((u) => ({ code: r.debtorCode, ...u })));
    const invalidEmails = createdRows.flatMap((r) => r.invalidEmails.map((e) => ({ code: r.debtorCode, e })));
    const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
    const ranges: Record<string, { first: string; last: string; n: number }> = {};
    for (const c of planned) {
      const p = [...c.customerCode].slice(0, 2).join('');
      ranges[p] = ranges[p] ? { ...ranges[p], last: c.customerCode, n: ranges[p].n + 1 } : { first: c.customerCode, last: c.customerCode, n: 1 };
    }
    const mergedRowCount = createdRows.length - planned.length;
    const stats = {
      csvRows: plan.total,
      toCreate: planned.length,
      mergedRows: mergedRowCount,
      mergeGroups: plan.merges.length,
      skippedExisting: plan.skippedExisting.length,
      skippedAlreadyImported: plan.skippedAlreadyImported.length,
      skippedBlankName: plan.skippedBlankName.length,
      skippedStatusName: plan.skippedStatusName.length,
      skippedWct: plan.skippedSelf.length,
      emailsNulled: count(
        planned.filter((c) => c.emailNulledReason),
        (c) => c.emailNulledReason!,
      ),
      customersWithEmail: planned.filter((c) => c.email).length,
      customersWithPhone: planned.filter((c) => c.phone).length,
      unparsedPhones: unparsed.length,
      rowsWithUnparsedPhones: new Set(unparsed.map((u) => u.code)).size,
      invalidEmails: invalidEmails.length,
      contacts: contacts.length,
      altContacts: contacts.filter((c) => c.name.endsWith(' (alt)')).length,
      accountsFallback: contacts.filter((c) => c.name.startsWith('Accounts')).length,
      customersWithoutContact: planned.filter((c) => !c.contacts.length).length,
      siteOffices: planned.filter((c) => c.site).length,
      contactDetails: planned.filter((c) => c.site?.contactDetail).length,
      individuals: planned.filter((c) => c.rows[0].isIndividual).length,
      uen: count(createdRows, (r) => r.uenStatus),
      address: count(createdRows, (r) => (!r.address ? 'blank' : r.addressFormatted ? 'formatted' : /singapore/i.test(r.address) ? 'had Singapore' : 'no trailing postal (left as is)')),
    };
    const sumCheck = stats.toCreate + stats.mergedRows + stats.skippedExisting + stats.skippedAlreadyImported + stats.skippedBlankName + stats.skippedStatusName + stats.skippedWct;

    // ── Mapping CSV ──
    const mapRows: unknown[][] = [];
    for (const c of planned)
      c.rows.forEach((r, i) =>
        mapRows.push([
          r.debtorCode,
          i === 0 ? 'created' : 'merged',
          c.customerCode,
          APPLY ? c.id : '',
          i === 0 ? '' : c.rows[0].debtorCode,
          r.name,
          r.uen ?? '',
          r.uenStatus,
          r.acctOpenDate ?? '',
          '',
        ]),
      );
    for (const m of plan.skippedExisting)
      mapRows.push([m.row.debtorCode, 'skipped-existing', '', '', '', m.row.name, m.row.uen ?? '', m.row.uenStatus, m.row.acctOpenDate ?? '', m.existing.customerCode ?? '']);
    for (const r of plan.skippedAlreadyImported) mapRows.push([r.debtorCode, 'already-imported', '', '', '', r.name, '', '', '', '']);
    for (const r of plan.skippedSelf) mapRows.push([r.debtorCode, 'skipped-wct-itself', '', '', '', r.name, '', '', '', '']);
    for (const { row: r, marker } of plan.skippedStatusName) mapRows.push([r.debtorCode, `skipped-status-name ${marker}`, '', '', '', r.name, r.uen ?? '', r.uenStatus, r.acctOpenDate ?? '', '']);
    for (const code of plan.skippedBlankName) mapRows.push([code, 'skipped-blank-name', '', '', '', '', '', '', '', '']);
    mapRows.sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[0]).localeCompare(String(b[0])));

    // ── Report ──
    const L: string[] = [];
    L.push(`# WCT customer import — ${APPLY ? 'APPLY' : 'DRY RUN'} ${new Date().toISOString()}`, '');
    L.push(`Source: ${path.basename(csvPath)} (${plan.total} rows). Org: WCT ${WCT_ORG}. Existing WCT customers: ${existingAll.length} (TEST SiteClock CT001 ignored for matching).`, '');
    L.push('## Counts', '', '```', JSON.stringify(stats, null, 2), '```', '');
    L.push(
      `Row check: created ${stats.toCreate} + merged ${stats.mergedRows} + skipped-existing ${stats.skippedExisting} + already-imported ${stats.skippedAlreadyImported} + blank ${stats.skippedBlankName} + status-marked ${stats.skippedStatusName} + WCT itself ${stats.skippedWct} = ${sumCheck} (CSV ${plan.total})`,
      '',
    );
    L.push(
      '## Customer codes to issue',
      '',
      ...Object.entries(ranges)
        .sort()
        .map(([p, r]) => `- ${p}: ${r.first} – ${r.last} (${r.n})`),
      '',
    );
    L.push('## Merges (exact duplicates: same normalised name + address)', '');
    for (const c of plan.merges) L.push(`- ${c.debtorCodes.join(' + ')} → one customer: ${personName(c.rows[0])} | ${c.address ?? '(no address)'} | contacts ${c.contacts.length}`);
    L.push('', '## Skipped: matches an existing WCT customer (not overwritten)', '');
    for (const m of plan.skippedExisting)
      L.push(`- import ${m.row.debtorCode} "${m.row.name}" | ${m.row.address ?? '-'}  ⇔  existing ${m.existing.customerCode} "${m.existing.name}" | ${m.existing.address || '-'} (by ${m.by})`);
    L.push('', '## Near matches to existing customers (NOT skipped: same first word, different name; please check)', '');
    for (const ex of existing) {
      const w = normKey(ex.name).split(' ')[0];
      if (!w || w.length < 4) continue;
      for (const c of planned)
        if (normKey(c.name).split(' ')[0] === w)
          L.push(`- existing ${ex.customerCode} "${ex.name}" | ${ex.address || '-'}  ~  import ${c.debtorCodes.join('+')} "${c.name}" | ${c.address ?? '-'} → would be ${c.customerCode}`);
    }
    L.push('', '## Skipped: status-marked name (CANCEL / CLOSED / DO NOT USE / OLD / TERMINATED as a tag)', '');
    for (const { row: r, marker } of plan.skippedStatusName) L.push(`- ${r.debtorCode}: ${r.name} (tag ${marker})`);
    L.push('', '## Kept: status word inside a real name', '');
    for (const r of plan.statusWordKept) L.push(`- ${r.debtorCode}: ${r.name} → ${planned.find((c) => c.rows.includes(r))?.customerCode ?? '(not created)'}`);
    L.push('', `## Skipped: WCT itself / blank name`, '', ...plan.skippedSelf.map((r) => `- ${r.debtorCode} ${r.name}`), ...plan.skippedBlankName.map((c) => `- ${c} (blank Name)`), '');
    L.push('## 10 random customers as they would be created (emails/phones masked)', '');
    for (const c of sample(planned, 10)) {
      L.push(`- **${c.customerCode}** ${personName(c.rows[0])} (Debtor ${c.debtorCodes.join('+')}${c.rows[0].uen ? `, UEN ${c.rows[0].uen}` : ''})`);
      L.push(
        `  - address: ${c.address ?? '—'}; phone: ${c.phone ? maskPhone(c.phone) : '—'}; email: ${c.email ? maskEmail(c.email) : c.emailCandidate ? `null (${c.emailNulledReason})` : '—'}; currency SGD`,
      );
      for (const k of c.contacts)
        L.push(`  - contact${k.isPrimary ? ' (primary)' : ''}: ${c.rows[0].isIndividual ? '(person)' : k.name} · ${k.phone ? maskPhone(k.phone) : '—'} · ${k.email ? maskEmail(k.email) : '—'}`);
      if (c.site) L.push(`  - site: "${c.site.name}" — ${c.site.address}${c.site.contactDetail ? ' (+ site contact)' : ''}`);
    }
    L.push('', '## Customer.email left null (email kept on the contact)', '');
    const nulled = planned.filter((c) => c.emailNulledReason);
    const byEmail = new Map<string, Planned[]>();
    for (const c of nulled) byEmail.set(c.emailCandidate!, [...(byEmail.get(c.emailCandidate!) ?? []), c]);
    for (const [e, cs] of byEmail) L.push(`- ${maskEmail(e)} (${cs[0].emailNulledReason}): ${cs.map((c) => `${c.customerCode} ${personName(c.rows[0])}`).join('; ')}`);
    L.push('', '## Unparsed phones (not imported; shape only)', '');
    for (const u of unparsed) L.push(`- ${u.code} ${u.field}: ${maskShape(u.value)}`);
    L.push('', '## Invalid emails (not imported; shape only)', '');
    for (const x of invalidEmails) L.push(`- ${x.code}: ${maskShape(x.e)}`);
    L.push('', '## UEN not kept, by shape (kept UENs are in the mapping CSV)', '');
    const junk = new Map<string, string[]>();
    for (const r of createdRows.filter((r) => r.uenStatus === 'junk' || r.uenStatus === 'nric-shaped')) {
      const k = r.uenStatus === 'nric-shaped' ? '(NRIC-shaped, dropped)' : maskShape(raw.find((x) => x.DebtorCode.trim() === r.debtorCode)!.UEN.trim());
      junk.set(k, [...(junk.get(k) ?? []), r.debtorCode]);
    }
    for (const [k, codes] of [...junk].sort((a, b) => b[1].length - a[1].length)) L.push(`- \`${k}\` × ${codes.length} (e.g. ${codes.slice(0, 5).join(', ')})`);
    L.push('', '## Names repaired from mojibake', '');
    for (const r of allClean) {
      const before = raw
        .find((x) => x.DebtorCode.trim() === r.debtorCode)!
        .Name.trim()
        .replace(/\s+/g, ' ');
      if (before !== r.name && /[^\x20-\x7e]/.test(before)) L.push(`- ${r.debtorCode}: ${r.isIndividual ? '(individual)' : `${before}  →  ${r.name}`}`);
    }
    L.push('', '## Names worth a look (imported as is)', '');
    for (const r of createdRows.filter((r) => /cancel|closed|do not use|dormant/i.test(r.name) || /^[^\p{L}\p{N}]/u.test(r.name)))
      L.push(`- ${r.debtorCode}: ${r.name} → ${planned.find((c) => c.rows.includes(r))!.customerCode}`);
    L.push('');

    // ── Apply ──
    if (APPLY) {
      if (!fs.existsSync(mappingPath)) fs.writeFileSync(mappingPath, csvLine(MAP_HEADER));
      for (let i = 0; i < planned.length; i += BATCH) {
        const batch = planned.slice(i, i + BATCH);
        await prisma.$transaction(
          async (tx) => {
            await tx.customer.createMany({
              data: batch.map((c) => ({ id: c.id, customerCode: c.customerCode, name: c.name, email: c.email, phone: c.phone, address: c.address, currency: 'SGD', organizationId: WCT_ORG })),
            });
            await tx.customerContact.createMany({
              data: batch.flatMap((c) => c.contacts.map((k) => ({ customerId: c.id, name: k.name, phone: k.phone, email: k.email, isPrimary: k.isPrimary }))),
            });
            const sites = batch.filter((c) => c.site).map((c) => ({ c, siteId: randomUUID() }));
            await tx.siteOffice.createMany({ data: sites.map(({ c, siteId }) => ({ id: siteId, customerId: c.id, name: c.site!.name, address: c.site!.address })) });
            await tx.contactDetail.createMany({
              data: sites.filter(({ c }) => c.site!.contactDetail).map(({ c, siteId }) => ({ siteOfficeId: siteId, ...c.site!.contactDetail! })),
            });
            await tx.actionLog.createMany({
              data: batch.map((c) => ({
                organizationId: WCT_ORG,
                actorType: 'SYSTEM',
                actorId: ACTOR,
                actorName: 'System creation',
                channel: 'operator',
                action: 'CREATE',
                resource: 'Customer',
                resourceId: c.id,
                status: 'SUCCESS',
                details: { customerCode: c.customerCode, debtorCodes: c.debtorCodes, contacts: c.contacts.length, site: !!c.site, source: 'DP Info debtor export' },
              })),
            });
          },
          { timeout: 120_000, maxWait: 20_000 },
        );
        fs.appendFileSync(
          mappingPath,
          batch
            .flatMap((c) =>
              c.rows.map((r, j) =>
                csvLine([r.debtorCode, j === 0 ? 'created' : 'merged', c.customerCode, c.id, j === 0 ? '' : c.rows[0].debtorCode, r.name, r.uen ?? '', r.uenStatus, r.acctOpenDate ?? '', '']),
              ),
            )
            .join(''),
        );
        console.log(`WRITE batch ${i / BATCH + 1}: ${batch.length} customers ${batch[0].customerCode}…${batch[batch.length - 1].customerCode} (+contacts, sites, ActionLog)`);
      }
      const others = mapRows.filter((r) => r[1] !== 'created' && r[1] !== 'merged');
      fs.writeFileSync(path.join(outDir, 'wct-customer-mapping.skipped.csv'), csvLine(MAP_HEADER) + others.map(csvLine).join(''));
    } else {
      fs.writeFileSync(path.join(outDir, 'wct-customer-mapping.dryrun.csv'), csvLine(MAP_HEADER) + mapRows.map(csvLine).join(''));
    }
    const reportPath = path.join(outDir, `wct-import-report.${tag}.md`);
    fs.writeFileSync(reportPath, L.join('\n'));

    console.log(JSON.stringify(stats, null, 2));
    console.log(`row check ${sumCheck}/${plan.total}`);
    console.log(
      'codes:',
      Object.entries(ranges)
        .sort()
        .map(([, r]) => `${r.first}-${r.last}(${r.n})`)
        .join(' '),
    );
    console.log(`report: ${reportPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('ERR', String(e?.message ?? e).slice(0, 400));
  process.exit(1);
});
