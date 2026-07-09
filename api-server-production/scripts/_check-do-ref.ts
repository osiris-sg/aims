import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const doc = await prisma.document.findUnique({
    where: { id: '5ac7c427-41b6-42f2-926f-5095326bf0c6' },
    select: { config: true, updatedAt: true },
  });
  const cfg: any = doc?.config ?? {};
  console.log({ updatedAt: doc?.updatedAt, referenceNo: cfg.referenceNo, referenceQuotationDate: cfg.referenceQuotationDate });
}
main().finally(() => prisma.$disconnect());
