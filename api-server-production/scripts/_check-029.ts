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
  const r = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=BI202608029,BI202608030,BI202608031&summaryOnly=true`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
  const j: any = await r.json();
  for (const inv of j.Invoices || []) {
    const ms = parseInt(/\/Date\((\d+)/.exec(inv.UpdatedDateUTC)?.[1] || "0", 10);
    console.log(`${inv.InvoiceNumber} [${inv.Status}] $${inv.Total} · ${inv.Contact?.Name?.slice(0, 35)} · updated ${new Date(ms).toISOString().replace("T", " ").slice(0, 16)}Z`);
  }
  process.exit(0);
})();
