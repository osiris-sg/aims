// Discover Xero BANK accounts + reconciled transaction volumes (main app).
import { getXeroTokens, xeroGet } from "./xero-migration/_common";
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const accts: any = await xeroGet(tokens, "/Accounts", { where: 'Type=="BANK"' });
  console.log(`${(accts.Accounts || []).length} BANK accounts in Xero:`);
  for (const a of accts.Accounts || []) {
    if (/customer deposit/i.test(a.Name)) continue; // deposit ledgers — not real banks
    // count bank transactions (reconciled) newest window
    let count = 0, recon = 0, newest = "", oldest = "";
    for (let page = 1; page <= 30; page++) {
      const r: any = await xeroGet(tokens, "/BankTransactions", { where: `BankAccount.AccountID==Guid("${a.AccountID}")`, page: String(page) });
      const txs = r.BankTransactions || [];
      count += txs.length;
      recon += txs.filter((t: any) => t.IsReconciled).length;
      for (const t of txs) { const d = t.DateString || ""; if (!newest || d > newest) newest = d; if (!oldest || d < oldest) oldest = d; }
      if (txs.length < 100) break;
    }
    console.log(`  ${(a.Code || "—").padEnd(6)} ${a.Name.padEnd(30)} txns=${count} reconciled=${recon} range=${oldest.slice(0,10)}…${newest.slice(0,10)}`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
