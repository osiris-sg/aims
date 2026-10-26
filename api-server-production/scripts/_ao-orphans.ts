/** Round AO — files uploaded by the Drive job that have no Activity Log row (an interrupted run). Read-only unless --log. */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const p = new PrismaClient();
(async () => {
  const files = await p.tradeFile.findMany({ where: { organizationId: ORG, uploadedById: 'system:round-an-drive' }, select: { id: true, fileName: true, docType: true, createdAt: true, notes: true, links: { select: { shipmentId: true, orderId: true, contractId: true, stepId: true } } } });
  const logged = new Set((await p.actionLog.findMany({ where: { organizationId: ORG, actorId: 'system:round-an-drive', resource: 'trade-file' }, select: { resourceId: true } })).map((r) => r.resourceId));
  const orphans = files.filter((f) => !logged.has(f.id));
  console.log('job files', files.length, 'logged', files.length - orphans.length, 'unlogged', orphans.length);
  for (const f of orphans) console.log(' ', f.id, f.docType, JSON.stringify(f.fileName), f.notes, JSON.stringify(f.links));
  if (process.argv.includes('--log')) {
    const out: any[] = [];
    for (const f of orphans) {
      const details = { docType: f.docType, fileName: f.fileName, drivePath: f.notes?.replace(/^ADH Drive: /, ''), links: f.links, note: 'uploaded by the interrupted run (step sync failed after the file was stored); logged afterwards' };
      await p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-an-drive', actorName: 'System creation', organizationId: ORG, channel: 'operator', action: 'CREATE', resource: 'trade-file', resourceId: f.id, details } });
      out.push({ at: new Date().toISOString(), action: 'CREATE', resource: 'trade-file', resourceId: f.id, details });
    }
    const LOG = 'scripts/_an-drive-backfill.log.json';
    fs.writeFileSync(LOG, JSON.stringify([...JSON.parse(fs.readFileSync(LOG, 'utf8')), ...out], null, 1));
    console.log('logged', out.length);
  }
  await p.$disconnect();
})();
