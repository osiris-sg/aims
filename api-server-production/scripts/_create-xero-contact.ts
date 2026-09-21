// Create a Xero contact for an AIMS customer that has none, and stamp the id back.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const XT2 = __dirname + "/_xero2-tokens.json";
(async () => {
  const t = JSON.parse(fs.readFileSync(XT2, "utf8"));
  let at = t.accessToken;
  if (t.expiresAt - Date.now() < 5 * 60 * 1000) {
    const basic = Buffer.from(`${t.clientId}:${t.clientSecret}`).toString("base64");
    const r = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refreshToken }) });
    const n: any = await r.json(); at = n.access_token;
    fs.writeFileSync(XT2, JSON.stringify({ ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 }, null, 2));
  }
  const H = { Authorization: `Bearer ${at}`, "Xero-Tenant-Id": t.tenantId, Accept: "application/json", "Content-Type": "application/json" };
  const target = { aimsName: "TANGLIN CORPORATION PTE. LTD.", xeroName: "Tanglin Corporation Pte Ltd",
    address: ["217 Upper Bukit Timah Road"], postal: "588185",
    person: { FirstName: "Kek", LastName: "Zhi Kai", EmailAddress: "zhikai_kek@tanglincorp.com" } };
  // guard: does it already exist in Xero?
  const found: any = await fetch(`https://api.xero.com/api.xro/2.0/Contacts?where=${encodeURIComponent('Name.Contains("Tanglin")')}`, { headers: H }).then(r => r.json());
  let id = (found.Contacts || [])[0]?.ContactID;
  if (id) console.log("already in Xero:", (found.Contacts || [])[0].Name, id.slice(0, 8));
  else {
    const body = { Contacts: [{ Name: target.xeroName, EmailAddress: target.person.EmailAddress,
      Addresses: [{ AddressType: "STREET", AddressLine1: target.address[0], City: "Singapore", PostalCode: target.postal, Country: "Singapore" }],
      ContactPersons: [target.person], IsCustomer: true }] };
    const res: any = await fetch("https://api.xero.com/api.xro/2.0/Contacts", { method: "POST", headers: H, body: JSON.stringify(body) }).then(r => r.json());
    const c = (res.Contacts || [])[0];
    if (!c?.ContactID) { console.error("create failed:", JSON.stringify(res).slice(0, 300)); process.exit(1); }
    id = c.ContactID; console.log("✓ created Xero contact:", c.Name, id.slice(0, 8));
  }
  const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { startsWith: "TANGLIN" } }, select: { id: true, name: true } });
  await prisma.customer.update({ where: { id: cust!.id }, data: { xeroId: id } });
  console.log("✓ stamped xeroId onto AIMS customer", cust!.name);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
