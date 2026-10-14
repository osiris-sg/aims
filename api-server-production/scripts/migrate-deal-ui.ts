/**
 * One-off migration for the deal page / step cards (2026-10, ADH Shipments):
 *   1. step templates get optionalDocTypes / requiredFields (same values as
 *      setup-adh-org.ts), and existing TradeStep rows copy them;
 *   2. contracts with a free-text deposit due ("within 5 business days") get
 *      depositDueDays / depositDueUnit where it parses (else left blank);
 *   3. every contract without a shipment gets shipment #1 (B/L pending) —
 *      a contract and its shipments are one deal now;
 *   4. thumbnails for existing PDF / image trade files;
 *   5. auto-complete runs on every open contract / shipment.
 * Dry run by default; refuses anything but the dev database.
 *
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node -r tsconfig-paths/register scripts/migrate-deal-ui.ts [--apply]
 */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/common/prisma.service';
import { S3Service } from '../src/common/services/s3.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { parseDepositDue } from '../src/shipments/trade-deposit';
import { thumbable, TradeThumbsService } from '../src/shipments/trade-thumbs.service';

const ORG_ID = process.env.MIGRATE_ORG_ID || '222c6494-96ae-42d0-9283-1b5eabf47b42'; // Asia Deal Hub Japan LLC (dev)
const APPLY = process.argv.includes('--apply');
const actor = { id: 'migrate-deal-ui', name: 'Migration' };

/** Mirrors STEP_TEMPLATES in setup-adh-org.ts (optional docs default to ['OTHER']). */
const TEMPLATE_EXTRAS: Record<string, { optionalDocTypes?: string[]; requiredFields?: string[] }> = {
  'CONTRACT:PI_PAYMENT': { optionalDocTypes: ['CONTRACT', 'OTHER'] },
  'SHIPMENT:BL_DRAFT_APPROVAL': { requiredFields: ['blNumber', 'contractLineId'], optionalDocTypes: ['ARRIVAL_NOTICE', 'OTHER'] },
  'SHIPMENT:SHIPPING_DOCS': { optionalDocTypes: ['PL', 'COA', 'OTHER'] },
  'SHIPMENT:SEND_DOCS_SCHEDULE': { optionalDocTypes: ['DELIVERY_SCHEDULE', 'OTHER'] },
  'SHIPMENT:AN_INSTRUCTIONS': { optionalDocTypes: ['DELIVERY_SCHEDULE', 'OTHER'] },
  'SHIPMENT:LOGISTICS_PAYMENT': { optionalDocTypes: ['VENDOR_INVOICE', 'PAYMENT_PROOF', 'OTHER'] },
  'SHIPMENT:DELIVERY_CHANGES': { optionalDocTypes: ['DELIVERY_SCHEDULE', 'OTHER'] },
};
const extrasFor = (scope: string, code: string) => {
  const x = TEMPLATE_EXTRAS[`${scope}:${code}`] ?? {};
  return { optionalDocTypes: x.optionalDocTypes ?? ['OTHER'], requiredFields: x.requiredFields ?? [] };
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

function guardHost() {
  const host = new URL(process.env.DATABASE_URL ?? '').host;
  if (host.includes('ep-icy-moon') || host.includes('ep-odd-truth') || !host.includes('ep-steep-truth')) throw new Error(`Refusing: ${host} is not the DEV host`);
}

async function main() {
  guardHost();
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  const prisma = new PrismaService();
  const s3 = new S3Service(new ConfigService());
  const config = new TradeConfigService(prisma);
  const shipments = new ShipmentsService(prisma, config);
  const thumbs = new TradeThumbsService(prisma, s3);

  await runAsOrg(ORG_ID, async () => {
    // 1. Templates + existing steps.
    const templates = await prisma.tradeStepTemplate.findMany({ where: { organizationId: ORG_ID } });
    let tplChanged = 0;
    for (const t of templates) {
      const x = extrasFor(t.scope, t.code);
      if (same(t.optionalDocTypes, x.optionalDocTypes) && same(t.requiredFields, x.requiredFields)) continue;
      tplChanged++;
      if (APPLY) await prisma.tradeStepTemplate.update({ where: { id: t.id }, data: x });
    }
    console.log(`templates: ${tplChanged} of ${templates.length} to update`);
    const steps = await prisma.tradeStep.findMany({ where: { organizationId: ORG_ID }, select: { id: true, code: true, contractId: true, optionalDocTypes: true, requiredFields: true } });
    let stepChanged = 0;
    for (const s of steps) {
      const x = extrasFor(s.contractId ? 'CONTRACT' : 'SHIPMENT', s.code);
      if (same(s.optionalDocTypes, x.optionalDocTypes) && same(s.requiredFields, x.requiredFields)) continue;
      stepChanged++;
      if (APPLY) await prisma.tradeStep.update({ where: { id: s.id }, data: x });
    }
    console.log(`steps:     ${stepChanged} of ${steps.length} to update`);

    // 2. Deposit due.
    const contracts = await prisma.contract.findMany({
      where: { organizationId: ORG_ID },
      select: { id: true, contractNo: true, depositDueNote: true, depositDueDays: true, _count: { select: { shipments: true } } },
    });
    for (const c of contracts) {
      if (c.depositDueDays !== null) continue;
      const due = parseDepositDue(c.depositDueNote);
      console.log(`deposit:   ${c.contractNo} "${c.depositDueNote ?? ''}" → ${due ? `${due.days} ${due.unit.toLowerCase()} days` : 'left blank (not a day count)'}`);
      if (APPLY && due) await prisma.contract.update({ where: { id: c.id }, data: { depositDueDays: due.days, depositDueUnit: due.unit } });
    }

    // 3. Shipment #1 for contracts without one.
    for (const c of contracts.filter((x) => x._count.shipments === 0)) {
      console.log(`shipment:  ${c.contractNo} has none → create shipment #1 (B/L pending)`);
      if (APPLY) await prisma.$transaction((tx: any) => shipments.createInTx(tx, ORG_ID, { contractId: c.id } as any, actor));
    }

    // 4. Thumbnails.
    const files = await prisma.tradeFile.findMany({ where: { organizationId: ORG_ID, thumbKey: null }, select: { id: true, fileName: true, mimeType: true } });
    const todo = files.filter((f) => thumbable(f.mimeType));
    console.log(`thumbs:    ${todo.length} file(s) without a thumbnail (${files.length - todo.length} other types get an icon)`);
    for (const f of todo) {
      if (!APPLY) continue;
      const key = await thumbs.make(ORG_ID, f.id);
      console.log(`           ${key ? '✓' : '✗'} ${f.fileName}`);
    }

    // 5. Auto-complete on every open record.
    if (APPLY) {
      const owners = [
        ...(await prisma.contract.findMany({ where: { organizationId: ORG_ID, status: 'OPEN' }, select: { id: true } })).map((c) => ({ contractId: c.id })),
        ...(await prisma.shipment.findMany({ where: { organizationId: ORG_ID, status: 'OPEN' }, select: { id: true } })).map((s) => ({ shipmentId: s.id })),
      ];
      const done = await config.syncSteps(prisma, ORG_ID, owners, actor);
      console.log(`sync:      ${owners.length} open record(s); auto-completed: ${done.length ? done.join(', ') : 'none'}`);
    }

    // State of each deal after the run.
    for (const c of await prisma.contract.findMany({ where: { organizationId: ORG_ID }, select: { id: true, contractNo: true, depositDueDays: true, depositDueUnit: true } })) {
      const cs = await prisma.tradeStep.findMany({ where: { contractId: c.id }, orderBy: { sortOrder: 'asc' }, select: { displayNo: true, status: true } });
      const ships = await prisma.shipment.findMany({ where: { contractId: c.id }, select: { id: true, blNumber: true, steps: { orderBy: { sortOrder: 'asc' }, select: { displayNo: true, status: true } } } });
      console.log(`\n${c.contractNo}: deposit due ${c.depositDueDays ?? '—'} ${c.depositDueUnit ?? ''}; steps ${cs.map((s) => `${s.displayNo}:${s.status}`).join(' ')}`);
      for (const s of ships) console.log(`  shipment ${s.blNumber ?? '(B/L pending)'}: ${s.steps.map((x) => `${x.displayNo}:${x.status}`).join(' ')}`);
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌', e?.message ?? e);
    process.exit(1);
  });
