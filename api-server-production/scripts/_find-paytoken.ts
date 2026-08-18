import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const rows: any[] = await p.$queryRawUnsafe(
    `SELECT id, name, type, config->>'payToken' AS token FROM "Document" WHERE config->>'payToken' IS NOT NULL ORDER BY "updatedAt" DESC LIMIT 5`
  );
  for (const r of rows) console.log(r.type, r.name, r.token);
  await p.$disconnect();
})();
