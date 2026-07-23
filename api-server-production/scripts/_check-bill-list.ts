import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const LIST = `JP2604100055 JP2604150047 JP2604150059 JP2604150065 JP2604150119 JP2604150121 JP2604150122 JP2604150125 JP2604160066 JP2604200077 JP2604240090 JP2604250007 JP2604270072 JP2604270078 JP2604270110 JP2604270111 JP2604270115 JP2604270116 JP2604270117 JP2604270118 JP2604270178 JP2604270179 JP2604270180 JP2604270181 JP2604270182 JP2604270184 JP2604290130 JP2604300017 JP2605020017 JP2605020021 JP2605020025 JP2605020026 JP2605020028 JP2605020030 JP2605160024 JP2605160026 JP2606010011 JP2606230023`.split(/\s+/);
(async () => {
  const found = await prod.document.findMany({
    where: { organizationId: ORG, type: "BILL", name: { in: LIST } },
    select: { name: true, status: true, config: true },
  });
  const byName = new Map(found.map(f => [f.name, f]));
  let present = 0;
  const missing: string[] = [];
  for (const n of LIST) {
    const f = byName.get(n);
    if (!f) { missing.push(n); continue; }
    present++;
  }
  console.log(`asked: ${LIST.length} · in AIMS: ${present} · missing: ${missing.length}`);
  if (missing.length) console.log("missing:", missing.join(", "));
  // status/ref/xero summary for the found ones
  const summary = { pushed: 0, ref: new Map<string, number>() };
  for (const f of found) {
    const c: any = f.config || {};
    if (c.xeroBillId) summary.pushed++;
    const r = (c.reference || "").includes("BIPL-JPSG") ? "invoice-ref" : (c.reference || "").match(/\((.+)\)$/)?.[1] || c.reference || "(none)";
    summary.ref.set(r, (summary.ref.get(r) || 0) + 1);
  }
  console.log(`in Xero: ${summary.pushed}/${present}`);
  console.log("reference breakdown:", [...summary.ref.entries()].sort((a, b) => b[1] - a[1]));
  await prod.$disconnect();
})();
