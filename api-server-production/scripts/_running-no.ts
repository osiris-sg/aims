import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const used = new Set<number>();
  const probes: string[] = [];
  for (let n = 1; n <= 320; n++) probes.push(`BI202608${String(n).padStart(3, "0")}`);
  for (let i = 0; i < probes.length; i += 40) {
    const r: any = await xeroGet(tokens, "/Invoices", { InvoiceNumbers: probes.slice(i, i + 40).join(","), summaryOnly: "true" } as any);
    for (const inv of r.Invoices || []) {
      const m = /^BI202608(\d{3})$/.exec(inv.InvoiceNumber);
      if (m && inv.Status !== "DELETED") used.add(parseInt(m[1], 10));
    }
  }
  const arr = [...used].sort((a, b) => a - b);
  const max = Math.max(...arr);
  const free: number[] = [];
  for (let n = 1; n <= max; n++) if (!used.has(n)) free.push(n);
  console.log(`highest BI202608 number in Xero: ${String(max).padStart(3, "0")}`);
  console.log(`used: ${arr.length} numbers · free gaps below ${max}: ${free.join(",") || "none"}`);
  console.log(`next running number: BI202608${String(max + 1).padStart(3, "0")}`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
