import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const assets = await prod.asset.findMany({
    where: { organizationId: ORG, name: { contains: "zztest", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  console.log("assets:", assets.map(a => a.name));
  const invs = await prod.inventory.findMany({
    where: { organizationId: ORG, OR: [{ sku: { contains: "zztest", mode: "insensitive" } }, { asset: { name: { contains: "zztest", mode: "insensitive" } } }] },
    select: { id: true, sku: true, status: true, deliveryStatus: true, asset: { select: { name: true } } } as any,
  }).catch(async () => {
    return prod.inventory.findMany({
      where: { organizationId: ORG, asset: { name: { contains: "zztest", mode: "insensitive" } } },
      select: { id: true, sku: true, status: true, asset: { select: { name: true } } } as any,
    });
  });
  console.log("inventory:");
  (invs as any[]).forEach((i: any) => console.log(` sku=${i.sku} status=${i.status} delivery=${i.deliveryStatus ?? "-"} asset=${i.asset?.name}`));
  await prod.$disconnect();
})();
