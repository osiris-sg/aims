// For each LION unit invoiced in Aug (Xero truth): is it tagged in AIMS
// inventory (sku = serial) and is its status 'rental'?
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
import * as fs from "fs";
const prisma = createScriptPrisma();
(async () => {
  const rows = JSON.parse(fs.readFileSync("scripts/_lion-units.json", "utf8"));
  const bySerial = new Map<string, any>();
  for (const r of rows) if (!bySerial.has(r.serial)) bySerial.set(r.serial, r);
  const inv = await prisma.inventory.findMany({ where: { asset: { organizationId: ORG } }, select: { sku: true, serialNumber: true, status: true, location: true, asset: { select: { name: true } } } } as any);
  const bySku = new Map<string, any>();
  for (const i of inv as any[]) {
    for (const key of [i.sku, i.serialNumber]) if (key) bySku.set(String(key).toUpperCase().replace(/\s+/g, ""), i);
  }
  let ok = 0; const wrong: any[] = []; const missing: any[] = [];
  for (const [serial, r] of bySerial) {
    const unit = bySku.get(serial.replace(/\s+/g, ""));
    if (!unit) { missing.push({ serial, ...r }); continue; }
    if (String(unit.status).toLowerCase() === "rental") ok++;
    else wrong.push({ serial, cust: r.customer, status: unit.status, asset: unit.asset?.name, loc: unit.location });
  }
  console.log(`46 units: ${ok} tagged & status=rental ✓ · ${wrong.length} tagged but WRONG status · ${missing.length} NOT tagged in AIMS`);
  if (wrong.length) { console.log("\nWRONG STATUS (on rent per Xero, but AIMS says):"); for (const w of wrong) console.log(`  ${w.serial} [${w.status}] asset=${w.asset} loc=${w.loc || "—"} · rented to ${w.cust.slice(0, 35)}`); }
  if (missing.length) { console.log("\nNOT TAGGED in AIMS inventory:"); for (const m of missing) console.log(`  ${m.serial} (${m.model}) · ${m.customer.slice(0, 35)} · ${m.invoice}`); }
  process.exit(0);
})();
