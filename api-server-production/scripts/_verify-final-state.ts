import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DISP = /soil|disposal|tonne|transport/i;
(async () => {
  const docs = await prod.document.findMany({
    where: { organizationId: ORG, name: { startsWith: "BIPL-JPSG-INV" } },
    select: { name: true, type: true, config: true },
  });
  let passDrafts = 0, cnDrafts = 0, authDisposals = 0, unlinked = 0, badDrafts: string[] = [];
  for (const d of docs) {
    const c: any = d.config || {};
    const isDisp = (c.items || []).some((it: any) => DISP.test(it.description || ""));
    const linked = c.xeroInvoiceId || c.xeroCreditNoteId;
    if (!linked) { unlinked++; continue; }
    if (d.type === "CREDIT_NOTE") cnDrafts++;
    else if (c.xeroStatus === "AUTHORISED") authDisposals++;
    else if (isDisp) badDrafts.push(d.name);
    else passDrafts++;
  }
  console.log(`pass-application drafts (ours): ${passDrafts}`);
  console.log(`credit-note drafts (ours): ${cnDrafts}`);
  console.log(`pre-existing AUTHORISED (accountant's): ${authDisposals}`);
  console.log(`disposal still in Xero as OUR draft (should be 0): ${badDrafts.length} ${badDrafts.join(",")}`);
  console.log(`unlinked (removed from Xero / never pushed): ${unlinked}`);
  await prod.$disconnect();
})();
