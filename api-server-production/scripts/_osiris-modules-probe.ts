import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const envFile = process.argv[2] || '.env';
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';
async function main() {
  console.log(`==== ${envFile} ====`);
  const mods = await prisma.organizationModule.findMany({ where: { organizationId: ORG }, orderBy: { moduleCode: 'asc' } as any });
  console.log('Modules:', mods.map((x: any) => `${x.moduleCode}=${x.isEnabled ?? x.enabled}`).join(', '));
  const org = await prisma.organization.findUnique({ where: { id: ORG } });
  const feats = (org as any)?.features ?? (org as any)?.featureFlags ?? null;
  console.log('Org feature flags:', JSON.stringify(feats));
  const setting = await prisma.accountingSetting.findUnique({ where: { organizationId: ORG } });
  console.log('AccountingSetting:', setting ? JSON.stringify({ baseCurrency: setting.baseCurrency, yearOpeningDate: setting.yearOpeningDate, fiscalYearEndDay: setting.fiscalYearEndDay, fiscalYearEndMonth: setting.fiscalYearEndMonth, controlAccounts: setting.controlAccounts, taxRegistrationNumber: setting.taxRegistrationNumber, taxDefaultPercentage: setting.taxDefaultPercentage, lockedThroughDate: setting.lockedThroughDate }) : 'NONE');
}
main().catch((e) => console.error(e.message)).finally(() => prisma.$disconnect());
