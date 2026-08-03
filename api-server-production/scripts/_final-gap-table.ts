import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import * as os from "os";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const canon = (s: string) => s.replace(/ \([0-9a-f]{4}\)$/i, "").trim();
(async () => {
  const cachePath = `${os.homedir()}/.aims-xero-cache/xero-journals-cache-${ORG}.ndjson`;
  // net 443 per SourceID from Xero journals (truth)
  const bySource = new Map<string, number>();
  const typeBySource = new Map<string, string>();
  for (const line of fs.readFileSync(cachePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    for (const l of j.JournalLines || []) {
      if (l.AccountCode !== "443") continue;
      bySource.set(j.SourceID, Math.round(((bySource.get(j.SourceID) || 0) + l.NetAmount) * 100) / 100);
      typeBySource.set(j.SourceID, j.SourceType);
    }
  }
  // map xeroIds -> canonical AIMS names
  const docs = await prod.document.findMany({ where: { organizationId: ORG, type: { in: ["BILL", "INVOICE", "CREDIT_NOTE"] } }, select: { name: true, type: true, config: true } });
  const xid2doc = new Map<string, { name: string; type: string; ref?: string }>();
  for (const d of docs) {
    const c: any = d.config || {};
    for (const k of ["xeroBillId", "xeroInvoiceId", "xeroCreditNoteId"]) if (c[k]) xid2doc.set(c[k], { name: canon(d.name), type: d.type, ref: c.reference });
  }
  // aggregate per "story": invoice name key — invoices/CNs by own name; bills by their ref; MJ by narration target
  const story = new Map<string, number>();
  for (const [sid, net] of bySource) {
    const doc = xid2doc.get(sid);
    let key: string;
    if (!doc) key = "(manual journal 0089)"; 
    else if (doc.type === "BILL") key = canon((doc.ref || "").length ? doc.ref! : "(unref'd bill?)");
    else key = doc.name; // invoice or CN → CNs name their invoice... CN doc names = own number; map via ref later
    story.set(key, Math.round(((story.get(key) || 0) + net) * 100) / 100);
  }
  // fold the 0089 MJ into its invoice story
  const mj = story.get("(manual journal 0089)") || 0;
  if (mj) { story.set("BIPL-JPSG-INV-20260708-0089", Math.round(((story.get("BIPL-JPSG-INV-20260708-0089") || 0) + mj) * 100) / 100); story.delete("(manual journal 0089)"); }
  // fold CN rows (CN names are invoice-numbers of their own; refund CNs target other invoices)
  const cnTargets: Record<string, string> = {
    "BIPL-JPSG-INV-20260515-0002": "BIPL-JPSG-INV-20260505-0002",
    "BIPL-JPSG-INV-20260523-0005": "BIPL-JPSG-INV-20260522-0001",
    "BIPL-JPSG-INV-20260526-0066": "BIPL-JPSG-INV-20260526-0065",
    "BIPL-JPSG-INV-20260721-0152": "BIPL-JPSG-INV-20260715-0092",
  };
  for (const [cn, target] of Object.entries(cnTargets)) {
    const v = story.get(cn);
    if (v !== undefined) { story.set(target, Math.round(((story.get(target) || 0) + v) * 100) / 100); story.delete(cn); }
  }
  let total = 0;
  console.log("FINAL per-invoice net in 443 (credit not offset by booked bills):");
  for (const [k, v] of [...story.entries()].sort((a, b) => a[1] - b[1])) {
    total += v;
    if (Math.abs(v) > 0.005) console.log(`  ${v.toFixed(2).padStart(9)}  ${k}`);
  }
  console.log(`  TOTAL: ${total.toFixed(2)}`);
  await prod.$disconnect();
})();
