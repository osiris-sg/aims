/**
 * Google Play reviewer login for SiteJobs: a field-tech USERNAME account on
 * DEMO INDUSTRIES PTE. LTD. (DEMO-scoped copy of setup-wct-fieldtech.ts), plus
 * a little demo work for it to open.
 *
 *   1. Clerk PRODUCTION user `play_reviewer` (username + strong generated
 *      password, no email / phone, so sign-in never needs an OTP), created with
 *      the same flags as users.service.ts createUser and stamped
 *      external_id = its own id (the `aims_uid` claim the API reads).
 *   2. AIMS: UserOrganization in DEMO + the DEMO `field-tech` UserRole only
 *      (FieldOnlyGuard then locks it into the field app at /scan).
 *   3. Demo data, DEMO only, through the API's own services (the same calls the
 *      endpoints make, so numbering / DO creation follow the normal paths):
 *        - 2 scheduled runs via DeliveriesService.createScheduled (SolarPak 200
 *          Panel, ClearStream Filter AF-40; one unit each). Scheduled runs are
 *          org-wide in the field app's Pending tab; the rider claims one by
 *          scanning an in-stock unit.
 *        - 1 draft SERVICE report via MaintenanceReportsService.create with
 *          play_reviewer as technician (no signature, so it stays `draft` and
 *          shows under Ongoing). clientEmail null + paymentRequired false, so
 *          signing it sends no email and creates no invoice.
 *      Idempotent: runs are found again by their notes marker, the report by
 *      technician + marker.
 *
 * Env (all inline, never read from .env, so a stale local .env cannot point
 * this at the wrong place): DATABASE_URL = the PROD database (host guarded),
 * CLERK_SECRET_KEY = the Clerk PRODUCTION sk_live_ key (prefix guarded),
 * TENANCY_MODE unset/empty (prod is the public layout).
 *
 *   npx ts-node --transpile-only -r tsconfig-paths/register scripts/setup-demo-play-reviewer.ts [--apply]
 *
 * Dry run by default. The password is printed once, on the apply that creates
 * (or --reset-password resets) the Clerk user.
 */
import { randomBytes } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { createClerkClient } from '@clerk/backend';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ActionLogService } from '../src/action-log/action-log.service';
import { ClerkModule } from '../src/clerk/clerk.module';
import { PushModule } from '../src/push/push.module';
import { PrismaService } from '../src/common/prisma.service';
import { DeliveriesService } from '../src/deliveries/deliveries.service';
import { MaintenanceReportsModule } from '../src/maintenance-reports/maintenance-reports.module';
import { MaintenanceReportsService } from '../src/maintenance-reports/maintenance-reports.service';

const ORG_ID = 'de300000-0000-4000-8000-de3000000001'; // DEMO INDUSTRIES PTE. LTD.
const FIELD_TECH_ROLE_ID = '1a2ba706-9e63-428d-ab34-63116f2f07d5'; // DEMO field-tech
const USERNAME = 'play_reviewer';
const FIRST_NAME = 'Play';
const LAST_NAME = 'Reviewer';
const PROD_DB_HOST = 'ep-icy-moon';
const MARKER = 'Demo run for app review';
const REPORT_MARKER = 'Demo service visit for app review';
const SALE_ORDER_ID = '67ab0223-0189-4f2b-8e44-37be5381a96a'; // SO202610-0001 (DEMO requires a Sale Order to schedule)
const SCHEDULED_FOR = '2026-10-28';
const RUNS = [
  { assetId: 'f751f160-933d-46a9-81f4-03beb186a217', label: 'SolarPak 200 Panel', projectId: '9483e872-e740-46f7-9f8a-cbd429030ab6' }, // Clementi Ave 4
  { assetId: '626991bf-35ab-49a4-b524-1ea6ff14aded', label: 'ClearStream Filter AF-40', projectId: '2752d833-82c8-41e2-95f5-028d15ad527f' }, // Queenstown Ring Road
];

const APPLY = process.argv.includes('--apply');
const RESET_PASSWORD = process.argv.includes('--reset-password');

function die(msg: string): never {
  console.error(`ABORT: ${msg}`);
  process.exit(1);
}

const genPassword = () => `Pr!${randomBytes(18).toString('base64').replace(/[+/=]/g, '').slice(0, 20)}`;

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, MaintenanceReportsModule] })
class Ctx {}

async function main() {
  const dbUrl = process.env.DATABASE_URL || die('DATABASE_URL not set');
  if (!new URL(dbUrl).host.includes(PROD_DB_HOST)) die(`DATABASE_URL is not the prod database (${PROD_DB_HOST})`);
  if (process.env.TENANCY_MODE === 'per-org') die('TENANCY_MODE=per-org is the dev layout; unset it for prod');
  const secretKey = process.env.CLERK_SECRET_KEY || die('CLERK_SECRET_KEY not set');
  if (!secretKey.startsWith('sk_live_')) die('CLERK_SECRET_KEY is not a Clerk PRODUCTION (sk_live_) key');
  console.log(`env=prod  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}  username=${USERNAME}  role=field-tech  org=DEMO\n`);

  const clerk = createClerkClient({ secretKey });
  const app = await NestFactory.createApplicationContext(Ctx, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService) as any;
    const actionLog = app.get(ActionLogService);

    // ── pre-flight ─────────────────────────────────────────────────────────
    const org = await prisma.organization.findUnique({ where: { id: ORG_ID }, select: { name: true } });
    if (!org) die('DEMO org not found');
    const role = await prisma.role.findFirst({ where: { id: FIELD_TECH_ROLE_ID, organizationId: ORG_ID }, select: { name: true } });
    if (role?.name !== 'field-tech') die('DEMO field-tech role not found');
    const so = await prisma.document.findFirst({ where: { id: SALE_ORDER_ID, organizationId: ORG_ID, type: 'SALES_ORDER' }, select: { name: true } });
    if (!so) die('DEMO sale order not found');
    console.log(`  org        ${org.name}`);
    console.log(`  role       field-tech (${FIELD_TECH_ROLE_ID}): FieldOnlyGuard locks this user to /scan`);

    // ── 1. Clerk PRODUCTION user ───────────────────────────────────────────
    let clerkUser = (await clerk.users.getUserList({ username: [USERNAME] })).data[0];
    let password: string | null = null;
    if (clerkUser) {
      console.log(`  clerk      exists ${clerkUser.id} (external_id ${clerkUser.externalId ?? 'none'})`);
      if (APPLY && RESET_PASSWORD) {
        password = genPassword();
        await clerk.users.updateUser(clerkUser.id, { password, skipPasswordChecks: true });
        console.log('  clerk      password reset');
      }
    } else if (!APPLY) {
      console.log(`  clerk      would CREATE ${USERNAME} (${FIRST_NAME} ${LAST_NAME}), generated password, no email/phone, external_id = own id`);
    } else {
      password = genPassword();
      // Same flags as users.service.ts createUser.
      clerkUser = await clerk.users.createUser({
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
        username: USERNAME,
        password,
        skipPasswordChecks: true,
        skipPasswordRequirement: true,
      });
      console.log(`  clerk      created ${clerkUser.id}`);
    }
    if (APPLY && clerkUser && clerkUser.externalId !== clerkUser.id) {
      // ClerkIdentityService.stampExternalId: external_id = its own id.
      clerkUser = await clerk.users.updateUser(clerkUser.id, { externalId: clerkUser.id });
      console.log(`  clerk      external_id = ${clerkUser.externalId}`);
    }
    const userId = clerkUser?.id;

    // ── 2. AIMS membership: DEMO only, field-tech only ─────────────────────
    console.log(`  membership ${APPLY ? 'upsert' : 'would upsert'} UserOrganization (DEMO) + field-tech UserRole (only this role)`);
    if (APPLY && userId) {
      const elsewhere = await prisma.userOrganization.count({ where: { userId, organizationId: { not: ORG_ID } } });
      if (elsewhere) die(`${userId} is a member of ${elsewhere} other org(s)`);
      await prisma.userOrganization.upsert({
        where: { userId_organizationId: { userId, organizationId: ORG_ID } },
        update: { isActive: true },
        create: { userId, organizationId: ORG_ID, isActive: true },
      });
      await prisma.userRole.deleteMany({ where: { userId, organizationId: ORG_ID, roleId: { not: FIELD_TECH_ROLE_ID } } });
      await prisma.userRole.upsert({
        where: { userId_roleId_organizationId: { userId, roleId: FIELD_TECH_ROLE_ID, organizationId: ORG_ID } },
        update: { isActive: true },
        create: { userId, roleId: FIELD_TECH_ROLE_ID, organizationId: ORG_ID, isActive: true },
      });
      actionLog.system('play-reviewer-setup', 'CREATE', 'UserRole', { organizationId: ORG_ID, resourceId: userId, details: { username: USERNAME, role: 'field-tech' } });
    }

    // ── 3a. Two scheduled runs ─────────────────────────────────────────────
    const deliveries = app.get(DeliveriesService);
    for (const r of RUNS) {
      const notes = `${MARKER}: ${r.label}`;
      const existing = await prisma.delivery.findFirst({ where: { organizationId: ORG_ID, notes }, select: { deliveryNumber: true, status: true } });
      if (existing) {
        console.log(`  run        exists #${existing.deliveryNumber} (${existing.status}) ${r.label}`);
        continue;
      }
      if (!APPLY) {
        console.log(`  run        would SCHEDULE ${r.label} x1 for ${SCHEDULED_FOR}, project ${r.projectId}, SO ${so.name} (DO minted by createScheduled)`);
        continue;
      }
      const run: any = await deliveries.createScheduled(
        { scheduledFor: SCHEDULED_FOR, items: [{ assetId: r.assetId, quantity: 1 }], projectId: r.projectId, saleOrderId: SALE_ORDER_ID, notes } as any,
        ORG_ID,
      );
      console.log(`  run        scheduled #${run.deliveryNumber} ${r.label}  delivery=${run.id}  DO=${run.documentId ?? 'NONE'}`);
      actionLog.system('play-reviewer-setup', 'CREATE', 'Delivery', { organizationId: ORG_ID, resourceId: run.id, details: { deliveryNumber: run.deliveryNumber, note: notes } });
    }

    // ── 3b. One draft service report ───────────────────────────────────────
    // A rental unit with exactly one open assignment, not on a live run.
    const onLiveRun = await prisma.deliveryItem.findMany({
      where: { inventoryId: { not: null }, delivery: { organizationId: ORG_ID, status: { in: ['scheduled', 'in_progress', 'delivered'] } } },
      select: { inventoryId: true },
    });
    const units = await prisma.inventory.findMany({
      where: {
        status: 'rental',
        id: { notIn: onLiveRun.map((d: any) => d.inventoryId) },
        asset: { organizationId: ORG_ID, deletedAt: null },
        assignments: { some: { endDate: null } },
      },
      orderBy: { sku: 'asc' },
      select: { id: true, sku: true, serialNumber: true, assetId: true, asset: { select: { name: true } }, assignments: { where: { endDate: null }, select: { project: { select: { name: true, customer: { select: { id: true, name: true } } } } } } },
    });
    const single = units.find((u: any) => u.assignments.length === 1);
    if (!single) die('no DEMO rental unit with exactly one open assignment for the draft report');
    const site = single.assignments[0].project;
    const reportExisting = userId
      ? await prisma.maintenanceServiceReport.findFirst({ where: { organizationId: ORG_ID, technicianUserId: userId, description: REPORT_MARKER }, select: { reportNumber: true, status: true } })
      : null;
    if (reportExisting) {
      console.log(`  report     exists #${reportExisting.reportNumber} (${reportExisting.status})`);
    } else if (!APPLY || !userId) {
      console.log(`  report     would CREATE draft SERVICE on ${single.sku} (${single.asset.name}) at ${site.name} / ${site.customer?.name}, technician ${FIRST_NAME} ${LAST_NAME}`);
    } else {
      const now = new Date();
      const report: any = await app.get(MaintenanceReportsService).create(
        {
          assetId: single.assetId,
          inventoryId: single.id,
          kind: 'SERVICE',
          description: REPORT_MARKER,
          // No `signature`: create() leaves the row at `draft` (awaiting signature).
          paymentRequired: false,
          technicianName: `${FIRST_NAME} ${LAST_NAME}`,
          serviceData: {
            templateId: 'GENERIC_V1',
            templateVersion: 1,
            customerId: site.customer?.id ?? null,
            customerName: site.customer?.name ?? null,
            clientEmail: null,
            jobLocation: site.name,
            model: single.asset.name,
            serial: single.serialNumber ?? single.sku,
            serviceDate: now.toISOString().slice(0, 10),
            nextServiceDate: null,
            timeIn: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            timeOut: now.toISOString(),
            checklist: [1, 2, 3, 4, 5],
            remarks: 'Routine inspection. Unit cleaned and output checked. Awaiting customer signature.',
            techSignatureKey: null,
            clientSignatureKey: null,
            clientSignerName: null,
          },
        } as any,
        ORG_ID,
        userId,
      );
      console.log(`  report     created #${report.reportNumber} status=${report.status} on ${single.sku}  id=${report.id}`);
      actionLog.system('play-reviewer-setup', 'CREATE', 'MaintenanceServiceReport', { organizationId: ORG_ID, resourceId: report.id, details: { reportNumber: report.reportNumber } });
    }

    console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE: nothing written. Re-run with --apply.'}`);
    if (APPLY) {
      console.log(`\n  Username:  ${USERNAME}`);
      console.log(password ? `  Password:  ${password}` : '  Password:  (unchanged: user already existed)');
      console.log('  Signs in:  app.ai-ms.io, lands on the field app (/scan), DEMO INDUSTRIES only');
    }
    // Let the fire-and-forget ActionLog writes land before closing.
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
