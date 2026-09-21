// app2 is contacts.READ only — use the main app connection to create the contact.
import { createScriptPrisma, getXeroTokens, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tk: any = await getXeroTokens(prisma, ORG);
  const H = { Authorization: `Bearer ${tk.accessToken}`, "Xero-Tenant-Id": tk.tenantId, Accept: "application/json", "Content-Type": "application/json" };
  const body = { Contacts: [{
    Name: "Tanglin Corporation Pte Ltd",
    EmailAddress: "zhikai_kek@tanglincorp.com",
    Addresses: [{ AddressType: "STREET", AddressLine1: "217 Upper Bukit Timah Road", City: "Singapore", PostalCode: "588185", Country: "Singapore" }],
    ContactPersons: [{ FirstName: "Kek", LastName: "Zhi Kai", EmailAddress: "zhikai_kek@tanglincorp.com" }],
    IsCustomer: true,
  }] };
  const res = await fetch("https://api.xero.com/api.xro/2.0/Contacts", { method: "POST", headers: H, body: JSON.stringify(body) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`${res.status}:`, JSON.stringify(json).slice(0, 250)); process.exit(1); }
  const c = (json.Contacts || [])[0];
  console.log("✓ created:", c.Name, c.ContactID.slice(0, 8));
  const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { startsWith: "TANGLIN" } }, select: { id: true, name: true } });
  await prisma.customer.update({ where: { id: cust!.id }, data: { xeroId: c.ContactID } });
  console.log("✓ stamped onto AIMS customer", cust!.name);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message?.slice(0, 200)); process.exit(1); });
