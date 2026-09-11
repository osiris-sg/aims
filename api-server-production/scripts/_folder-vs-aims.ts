// Which folder documents have NO matching document in prod AIMS?
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
import * as fs from "fs";
const prisma = createScriptPrisma();
const DIR = "/Users/guru/Downloads/Rental PO and DO";
(async () => {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith(".pdf"));
  const docs = await prisma.document.findMany({ where: { organizationId: ORG }, select: { name: true, type: true } });
  const names = new Set(docs.map(d => d.name!.toUpperCase().replace(/[\s-]/g, "")));
  let missing: Record<string, string[]> = { "2026 DO/RTN": [], "2025 DO/RTN": [], older: [], "PO (customer)": [] };
  for (const f of files) {
    // extract a DO-like number from the filename
    const m = /((?:RTN-?)?DO\s?(?:BI)?20\d{4}-\d{2,4}[A-Z]?)/i.exec(f);
    if (m) {
      const key = m[1].toUpperCase().replace(/[\s-]/g, "").replace("DOBI", "DO");
      // AIMS names like DO202608-009 → normalize same way
      const hit = [...names].some(n => n.includes(key.replace("RTNDO", "RTNDO")) || n.replace("RTN", "") === key.replace("RTNDO", "DO"));
      const found = names.has(key) || [...names].some(n => n === key || n.endsWith(key));
      if (!found && !hit) {
        const yr = /20(2[3-6])\d{2}/.exec(key)?.[1] || "";
        const bucket = yr === "26" ? "2026 DO/RTN" : yr === "25" ? "2025 DO/RTN" : "older";
        missing[bucket].push(f.slice(0, 85));
      }
    } else if (/\bPO\b|PO No|PO S|EC-PO|SP-PO|GC-PO/i.test(f)) {
      missing["PO (customer)"].push(f.slice(0, 85));
    }
  }
  for (const [k, v] of Object.entries(missing)) {
    console.log(`\n── ${k}: ${v.length} not in AIMS`);
    if (k === "2026 DO/RTN") for (const f of v) console.log("   " + f);
    else for (const f of v.slice(0, 3)) console.log("   " + f);
  }
  process.exit(0);
})();
