/**
 * Round R, Part 2A — apply hand-reviewed decisions to the inbox backlog (ADH only; dry run unless --apply).
 * decisions.json: [{ subject60, targets: ["#15-1" | "#16"], files: [{ att: 0, docType: "DELIVERY_NOTE", to: "#15-1" }],
 * evidence, confidence }]. A row is matched by its subject60 + fromDomain + the attachment names listed.
 * AUTO-GATE: a file goes only to a step that takes its type and only when that owner has no file of that type yet
 * (never replace); fields are never overwritten (the planner only fills blanks). Prints from-domain + subject 60.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ActionLogService } from '../src/action-log/action-log.service';
import { PushModule } from '../src/push/push.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { IngestionEmailModule } from '../src/ingestion-email/ingestion-email.module';
import { EmailTriageService, IntakeAction } from '../src/ingestion-email/email-triage.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, ActionLogModule, PushModule, IngestionEmailModule] })
class M {}
const ORG = process.argv.find((a) => a.startsWith('--org='))?.slice(6)!;
const FILE = process.argv.find((a) => a.startsWith('--decisions='))?.slice(12)!;
const APPLY = process.argv.includes('--apply');
const domainOf = (from: string | null | undefined) => (/@([^>\s]+)/.exec(from ?? '')?.[1] ?? '?').toLowerCase().replace(/[>;,]+$/, '');
const subject60 = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const ACTOR = { id: 'system:email-review', name: 'Email review' };
type Decision = { subject60: string; fromDomain: string; attNames?: string[]; _match?: string; targets: string[]; files?: Array<{ att: number; docType: string; to: string }>; evidence: string; confidence: 'high' | 'medium' | 'low'; leave?: boolean };

async function main() {
  const decisions: Decision[] = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const triage = app.get(EmailTriageService);
  const actionLog = app.get(ActionLogService);
  await runAsOrg(ORG, async () => {
    const records = await triage.matchRecords(ORG);
    const refOf = (ref: string) => {
      const m = /^#(\d+)(?:-(\d+))?$/.exec(ref)!;
      const r = records.find((x) => x.orderNo === Number(m[1]) && (m[2] ? x.seqNo === Number(m[2]) : true));
      if (!r) throw new Error(`unknown ref ${ref}`);
      return { orderId: r.orderId, shipmentId: m[2] ? r.shipmentId : null };
    };
    const rows: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, inboxState: { in: ['SUGGESTED', 'UNMATCHED', 'UNSURE'] } }, orderBy: { createdAt: 'asc' } });
    console.log(`${decisions.length} decision(s) · ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
    let applied = 0;
    for (const d of decisions) {
      const cands = rows.filter(
        (r) =>
          subject60(r.subject) === d.subject60 &&
          domainOf(r.fromAddress) === d.fromDomain &&
          (!d.attNames || d.attNames.every((n) => (r.rawMeta?.attachments ?? []).some((a: any) => a.name === n))) &&
          (d._match === undefined || (d._match === '' ? !String(r.rawMeta?.bodyText ?? '').trim() : String(r.rawMeta?.bodyText ?? '').includes(d._match))),
      );
      if (cands.length !== 1) {
        console.log(`✗ ${d.fromDomain} | ${d.subject60}: ${cands.length} rows match — skipped`);
        continue;
      }
      const row = cands[0];
      if (d.leave) {
        // Truly ambiguous: stays in Unprocessed with a precise reason (what is missing) on the row.
        console.log(`${APPLY ? '↺' : '·'} ${d.fromDomain} | ${d.subject60} — LEFT: ${d.evidence}`);
        if (APPLY) {
          const cur: any = await prisma.emailIngestLog.findFirst({ where: { id: row.id }, select: { actions: true } });
          await prisma.emailIngestLog.update({ where: { id: row.id }, data: { actions: { ...(cur?.actions ?? {}), evidence: d.evidence, reviewConfidence: 'low', backlog: { ...(cur?.actions?.backlog ?? {}), reason: d.evidence, at: new Date().toISOString() } } as any } });
        }
        continue;
      }
      // Re-type attachments the review named (the planner files by the triage type).
      const triageJson = (row.triage ?? {}) as any;
      const atts: any[] = row.rawMeta?.attachments ?? [];
      const typed = [...(triageJson.attachments ?? [])];
      for (const f of d.files ?? []) {
        const name = atts[f.att]?.name;
        if (!name) throw new Error(`no attachment ${f.att} on ${d.subject60}`);
        const i = typed.findIndex((t) => t.filename === name);
        const entry = { filename: name, docType: f.docType, confidence: 1 };
        if (i >= 0) typed[i] = entry;
        else typed.push(entry);
      }
      // Targets: each file's shipment / order; link-only rows get their targets with no attachments.
      const byTarget = new Map<string, { orderId: string; shipmentId: string | null; attachmentIndexes: number[] }>();
      for (const t of d.targets) {
        const r = refOf(t);
        byTarget.set(t, { ...r, attachmentIndexes: [] });
      }
      for (const f of d.files ?? []) {
        if (!byTarget.has(f.to)) byTarget.set(f.to, { ...refOf(f.to), attachmentIndexes: [] });
        byTarget.get(f.to)!.attachmentIndexes.push(f.att);
      }
      const targets = [...byTarget.values()];
      // AUTO-GATE: the owner must not already hold a file of that type (never replace).
      const gate: string[] = [];
      for (const f of d.files ?? []) {
        const t = byTarget.get(f.to)!;
        const owner = t.shipmentId ? { shipmentId: t.shipmentId } : { orderId: t.orderId };
        // Single-slot types never replace an existing file; delivery notes / vendor invoices / proofs repeat per delivery.
        const REPEATABLE = new Set(['DELIVERY_NOTE', 'VENDOR_INVOICE', 'PAYMENT_PROOF', 'DELIVERY_SCHEDULE', 'BUNDLE_LIST', 'OTHER']);
        const have = REPEATABLE.has(f.docType) ? null : await prisma.tradeFileLink.findFirst({ where: { ...owner, file: { organizationId: ORG, docType: f.docType } }, select: { id: true } });
        if (have) gate.push(`${atts[f.att]?.name} → ${f.to} already has a ${f.docType}`);
        const step = await prisma.tradeStep.findFirst({ where: { organizationId: ORG, ...owner, notApplicable: false, OR: [{ requiredDocTypes: { has: f.docType } }, { optionalDocTypes: { has: f.docType } }] }, select: { displayNo: true, title: true } });
        if (!step) gate.push(`${atts[f.att]?.name}: no step on ${f.to} takes ${f.docType}`);
        else console.log(`  plan: ${atts[f.att]?.name} → ${f.to} · step ${step.displayNo} ${step.title} (${f.docType})`);
      }
      const label = `${d.fromDomain} | ${d.subject60} → ${d.targets.join(' + ')}${(d.files ?? []).length ? ` · ${(d.files ?? []).length} file(s)` : ' · link only'} [${d.confidence}]`;
      if (gate.length) {
        console.log(`✗ AUTO-GATE ${label}: ${gate.join('; ')}`);
        continue;
      }
      console.log(`${APPLY ? '✓' : '·'} ${label}\n    evidence: ${d.evidence}`);
      if (!APPLY) continue;
      await prisma.emailIngestLog.update({ where: { id: row.id }, data: { triage: { ...triageJson, attachments: typed } as any, verdict: 'SHIPMENT', purgeAfter: null } });
      await triage.assign(ORG, row.id, { targets }, ACTOR);
      const after: any = await prisma.emailIngestLog.findFirst({ where: { id: row.id }, select: { actions: true } });
      const planned: IntakeAction[] = after?.actions?.planned ?? [];
      const bad = planned.filter((a) => a.kind === 'file' && a.status === 'planned' && a.stepOk === false);
      if (bad.length) throw new Error(`AUTO-GATE: ${bad.map((b) => b.filename).join(', ')} would go to a step that does not take it`);
      await triage.execute(ORG, row.id, ACTOR, { review: 'AUTO', autoLabel: 'reviewed' });
      const done: any = await prisma.emailIngestLog.findFirst({ where: { id: row.id }, select: { actions: true } });
      await prisma.emailIngestLog.update({ where: { id: row.id }, data: { actions: { ...(done?.actions ?? {}), evidence: d.evidence, reviewConfidence: d.confidence, backlog: { kind: 'AUTO', reason: 'reviewed (round R)', at: new Date().toISOString() } } as any } });
      const filed = ((done?.actions?.done ?? []) as IntakeAction[]).filter((a) => a.kind === 'file' && a.status === 'done').length;
      console.log(`    applied: linked${filed ? `, ${filed} file(s) filed` : ''}`);
      actionLog.system('email-review', 'PROCESS', 'EmailIngestLog', { organizationId: ORG, resourceId: row.id, details: { targets: d.targets, files: filed, confidence: d.confidence } });
      applied++;
    }
    console.log(`\n${applied} applied`);
    if (process.argv.includes('--peek')) {
      const r3 = rows.find((r) => subject60(r.subject).startsWith('Re: 【11月納入】アルミニウムビレット6005C-8インチ 40T 6063ハイスピード') && domainOf(r.fromAddress) === 'mitsui-soko.co.jp' && !(r.rawMeta?.bodyText ?? '').includes('Maersk') && !(r.rawMeta?.bodyText ?? '').includes('横浜揚げ'));
      if (r3) console.log('PEEK row 3 body head:', JSON.stringify((r3.rawMeta?.bodyText ?? '').slice(0, 200)));
    }
  });
  await app.close();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 200));
