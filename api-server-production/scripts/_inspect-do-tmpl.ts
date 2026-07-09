import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production', override: true });
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
  for (const id of ['f0f67782-5577-4a20-bd2e-99734f5b9329', 'b4898f54-fec8-46dd-a3be-52fc47e34c05']) {
    const t = await prisma.documentTemplate.findUnique({ where: { id }, select: { id: true, name: true, type: true, config: true, styleConfig: true, layoutConfig: true } });
    const cfg: any = t?.config ?? {};
    const json = JSON.stringify(cfg);
    const imageKeys = Object.keys(cfg).filter((k) => /image|logo|chop|sign|seal/i.test(k));
    console.log(`${t?.type} ${t?.id.slice(0,8)}: configKeys=[${Object.keys(cfg).join(',')}]`);
    console.log(`  image-ish keys: ${imageKeys.map((k) => `${k}=${String(cfg[k]).slice(0, 80)}`).join(' | ') || 'none'}`);
    console.log(`  config bytes=${json.length}, hasS3/url refs=${(json.match(/https?:\/\//g) || []).length}`);
  }
}
main().finally(() => prisma.$disconnect());
