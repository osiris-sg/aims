/** Round AO — correct the two file names the first apply run stored with control characters (decodeUploadName bug, fixed). */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const p = new PrismaClient();
(async () => {
  const log = JSON.parse(fs.readFileSync('scripts/_an-drive-backfill.partial.json', 'utf8'));
  const out: any[] = [];
  for (const u of log.filter((l: any) => l.action === 'CREATE')) {
    const f = await p.tradeFile.findFirst({ where: { id: u.resourceId, organizationId: ORG }, select: { fileName: true } });
    if (!f || f.fileName === u.details.fileName) continue;
    const r = await p.tradeFile.updateMany({ where: { id: u.resourceId, organizationId: ORG, fileName: f.fileName }, data: { fileName: u.details.fileName } });
    if (!r.count) continue;
    const details = { field: 'fileName', from: f.fileName, to: u.details.fileName, reason: 'upload name decoded to control characters (round AO first run); corrected' };
    await p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-an-drive', actorName: 'System creation', organizationId: ORG, channel: 'operator', action: 'UPDATE', resource: 'trade-file', resourceId: u.resourceId, details } });
    out.push({ at: new Date().toISOString(), action: 'UPDATE', resource: 'trade-file', resourceId: u.resourceId, details });
    console.log('fixed', JSON.stringify(u.details.fileName));
  }
  fs.writeFileSync('scripts/_an-drive-backfill.log.json', JSON.stringify([...log, ...out], null, 1));
  console.log('log entries', log.length + out.length);
  await p.$disconnect();
})();
