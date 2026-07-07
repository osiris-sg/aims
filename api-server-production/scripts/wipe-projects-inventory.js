// ═══════════════════════════════════════════════════════════════════════════
// Biofuel wipe: ALL projects (incl. ZZTEST) + ALL untagged inventory,
// then reset every tagged unit to instock for field re-assignment.
//
// ── EXECUTION RECORD ─────────────────────────────────────────────────────
// Run 2026-07-08 against BOTH targets (dry-run → approval → apply each):
//   staging (ep-gentle-bonus, legacy DB): 2 projects deleted, rest zero.
//   prod    (ep-icy-moon):  1,692 assignments + 313 deployments +
//           220 projects + 594 untagged inventory units DELETED;
//           52 tagged units RESET to status=instock/location=null/quantity=1.
//   Keep-docs 7babe78c (DO202607-002) + 7b3c3c28 (QO1202606-003) survived
//   (project-unlinked); Document.projectId/-DeploymentId auto-SET-NULL by FK;
//   MSR/Timeline history preserved. Post-verify: all zeros both DBs.
//
// ── USAGE (from api-server-production/) ──────────────────────────────────
//   TARGET=staging [APPLY=1] npx dotenv -e .env -- node scripts/wipe-projects-inventory.js
//   TARGET=prod    [APPLY=1] npx dotenv -e .env -- node scripts/wipe-projects-inventory.js
//
// TARGET maps staging→DATABASE_STAGING_URL, prod→DATABASE_URL, with hard
// host guards (prod must be ep-icy-moon*; staging must NOT be). DRY RUN by
// default — prints host, snapshot, per-phase plan + samples. APPLY=1
// executes (phases 1-3 in ONE transaction; RESTRICT violation = rollback).
// Reads env only — no credentials in this file.
// ═══════════════════════════════════════════════════════════════════════════
const { PrismaClient } = require('@prisma/client');
const { PrismaNeon } = require('@prisma/adapter-neon');
const { neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');
neonConfig.webSocketConstructor = ws;

const APPLY = process.env.APPLY === '1';
const TARGET = process.env.TARGET;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel ONLY

// ---- Target resolution + hard host guards ----
const PROD_HOST_MARK = 'ep-icy-moon';
if (TARGET !== 'staging' && TARGET !== 'prod') {
  console.error('ABORT: set TARGET=staging or TARGET=prod');
  process.exit(1);
}
const rawUrl = TARGET === 'staging' ? process.env.DATABASE_STAGING_URL : process.env.DATABASE_URL;
if (!rawUrl) {
  console.error(`ABORT: ${TARGET === 'staging' ? 'DATABASE_STAGING_URL' : 'DATABASE_URL'} is not set in the loaded env`);
  process.exit(1);
}
const u = new URL(rawUrl);
u.searchParams.delete('pool_timeout');
u.searchParams.delete('connect_timeout');

// FIRST LINE: the host we are about to touch. Guards:
//  - prod target MUST be the known prod host;
//  - staging target MUST NOT be the prod host (a mispasted URL would be fatal).
console.log(`DB HOST [target=${TARGET}${APPLY ? ' APPLY' : ' DRY-RUN'}]: ${u.hostname}`);
if (TARGET === 'prod' && !u.hostname.includes(PROD_HOST_MARK)) {
  console.error(`ABORT: prod target but host is not ${PROD_HOST_MARK}*`);
  process.exit(1);
}
if (TARGET === 'staging' && u.hostname.includes(PROD_HOST_MARK)) {
  console.error('ABORT: staging target resolves to the PROD host — refusing');
  process.exit(1);
}

const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: u.toString() }) });

(async () => {
  // ── Phase 0: snapshot ──────────────────────────────────────────────────
  const org = await p.organization.findUnique({ where: { id: ORG }, select: { name: true } });
  if (!org) { console.error('ABORT: Biofuel org not found on this DB'); process.exit(1); }
  console.log(`Org: ${org.name} (${ORG})`);

  const [projects, deployments, assignments] = await Promise.all([
    p.project.count({ where: { organizationId: ORG } }),
    p.projectDeployment.count({ where: { organizationId: ORG } }),
    p.assignment.count({ where: { project: { organizationId: ORG } } }),
  ]);
  const taggedByStatus = await p.inventory.groupBy({ by: ['status'], where: { organizationId: ORG, nfcTagUid: { not: null } }, _count: true });
  const untaggedByStatus = await p.inventory.groupBy({ by: ['status'], where: { organizationId: ORG, nfcTagUid: null }, _count: true });
  const fmt = (g) => g.map((x) => `${x.status}:${x._count}`).join(' ') || '(none)';

  console.log('\n== Phase 0: SNAPSHOT (Biofuel only) ==');
  console.log(`  projects:    ${projects}`);
  console.log(`  deployments: ${deployments}`);
  console.log(`  assignments: ${assignments}`);
  console.log(`  tagged inventory:   ${fmt(taggedByStatus)}`);
  console.log(`  untagged inventory: ${fmt(untaggedByStatus)}`);

  // Keep-docs sanity gate — PROD ONLY. The two keep-docs (7babe78c DO,
  // 7b3c3c28 QO) only exist on prod; the legacy staging DB never had them,
  // so the gate is skipped there with a notice.
  if (TARGET === 'prod') {
    const keepDocs = await p.$queryRaw`
      SELECT id::text, name, type, "projectId"::text AS pid, "projectDeploymentId"::text AS pdid
      FROM "Document" WHERE id::text LIKE ${'7babe78c%'} OR id::text LIKE ${'7b3c3c28%'}`;
    console.log('  keep-docs (survive via null project links — verify):');
    keepDocs.forEach((d) => console.log(`    ${d.type} ${d.name}: projectId=${d.pid} deploymentId=${d.pdid}`));
    if (keepDocs.length !== 2 || keepDocs.some((d) => d.pid || d.pdid)) {
      console.error('ABORT: keep-docs missing or unexpectedly project-linked — re-investigate before wiping');
      process.exit(1);
    }
  } else {
    console.log('  keep-docs gate: SKIPPED (staging/legacy DB — docs do not exist there by design)');
  }

  // PITR reminder for the prod run: Neon restore availability is only checkable
  // with NEON_API_KEY (not configured) — surface a manual reminder instead.
  if (TARGET === 'prod' && !APPLY) {
    console.log('\n  ⚠ PITR: cannot check Neon restore window programmatically (no NEON_API_KEY).');
    console.log('    VERIFY IN NEON CONSOLE before giving the APPLY ok: project ep-icy-moon →');
    console.log('    Backup & Restore — confirm point-in-time restore covers now.');
  }

  // ── Per-phase plans ────────────────────────────────────────────────────
  const sampleProjects = await p.project.findMany({ where: { organizationId: ORG }, select: { name: true, projectNumber: true }, take: 5, orderBy: { createdAt: 'desc' } });
  const sampleUntagged = await p.inventory.findMany({ where: { organizationId: ORG, nfcTagUid: null }, select: { sku: true, status: true }, take: 5, orderBy: { updatedAt: 'desc' } });
  const untaggedCount = await p.inventory.count({ where: { organizationId: ORG, nfcTagUid: null } });
  const taggedCount = await p.inventory.count({ where: { organizationId: ORG, nfcTagUid: { not: null } } });

  console.log('\n== PLAN ==');
  console.log(`  Phase 1: DELETE ${assignments} assignments (via project.organizationId)`);
  console.log(`  Phase 2: DELETE ${deployments} projectDeployments`);
  console.log(`  Phase 3: DELETE ${projects} projects  → Document.projectId/-DeploymentId auto-SET-NULL (FK)`);
  console.log(`           newest 5: ${sampleProjects.map((x) => x.projectNumber || x.name).join(' | ')}`);
  console.log(`  Phase 4: DELETE ${untaggedCount} untagged inventory units (incl. ZZTEST-AST-003)`);
  console.log(`           newest 5: ${sampleUntagged.map((x) => `${x.sku}(${x.status})`).join(' | ')}`);
  console.log(`           (Assignment/DocumentItem/TimelineItem/MSR refs auto-SET-NULL)`);
  console.log(`  Phase 5: RESET ${taggedCount} tagged units → status=instock, location=null, quantity=1`);
  console.log('  No keep-list exemptions. Osiris org untouched (org-scoped everywhere).');

  if (!APPLY) {
    console.log('\nDRY RUN complete. No writes. Re-run with APPLY=1 to execute.');
    process.exit(0);
  }

  // ── APPLY ──────────────────────────────────────────────────────────────
  console.log('\n== APPLYING ==');
  // Phases 1-3 atomically. Any FK RESTRICT violation (an unmapped reference)
  // throws → transaction rolls back → nothing half-deleted.
  const [a, d2, p3] = await p.$transaction([
    p.assignment.deleteMany({ where: { project: { organizationId: ORG } } }),
    p.projectDeployment.deleteMany({ where: { organizationId: ORG } }),
    p.project.deleteMany({ where: { organizationId: ORG } }),
  ]);
  console.log(`  Phase 1: assignments deleted:  ${a.count}`);
  console.log(`  Phase 2: deployments deleted:  ${d2.count}`);
  console.log(`  Phase 3: projects deleted:     ${p3.count}`);

  const inv = await p.inventory.deleteMany({ where: { organizationId: ORG, nfcTagUid: null } });
  console.log(`  Phase 4: untagged units deleted: ${inv.count}`);

  const reset = await p.inventory.updateMany({
    where: { organizationId: ORG, nfcTagUid: { not: null } },
    data: { status: 'instock', location: null, quantity: 1 },
  });
  console.log(`  Phase 5: tagged units reset:     ${reset.count}`);

  // Post-verify
  const left = await Promise.all([
    p.project.count({ where: { organizationId: ORG } }),
    p.projectDeployment.count({ where: { organizationId: ORG } }),
    p.assignment.count({ where: { project: { organizationId: ORG } } }),
    p.inventory.count({ where: { organizationId: ORG, nfcTagUid: null } }),
    p.inventory.count({ where: { organizationId: ORG, nfcTagUid: { not: null }, status: { not: 'instock' } } }),
  ]);
  console.log(`\n  VERIFY (want all 0): projects=${left[0]} deployments=${left[1]} assignments=${left[2]} untagged=${left[3]} tagged-not-instock=${left[4]}`);
  console.log('\nDONE.');
  process.exit(0);
})().catch((e) => { console.error('FAILED (transaction rolled back where applicable):', e.message); process.exit(1); });
