import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  console.log("── customers missing a Xero contact:");
  for (const n of ["BI202609033", "BI202609082", "BI202609083", "BI202609086", "BI202609089"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n }, select: { config: true } });
    const c: any = d!.config;
    const cust = await prisma.customer.findUnique({ where: { id: c.customerId }, select: { id: true, name: true, xeroId: true, address: true, email: true } });
    // is there ANOTHER customer row with the same-ish name that HAS a xeroId?
    const key = (cust?.name || "").split(/\s+/)[0];
    const sibs = await prisma.customer.findMany({ where: { organizationId: ORG, name: { contains: key, mode: "insensitive" } }, select: { name: true, xeroId: true } });
    console.log(`  ${n}: ${cust?.name} → xeroId ${cust?.xeroId ? "yes" : "MISSING"}; same-name rows: ${sibs.map(s => `${s.name.slice(0, 28)}${s.xeroId ? "(has id)" : ""}`).join(" | ")}`);
  }
  console.log("\n── lines missing accountCode:");
  for (const n of ["BI202609066", "BI202609084", "BI202609086", "BI202609087", "BI202609089", "BI202609093"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n }, select: { config: true } });
    const c: any = d!.config;
    for (const it of c.items || []) {
      const amt = Number(it.amount) || 0, up = Number(it.unitPrice) || 0;
      if (amt === 0 && up === 0) continue;
      if (it.accountCode) continue;
      console.log(`  ${n}: $${amt} code=${it.itemCode || "—"} :: ${String(it.description || "").replace(/<[^>]+>/g, " ").split("\n")[0].slice(0, 60)}`);
    }
  }
  console.log("\n── what account does an existing TRANSPORT line use?");
  const invs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { name: true, config: true }, take: 3000 });
  const seen = new Map<string, number>();
  for (const x of invs) for (const it of ((x.config as any)?.items || [])) {
    if (!/transport/i.test(String(it.description || "")) || !it.accountCode) continue;
    seen.set(it.accountCode, (seen.get(it.accountCode) || 0) + 1);
  }
  console.log("  transport accountCodes seen:", [...seen.entries()].map(([k, v]) => `${k}×${v}`).join(", ") || "none");
  process.exit(0);
})();
