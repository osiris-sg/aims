// Compare the bundled-equipment line as it exists in Xero: July (accountant-made)
// vs August (my push) vs the new September draft.
import * as fs from "fs";
const XERO_API = "https://api.xero.com/api.xro/2.0";
const XT2_FILE = __dirname + "/_xero2-tokens.json";
(async () => {
  const t = JSON.parse(fs.readFileSync(XT2_FILE, "utf8"));
  let at = t.accessToken;
  if (t.expiresAt - Date.now() < 5 * 60 * 1000) {
    const basic = Buffer.from(`${t.clientId}:${t.clientSecret}`).toString("base64");
    const r = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refreshToken }) });
    const n: any = await r.json();
    at = n.access_token;
    fs.writeFileSync(XT2_FILE, JSON.stringify({ ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 }, null, 2));
  }
  for (const num of ["BI202607027", "BI202608010", "BI202609001"]) {
    const r: any = await fetch(`${XERO_API}/Invoices?InvoiceNumbers=${num}`, { headers: { Authorization: `Bearer ${at}`, "Xero-Tenant-Id": t.tenantId, Accept: "application/json" } }).then(x => x.json());
    const inv = (r.Invoices || [])[0];
    if (!inv) { console.log(`${num}: not found`); continue; }
    console.log(`\n═══ ${num} [${inv.Status}] $${inv.Total}`);
    for (const l of inv.LineItems || []) {
      const d = String(l.Description || "").split("\n")[0].slice(0, 42);
      console.log(`  qty=${JSON.stringify(l.Quantity)} unit=${JSON.stringify(l.UnitAmount)} amt=${JSON.stringify(l.LineAmount)} acct=${l.AccountCode || "—"} tax=${l.TaxType || "—"} :: ${d}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
