import { PrismaClient, Prisma } from '@prisma/client';
import { getXeroTokens, xeroGet } from './xero-migration/_common';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const norm = (s: string) => (s || '').toLowerCase().replace(/\b(pte|ltd|llp|pl|private|limited|inc|corporation|corp)\b/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

async function main() {
  const t = await getXeroTokens(p, ORG);
  const contacts: any[] = [];
  for (let page = 1; ; page++) { const r = await xeroGet<any>(t, '/Contacts', { page, pageSize: 100, includeArchived: 'true' }); const c = r.Contacts || []; contacts.push(...c); if (c.length < 100) break; }
  const xByNorm = new Map<string, any[]>(); for (const c of contacts) { const k = norm(c.Name); (xByNorm.get(k) || xByNorm.set(k, []).get(k)!).push(c); }

  const xInvs: any[] = [];
  for (let page = 1; ; page++) { const r = await xeroGet<any>(t, '/Invoices', { page, pageSize: 100, where: 'Type=="ACCREC"' }); const c = r.Invoices || []; xInvs.push(...c); if (c.length < 100) break; }
  console.log(`Xero: ${contacts.length} contacts, ${xInvs.length} ACCREC invoices`);

  const custs = await p.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, xeroId: true } });
  const nameById = new Map(custs.map((c) => [c.id, c.name]));
  // invoice counts per customer (to pick canonical)
  const counts = await p.$queryRawUnsafe<any[]>(`SELECT config->>'customerId' cid, count(*)::int n FROM "Document" WHERE "organizationId"=$1 AND type='INVOICE' AND config->>'customerId' IS NOT NULL GROUP BY 1`, ORG);
  const invCount = new Map(counts.map((r) => [r.cid, r.n]));

  // ContactID -> AIMS customer id (stamp canonical for dup groups)
  const custByXid = new Map<string, string>();
  for (const c of custs) if (c.xeroId) custByXid.set(c.xeroId, c.id);
  const byCid = new Map<string, any[]>();
  for (const c of custs) { const m = xByNorm.get(norm(c.name)); if (m?.length) (byCid.get(m[0].ContactID) || byCid.set(m[0].ContactID, []).get(m[0].ContactID)!).push(c); }
  const nonCanonical: any[] = [];
  for (const [cid, group] of byCid) {
    if (group.length <= 1) { if (group[0]?.xeroId === cid) custByXid.set(cid, group[0].id); continue; }
    const canonical = [...group].sort((a, b) => (invCount.get(b.id) || 0) - (invCount.get(a.id) || 0))[0];
    if (canonical.xeroId !== cid) await p.customer.update({ where: { id: canonical.id }, data: { xeroId: cid } });
    custByXid.set(cid, canonical.id);
    group.filter((g) => g.id !== canonical.id).forEach((g) => nonCanonical.push(g));
  }

  // Re-tag every Xero invoice to its correct AIMS customer.
  const aims = await p.document.findMany({ where: { organizationId: ORG, type: 'INVOICE' }, select: { id: true, name: true, config: true } });
  const aimsByName = new Map(aims.map((d) => [d.name, d]));
  let retag = 0, already = 0, noLink = 0, noDoc = 0;
  for (const xi of xInvs) {
    const cid = xi.Contact?.ContactID; if (!cid) continue;
    const custId = custByXid.get(cid); if (!custId) { noLink++; continue; }
    const doc = aimsByName.get((xi.InvoiceNumber || '').trim()); if (!doc) { noDoc++; continue; }
    const cur = (doc.config as any) || {};
    if (cur.customerId === custId) { already++; continue; }
    await p.document.update({ where: { id: doc.id }, data: { config: { ...cur, customerId: custId, customer: { id: custId, name: nameById.get(custId) || xi.Contact?.Name } } as Prisma.InputJsonValue } });
    retag++;
  }
  console.log(`\nRe-tagged ${retag} invoices (already correct ${already}; Xero contact not linked ${noLink}; not in AIMS ${noDoc})`);

  // Cleanup: delete non-canonical dups + CN/test junk that have NO documents + no FK relations.
  const junk = custs.filter((c) => /^CN[-\d]/i.test(c.name) || /test|happypath|mapping test/i.test(c.name));
  const candidates = [...nonCanonical, ...junk];
  let deleted = 0, kept = 0;
  for (const c of candidates) {
    const docRefs = await p.$queryRawUnsafe<any[]>(`SELECT count(*)::int n FROM "Document" WHERE "organizationId"=$1 AND config->>'customerId'=$2`, ORG, c.id);
    if ((docRefs[0]?.n || 0) > 0) { kept++; console.log(`  keep "${c.name}" (still ${docRefs[0].n} docs)`); continue; }
    try { await p.customer.delete({ where: { id: c.id } }); deleted++; }
    catch (e: any) { kept++; console.log(`  keep "${c.name}" (FK relations: ${e.message?.slice(0, 60)})`); }
  }
  console.log(`\nCleanup: deleted ${deleted} junk/dup customers; kept ${kept} (had docs/relations)`);
  console.log(`Customers now: ${await p.customer.count({ where: { organizationId: ORG } })}`);
}
main().catch((e) => console.log('ERR', e.message?.slice(0, 200))).finally(() => p.$disconnect());
