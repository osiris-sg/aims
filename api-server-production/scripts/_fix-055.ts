import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const XT2_FILE = __dirname + "/_xero2-tokens.json";
async function tokens() {
  const t = JSON.parse(fs.readFileSync(XT2_FILE, "utf8"));
  if (t.expiresAt - Date.now() > 5 * 60 * 1000) return { at: t.accessToken, tid: t.tenantId };
  const basic = Buffer.from(`${t.clientId}:${t.clientSecret}`).toString("base64");
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refreshToken }) });
  const n: any = await res.json();
  const upd = { ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 };
  fs.writeFileSync(XT2_FILE, JSON.stringify(upd, null, 2));
  return { at: upd.accessToken, tid: upd.tenantId };
}
(async () => {
  const TK = await tokens();
  // stale Samsung mirror
  const sam = await prisma.document.findFirst({ where: { organizationId: ORG, name: "BI202608055", type: "INVOICE" } });
  const sc: any = sam?.config || {};
  console.log("Samsung mirror:", sam?.id, "xeroInvoiceId:", sc.xeroInvoiceId, "status:", sc.xeroStatus, "synced-pushed?", sc.xeroSyncedBy || "no");
  if (sc.xeroInvoiceId) {
    const r = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${sc.xeroInvoiceId}`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
    const j: any = await r.json().catch(() => ({}));
    const inv = j.Invoices?.[0];
    console.log("in Xero now:", inv ? `${inv.InvoiceNumber} ${inv.Status}` : `HTTP ${r.status} (gone)`);
    if (inv && inv.Status === "DELETED") {
      await prisma.document.delete({ where: { id: sam!.id } });
      console.log("→ deleted stale AIMS mirror (follow-Xero)");
    } else if (inv && inv.InvoiceNumber !== "BI202608055") {
      await prisma.document.update({ where: { id: sam!.id }, data: { name: inv.InvoiceNumber, config: { ...sc, xeroInvoiceNumber: inv.InvoiceNumber, xeroStatus: inv.Status } } });
      console.log(`→ renamed stale mirror to ${inv.InvoiceNumber} (${inv.Status})`);
    } else if (!inv) {
      await prisma.document.delete({ where: { id: sam!.id } });
      console.log("→ deleted stale AIMS mirror (not found in Xero)");
    } else { console.log("→ still BI202608055 in Xero?! not touching"); process.exit(1); }
  }
  // align our 0158 doc with its already-renamed Xero side
  const ours = await prisma.document.findFirst({ where: { organizationId: ORG, name: "BI2026080158" } });
  if (ours) {
    const oc: any = ours.config;
    await prisma.document.update({ where: { id: ours.id }, data: { name: "BI202608055", config: { ...oc, documentNumber: "BI202608055", xeroInvoiceNumber: "BI202608055", renumberedFrom: "BI2026080158" } } });
    console.log("→ BI2026080158 aligned to BI202608055 in AIMS (Xero already renamed)");
  } else console.log("BI2026080158 not found (already fixed?)");
  process.exit(0);
})();
