/** Post-move verification: both orgs hold what they should. */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DENZEL = 'ad9127a7-cbc4-4108-b014-8b32123a5362';
const OSIRIS = 'd068f159-e45a-4da8-beaf-62e903f44141';

async function summary(id: string) {
  const org = await prisma.organization.findUnique({ where: { id }, select: { name: true } });
  const conn = await prisma.whatsAppConnection.findUnique({
    where: { organizationId: id },
    select: { displayPhoneNumber: true, verifiedName: true, status: true },
  });
  return {
    org: org?.name,
    connection: conn ? `${conn.displayPhoneNumber} (${conn.verifiedName}) ${conn.status}` : 'none',
    qna: await prisma.whatsAppQnA.count({ where: { organizationId: id } }),
    agentConfig: await prisma.whatsAppAgentConfig.count({ where: { organizationId: id } }),
    messages: await prisma.whatsAppMessage.count({ where: { organizationId: id } }),
    contacts: await prisma.whatsAppContact.count({ where: { organizationId: id } }),
    customers: await prisma.customer.count({ where: { organizationId: id } }),
    documents: await prisma.document.count({ where: { organizationId: id } }),
    crmModule: !!(await prisma.organizationModule.findFirst({
      where: { organizationId: id, moduleCode: 'CRM', enabled: true },
    })),
    users: await prisma.userOrganization.count({ where: { organizationId: id, isActive: true } }),
  };
}

(async () => {
  console.log('DENZEL OFFICE:', JSON.stringify(await summary(DENZEL), null, 1));
  console.log('\nOSIRIS TECHNOLOGY:', JSON.stringify(await summary(OSIRIS), null, 1));
  await prisma.$disconnect();
})();
