/**
 * Round W follow-up (read-only unless --apply): what is the stored CI no. on each shipment, versus what the CI PDF
 * filed on that shipment prints? Lists shipments with no CI file. Prints shipment refs, keys and file names only (never email content).
 * Fixes (--apply): stored ≠ the number its own CI PDF prints → the printed one; a stored no. shared by several
 * shipments whose only email evidence ties it to ANOTHER shipment's B/L → cleared.
 *   DATABASE_URL=<prod> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_ci-no-audit.ts --org=<id> [--apply]
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { CommonModule } from '../src/common/common.module';
import { S3Service } from '../src/common/services/s3.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { pdfText } from '../src/shipments/trade-coa';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), CommonModule] })
class M {}
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ORG = arg('org')!;
const APPLY = process.argv.includes('--apply');

/** Every "label: value" pair around an XP / 9000 number so we learn what the PDF calls it. */
function keysIn(text: string) {
  const t = text.replace(/\s+/g, ' ');
  const xp = [...new Set([...t.matchAll(/XP\d{10}/g)].map((m) => m[0]))];
  const inv = [...new Set([...t.matchAll(/(?<!\d)9000\d{6}(?!\d)/g)].map((m) => m[0]))];
  const bl = [...new Set([...t.matchAll(/\d{3}[A-Z]{2}\d{5}/g)].map((m) => m[0]))];
  const contract = [...new Set([...t.matchAll(/(?<!\d)4540\d{5}(?!\d)/g)].map((m) => m[0]))];
  const labelOf = (v: string) => {
    const i = t.indexOf(v);
    return i < 0 ? '' : t.slice(Math.max(0, i - 40), i).replace(/[\d.,/-]+\s*$/, '').trim().split(/\s{2,}|[|;]/).pop()?.slice(-30) ?? '';
  };
  return { xp: xp.map((v) => ({ v, label: labelOf(v) })), inv: inv.map((v) => ({ v, label: labelOf(v) })), bl, contract };
}

async function main() {
  if (!ORG) throw new Error('--org is required');
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const s3 = app.get(S3Service);
  await runAsOrg(ORG, async () => {
    const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { name: true } });
    if (!/^Asia Deal Hub Japan/i.test(org?.name ?? '')) throw new Error(`refusing: ${ORG} is not the ADH org`);
    const ships: any[] = await prisma.shipment.findMany({
      where: { organizationId: ORG },
      select: { id: true, seqNo: true, blNumber: true, ciNumber: true, ciAmount: true, netWeightMt: true, status: true, order: { select: { orderNo: true } }, contract: { select: { contractNo: true } }, fileLinks: { select: { file: { select: { id: true, docType: true, fileName: true, s3Key: true, mimeType: true, source: true } } } } },
      orderBy: [{ order: { orderNo: 'asc' } }, { seqNo: 'asc' }],
    });
    console.log(`${org!.name} · ${ships.length} shipments · ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
    const fixes: Array<{ id: string; ref: string; from: string | null; to: string | null; why: string }> = [];
    const missing: string[] = [];
    // Which B/L each XP / 9000 no. is tied to in the emails (the B/Ls within ±400 chars of it; content never printed).
    const mails: any[] = await prisma.$queryRawUnsafe(`select "rawMeta"::text as m from "EmailIngestLog" where "organizationId"=$1 and ("rawMeta"::text like '%XP%' or "rawMeta"::text like '%9000%')`, ORG);
    const tiedTo = new Map<string, Set<string>>();
    for (const r of mails) for (const x of (r.m as string).matchAll(/XP\d{10}|(?<!\d)9000\d{6}(?!\d)/g)) {
      const win = (r.m as string).slice(Math.max(0, x.index! - 400), x.index! + 400);
      const set = tiedTo.get(x[0]) ?? new Set<string>();
      for (const b of win.matchAll(/\d{3}[A-Z]{2}\d{5}/g)) set.add(b[0]);
      tiedTo.set(x[0], set);
    }
    const shared = new Map<string, number>();
    for (const s of ships) if (s.ciNumber) shared.set(s.ciNumber, (shared.get(s.ciNumber) ?? 0) + 1);
    for (const s of ships) {
      const ref = `#${s.order?.orderNo ?? '?'}-${s.seqNo ?? '?'}`;
      const cis = s.fileLinks.map((l: any) => l.file).filter((f: any) => f.docType === 'CI');
      console.log(`${ref} (${s.status}) · B/L ${s.blNumber ?? '—'} · net ${s.netWeightMt ?? '—'} · contract ${s.contract?.contractNo ?? "—"} · stored CI no. ${s.ciNumber ?? "—"} · CI amount ${s.ciAmount ?? '—'}`);
      if (!cis.length) {
        const other = s.fileLinks.map((l: any) => l.file).filter((f: any) => /invoice|INV|CI/i.test(f.fileName) && f.docType !== 'CI');
        console.log(`    no CI file${other.length ? ` (other files named like one: ${other.map((f: any) => `${f.fileName} [${f.docType}]`).join(', ')})` : ''}`);
        missing.push(`${ref}${s.blNumber ? ` (B/L ${s.blNumber})` : ''}`);
        if (s.ciNumber && (shared.get(s.ciNumber) ?? 0) > 1) {
          const tied = [...(tiedTo.get(s.ciNumber) ?? [])];
          const mine = s.blNumber && tied.includes(s.blNumber);
          const verdict = mine ? `shared with ${shared.get(s.ciNumber)! - 1} other shipment(s), but the email ties it to this B/L → keep` : tied.length ? `shared with ${shared.get(s.ciNumber)! - 1} other shipment(s); the email ties it to B/L ${tied.join('/')} → clear` : `shared, no email ties it to any B/L → left for a human`;
          console.log(`    stored CI no.: ${verdict}`);
          if (!mine && tied.length && !/^TEST/.test(s.blNumber ?? '')) fixes.push({ id: s.id, ref, from: s.ciNumber, to: null, why: `belongs to B/L ${tied.join('/')}` });
        }
        continue;
      }
      const found = new Set<string>();
      for (const f of cis) {
        if (!/pdf/i.test(f.mimeType) && !/\.pdf$/i.test(f.fileName)) {
          console.log(`    ${f.fileName} [${f.source}] — not a PDF, skipped`);
          continue;
        }
        let text = '';
        try {
          text = await pdfText(await s3.downloadFile(f.s3Key));
        } catch (e) {
          console.log(`    ${f.fileName} [${f.source}] — unreadable: ${(e as Error).message}`);
          continue;
        }
        const k = keysIn(text);
        k.inv.forEach((x) => found.add(x.v));
        // Vedanta prints the XP no. as "Invoice No." (the 9000… in the file name is never printed).
        const flat = text.replace(/\s+/g, ' ');
        k.xp.filter((x) => /invoice/i.test(flat.slice(flat.indexOf(x.v), flat.indexOf(x.v) + 40))).forEach((x) => found.add(x.v));
        console.log(`    ${f.fileName} [${f.source}] · ${text.length} chars`);
        console.log(`      invoice no.: ${k.inv.map((x) => `${x.v} (after "${x.label}")`).join(', ') || '—'}`);
        console.log(`      XP no.:      ${k.xp.map((x) => `${x.v} (after "${x.label}")`).join(', ') || '—'}`);
        console.log(`      B/L in PDF:  ${k.bl.join(', ') || '—'} · contract: ${k.contract.join(', ') || '—'}`);
        if (s.blNumber && k.bl.length && !k.bl.includes(s.blNumber)) console.log(`      ⚠ PDF names B/L ${k.bl.join('/')} but the shipment is ${s.blNumber}`);
      }
      const printed = [...found];
      const verdict = !printed.length ? 'PDF prints no invoice no.' : printed.length > 1 ? `several invoice nos. in the CI files (${printed.join(', ')})` : s.ciNumber === printed[0] ? 'stored = printed ✓' : /^XP/.test(s.ciNumber ?? '') ? `stored XP… ≠ printed ${printed[0]} → clear backfill mistake` : !s.ciNumber ? `blank → printed ${printed[0]}` : `stored ${s.ciNumber} ≠ printed ${printed[0]} (not XP, left alone)`;
      console.log(`    verdict: ${verdict}`);
      // Only a WRONG stored XP no. is corrected (a blank is left for the CI reader / a human; TEST- rows never touched).
      if (printed.length === 1 && s.ciNumber && /^XP/.test(s.ciNumber) && s.ciNumber !== printed[0] && !/^TEST/.test(s.blNumber ?? '')) fixes.push({ id: s.id, ref, from: s.ciNumber, to: printed[0], why: 'its CI PDF prints it' });
      console.log('');
    }
    console.log(`\nshipments without a CI file (${missing.length}): ${missing.join(', ') || 'none'}`);
    const real = missing.filter((m) => !/TEST/.test(m));
    console.log(`  of which real (not TEST-): ${real.join(', ') || 'none'}`);
    console.log(`\n${APPLY ? 'applying' : 'would apply'} ${fixes.length} fix(es):${fixes.map((f) => `\n  ${f.ref} ${f.from ?? '—'} → ${f.to ?? '(blank)'} · ${f.why}`).join('') || ' none'}`);
    if (APPLY) for (const f of fixes) await prisma.shipment.update({ where: { id: f.id }, data: { ciNumber: f.to } });
  });
  await app.close();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
