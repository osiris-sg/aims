/** Shows recent outbound WhatsApp messages + their Meta delivery status, so we
 *  can tell "accepted by Meta" apart from "actually delivered/read". */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  const rows = await prisma.whatsAppMessage.findMany({
    where: { organizationId: 'd068f159-e45a-4da8-beaf-62e903f44141', direction: 'OUTBOUND' },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { createdAt: true, counterparty: true, body: true, status: true, error: true },
  });
  for (const r of rows) {
    console.log(
      `${r.createdAt.toISOString().slice(11, 19)}  ${String(r.status).padEnd(10)} → ${r.counterparty}  "${(r.body || '').slice(0, 45)}"${r.error ? ' ERR ' + r.error.slice(0, 40) : ''}`,
    );
  }
  await prisma.$disconnect();
})();
