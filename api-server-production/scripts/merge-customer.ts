/**
 * Merge one customer record into another and retire the loser.
 * Usage: --keep=<code|id> --lose=<code|id> [--apply]
 *
 * Built after the FIREFLY asset merge failed on an unscanned foreign key: this
 * walks EVERY model that references Customer, repoints each, rewrites the
 * customerId inside Document.config JSON, and only then deletes.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs"; import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production","utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const APPLY = process.argv.includes("--apply");
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];

(async () => {
  const all = await prisma.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, customerCode: true, xeroId: true } });
  const pick = (v?: string) => all.find((c) => c.id === v || c.customerCode === v);
  const keep = pick(arg("keep")), lose = pick(arg("lose"));
  if (!keep || !lose) throw new Error("keep/lose not found");
  console.log(`keep  ${keep.customerCode}  ${keep.name}  ${keep.xeroId ? "(Xero linked)" : "(no Xero link)"}`);
  console.log(`lose  ${lose.customerCode}  ${lose.name}  ${lose.xeroId ? "(Xero linked)" : "(no Xero link)"}\n`);

  // every relational table that points at Customer
  const tables: Array<[string, any]> = [
    ["CustomerBalance", prisma.customerBalance], ["CustomerContact", prisma.customerContact],
    ["CustomerInfoRequest", prisma.customerInfoRequest], ["Delivery", prisma.delivery],
    ["DocumentEmbedding", prisma.documentEmbedding], ["DocumentSignLink", prisma.documentSignLink],
    ["Order", prisma.order], ["Payment", prisma.payment], ["PriceHistory", prisma.priceHistory],
    ["Project", prisma.project], ["RecurringInvoiceTemplate", prisma.recurringInvoiceTemplate],
    ["SiteOffice", prisma.siteOffice], ["Transaction", prisma.transaction],
  ];
  let moved = 0;
  for (const [name, model] of tables) {
    let n = 0;
    try { n = await model.count({ where: { customerId: lose.id } }); } catch { console.log(`   (${name}: no customerId column, skipped)`); continue; }
    if (!n) continue;
    console.log(`   ${name.padEnd(26)} ${n}`);
    moved += n;
    if (APPLY) await model.updateMany({ where: { customerId: lose.id }, data: { customerId: keep.id } });
  }
  if (!moved) console.log("   (no relational rows)");

  // Document.config.customerId lives in JSON
  const docs = await prisma.document.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, config: true } });
  const touched = docs.filter((d) => (d.config as any)?.customerId === lose.id);
  console.log(`\n   Document.config.customerId      ${touched.length}  ${touched.slice(0, 5).map((d) => d.name).join(", ")}${touched.length > 5 ? " …" : ""}`);
  if (APPLY) for (const d of touched) {
    const c: any = d.config;
    await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, customerId: keep.id, customerName: keep.name, customerCode: keep.customerCode ?? c.customerCode } as any } });
  }

  if (!APPLY) { console.log("\n[DRY] nothing written"); process.exit(0); }
  // carry a Xero link across if the keeper lacks one
  if (!keep.xeroId && lose.xeroId) { await prisma.customer.update({ where: { id: keep.id }, data: { xeroId: lose.xeroId } }); console.log("   carried the Xero link to the keeper"); }
  await prisma.customer.delete({ where: { id: lose.id } });
  await prisma.actionLog.create({ data: {
    actorType: "SYSTEM", actorId: "system:merge-customer", actorName: "System creation",
    organizationId: ORG, channel: "cron", action: "DELETE", resource: "customers", resourceId: lose.id,
    details: { note: `merged into ${keep.customerCode} ${keep.name}`, removed: `${lose.customerCode} ${lose.name}`, documentsMoved: touched.length, rowsMoved: moved },
  } });
  console.log(`\nDONE: ${moved} rows + ${touched.length} documents moved to ${keep.customerCode}; ${lose.customerCode} deleted`);
  process.exit(0);
})();
