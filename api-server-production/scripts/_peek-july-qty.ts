// How does the July Xero invoice carry qty on zero-amount equipment lines vs ref lines?
import * as fs from "fs";
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
  for (const num of ["BI202607098"]) {
    const r = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=${num}`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
    const j: any = await r.json();
    const inv = j.Invoices?.[0];
    console.log(`\n═══ ${num} [${inv?.Status}]`);
    for (const l of inv?.LineItems || []) console.log(`  qty=${JSON.stringify(l.Quantity)} unit=${JSON.stringify(l.UnitAmount)} amt=${JSON.stringify(l.LineAmount)} :: ${(l.Description || "").replace(/\n/g, " ¶ ").slice(0, 75)}`);
    await new Promise(r2 => setTimeout(r2, 1100));
  }
  process.exit(0);
})();
