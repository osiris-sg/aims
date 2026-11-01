// Round AZ — prod: switch due dates on for ADH (features.enableStepDueDates = true) with the switch-on day stamped
// (features.stepDueDatesSince = today, Tokyo) so only due dates from today on are flagged. Run AFTER the round AZ
// backend is live (the old code would flag the whole backlog). Only these two keys change; the Activity Log gets a row.
// Dry run by default. Usage (after nest build): DBURL=… node scripts/_az-due-flag-on.js [--apply]
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { withFeatureStamps } = require(path.join(__dirname, '..', 'dist', 'src', 'organizations', 'feature-stamps.js'));
const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
const APPLY = process.argv.includes('--apply');
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
(async () => {
  const ui = await p.organizationUIConfig.findUnique({ where: { organizationId: ORG }, select: { id: true, features: true } });
  if (!ui) throw new Error('ADH has no UI config row');
  const before = ui.features || {};
  const next = withFeatureStamps(before, { ...before, enableStepDueDates: true });
  const changed = Object.keys({ ...before, ...next }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]));
  console.log(`enableStepDueDates ${JSON.stringify(before.enableStepDueDates)} → ${next.enableStepDueDates}; stepDueDatesSince ${JSON.stringify(before.stepDueDatesSince)} → ${next.stepDueDatesSince}; keys changed: ${changed.join(', ') || 'none'}`);
  if (changed.some((k) => !['enableStepDueDates', 'stepDueDatesSince'].includes(k))) throw new Error('unexpected key change');
  if (!APPLY || !changed.length) { console.log(APPLY ? 'already on' : 'Dry run — nothing written.'); return p.$disconnect(); }
  await p.organizationUIConfig.update({ where: { id: ui.id }, data: { features: next } });
  await p.actionLog.create({ data: { organizationId: ORG, actorType: 'SYSTEM', actorId: 'system:round-az', actorName: 'System creation', channel: 'cron', action: 'UPDATE', resource: 'OrganizationUIConfig', resourceId: ui.id, details: { change: 'Due dates switched on (owner approved the rules)', enableStepDueDates: { from: before.enableStepDueDates ?? false, to: true }, stepDueDatesSince: { from: before.stepDueDatesSince ?? null, to: next.stepDueDatesSince } } } });
  console.log('WRITE OrganizationUIConfig.features (+ActionLog)');
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
