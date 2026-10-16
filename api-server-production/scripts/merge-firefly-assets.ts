/**
 * Merge the duplicate FIREFLY 4200 / Advanced Illumination asset records into
 * the single `AIS` record (guru 2026-10-02).
 *
 * Four records existed for one machine — AIS, ALS (a typo of AIS), AIS4260
 * (what quotations used) and AISRENTAL — which split its revenue across rows
 * and broke quote-to-invoice pricing, because a quote written against AIS4260
 * never matched a delivery line carrying AIS.
 *
 * All 19 units already sit under AIS, so this repoints the 18 DocumentItem rows
 * and 18 document configs that reference the others, then removes them.
 * Usage: npx ts-node --transpile-only scripts/merge-firefly-assets.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs"; import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production","utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const KEEP = "ac5dcaff-a8da-4b34-97cd-6df5bb4aa98d";
const VICTIMS = [
  "b48608ce-366d-4bab-81ad-8d1071e7edae", // FIREFLY 4200 (ALS)
  "49389e47-b36f-4228-9c29-95abb99fc45f", // Advanced Illumination System (AIS4260)
  "55c388b0-8d6b-456c-bdd6-d3b91af50d3c", // FIREFLY 4200 (AISRENTAL)
];
const APPLY = process.argv.includes("--apply");

(async () => {
  const keeper = await prisma.asset.findUnique({ where: { id: KEEP }, select: { id: true, name: true, skuKey: true } });
  if (!keeper) throw new Error("keeper asset not found");
  console.log(`keeping ${keeper.name} (${keeper.skuKey})\n`);

  // 1. DocumentItem — guard the (documentId,itemId,lineNumber) unique constraint
  const items = await prisma.documentItem.findMany({
    where: { OR: [{ assetId: { in: VICTIMS } }, { itemId: { in: VICTIMS } }] },
    select: { id: true, documentId: true, itemId: true, lineNumber: true, assetId: true },
  });
  const clash: string[] = [];
  for (const it of items) {
    const exists = await prisma.documentItem.findFirst({
      where: { documentId: it.documentId, itemId: KEEP, lineNumber: it.lineNumber, NOT: { id: it.id } },
      select: { id: true },
    });
    if (exists) clash.push(it.id);
  }
  console.log(`DocumentItem rows to repoint: ${items.length}${clash.length ? ` (⚠ ${clash.length} would collide and are left alone)` : ""}`);

  // 2. Document.config JSON
  const docs = await prisma.document.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, config: true } });
  const touched = docs.filter((d) => VICTIMS.some((v) => JSON.stringify(d.config || {}).includes(v)));
  console.log(`Document configs to rewrite : ${touched.length}  ${touched.slice(0, 6).map((d) => d.name).join(", ")}${touched.length > 6 ? " …" : ""}`);

  if (!APPLY) { console.log("\n[DRY] nothing written"); process.exit(0); }

  for (const it of items) {
    if (clash.includes(it.id)) continue;
    await prisma.documentItem.update({ where: { id: it.id }, data: { assetId: KEEP, ...(VICTIMS.includes(it.itemId) ? { itemId: KEEP } : {}) } });
  }
  for (const d of touched) {
    let s = JSON.stringify(d.config);
    for (const v of VICTIMS) s = s.split(v).join(KEEP);
    await prisma.document.update({ where: { id: d.id }, data: { config: JSON.parse(s) } });
  }
  // AssetTemplateTag blocks the delete with a FK. All four records carry the
  // SAME templateId and the keeper already has it, so the victims' tags are
  // duplicates — remove them rather than repoint (which would collide).
  const tags = await prisma.assetTemplateTag.deleteMany({ where: { assetId: { in: VICTIMS } } });
  if (tags.count) console.log(`  removed ${tags.count} duplicate template tag(s)`);

  for (const v of VICTIMS) {
    const a = await prisma.asset.findUnique({ where: { id: v }, select: { name: true, skuKey: true } });
    await prisma.asset.delete({ where: { id: v } });
    console.log(`  − removed ${a?.name} (${a?.skuKey})`);
    await prisma.actionLog.create({ data: {
      actorType: "SYSTEM", actorId: "system:merge-firefly-assets", actorName: "System creation",
      organizationId: ORG, channel: "cron", action: "DELETE", resource: "asset", resourceId: v,
      details: { note: `merged into ${keeper.name} (${keeper.skuKey})`, mergedName: a?.name, mergedSkuKey: a?.skuKey },
    } });
  }
  console.log(`\nDONE: ${items.length - clash.length} document items + ${touched.length} configs repointed to ${keeper.skuKey}`);
  process.exit(0);
})();
