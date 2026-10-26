import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const log = JSON.parse(fs.readFileSync('scripts/_an-drive-backfill.partial.json', 'utf8'));
  const ups = log.filter((l: any) => l.action === 'CREATE');
  const rows = await p.tradeFile.findMany({ where: { id: { in: ups.map((u: any) => u.resourceId) } }, select: { id: true, fileName: true } });
  const by = new Map(rows.map((r) => [r.id, r.fileName]));
  let bad = 0;
  for (const u of ups) if (by.get(u.resourceId) !== u.details.fileName) { bad++; console.log('DIFF', JSON.stringify(u.details.fileName), JSON.stringify(by.get(u.resourceId))); }
  console.log('uploads', ups.length, 'rows', rows.length, 'name diffs', bad, 'links', log.filter((l: any) => l.action === 'LINK').length);
  await p.$disconnect();
})();
