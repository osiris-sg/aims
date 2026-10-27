/** Round AS — the waiting file's keys: only its bundles and their own casts (265C168914, 265C170109, 265C1689, 265C1701),
 * not the minority cast 266C1692 (owner: trigger on 265C1701 / 265C1689 or their bundles). Logged. --apply to write. */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const EMAIL = 'ba03dfb5-353a-4f08-bea0-b586d3eb1864';
const p = new PrismaClient();
(async () => {
  const log: any = await p.emailIngestLog.findFirstOrThrow({ where: { id: EMAIL, organizationId: ORG } });
  const waiting = (log.actions?.waiting ?? []) as any[];
  const fixed = waiting.map((w) => {
    const bundles = (w.keys as string[]).filter((k) => k.length === 10);
    return bundles.length ? { ...w, keys: [...bundles, ...new Set(bundles.map((b) => b.slice(0, 8)))] } : w;
  });
  console.log('before:', JSON.stringify(waiting.map((w) => w.keys)), '→ after:', JSON.stringify(fixed.map((w) => w.keys)));
  if (process.argv.includes('--apply')) {
    await p.emailIngestLog.update({ where: { id: EMAIL }, data: { actions: { ...log.actions, waiting: fixed } } });
    await p.actionLog.create({ data: { organizationId: ORG, actorType: 'SYSTEM', actorId: 'system:round-as-go', actorName: 'System creation', channel: 'cron', action: 'UPDATE', resource: 'EmailIngestLog', resourceId: EMAIL, details: { waitingKeys: fixed.map((w) => w.keys), reason: "owner: trigger on 265C1701 / 265C1689 or their bundles (not the minority cast)" } as any } });
    const L = 'scripts/_as-vedanta-go.log.json';
    const prev = JSON.parse(fs.readFileSync(L, 'utf8'));
    prev.push({ at: new Date().toISOString(), action: 'UPDATE', what: 'waiting keys', keys: fixed.map((w) => w.keys) });
    fs.writeFileSync(L, JSON.stringify(prev, null, 1));
    console.log('written');
  }
  await p.$disconnect();
})();
