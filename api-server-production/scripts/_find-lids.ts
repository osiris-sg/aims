/** Sender LIDs seen in stored group messages, to identify who is who. */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG = 'ad9127a7-cbc4-4108-b014-8b32123a5362'; // Denzel Office

(async () => {
  const rows = await prisma.whatsAppMessage.findMany({
    where: { organizationId: ORG, counterparty: { endsWith: '@g.us' } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { counterparty: true, body: true, payload: true, createdAt: true, direction: true },
  });

  const senders = new Map<string, { count: number; sample: string; last: Date }>();
  for (const r of rows) {
    const from = (r.payload as any)?.from;
    if (!from) continue;
    const cur = senders.get(from) || { count: 0, sample: '', last: r.createdAt };
    cur.count++;
    if (!cur.sample && r.body) cur.sample = r.body.slice(0, 60);
    senders.set(from, cur);
  }

  console.log(`Group messages inspected: ${rows.length}`);
  console.log(`Distinct sender LIDs: ${senders.size}\n`);
  for (const [lid, info] of [...senders.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${lid.padEnd(22)} ${String(info.count).padStart(3)} msg  "${info.sample}"`);
  }
  await prisma.$disconnect();
})();
