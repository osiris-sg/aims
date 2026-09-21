import { createScriptPrisma } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const rows = await (prisma as any).xeroConnection.findMany({ select: { tenantName: true, scope: true, expiresAt: true } }).catch((e: any) => { console.log("model err:", e.message.slice(0, 80)); return []; });
  for (const c of rows) console.log(`tenant=${c.tenantName} expires=${c.expiresAt}\n  scope: ${c.scope}`);
  process.exit(0);
})();
