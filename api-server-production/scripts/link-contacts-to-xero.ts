/** Stamp xeroId on AIMS customers/suppliers that cleanly match a Xero contact
 *  by name (1:1 only — duplicates are skipped for a separate merge step). */
import { PrismaClient } from '@prisma/client';
import { getXeroTokens, xeroGet } from './xero-migration/_common';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const norm = (s: string) => (s || '').toLowerCase().replace(/\b(pte|ltd|llp|pl|private|limited|inc|corporation|corp)\b/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
async function main() {
  const t = await getXeroTokens(p, ORG);
  const contacts: any[] = [];
  for (let page = 1; ; page++) { const r = await xeroGet<any>(t, '/Contacts', { page, pageSize: 100, includeArchived: 'true' }); const c = r.Contacts || []; contacts.push(...c); if (c.length < 100) break; }
  const xByNorm = new Map<string, any[]>(); for (const c of contacts) { const k = norm(c.Name); if (!xByNorm.has(k)) xByNorm.set(k, []); xByNorm.get(k)!.push(c); }

  for (const kind of ['customer', 'supplier'] as const) {
    const rows = kind === 'customer'
      ? await p.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, xeroId: true } })
      : await p.supplier.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, xeroId: true } });
    // group AIMS rows by matched ContactID; only stamp when exactly one AIMS row maps to that contact
    const byXid = new Map<string, any[]>();
    for (const r of rows) { const m = xByNorm.get(norm(r.name)); if (m?.length) { const cid = m[0].ContactID; (byXid.get(cid) || byXid.set(cid, []).get(cid)!).push(r); } }
    let stamped = 0, skippedDup = 0;
    for (const [cid, rs] of byXid) {
      if (rs.length > 1) { skippedDup += rs.length; continue; }
      const r = rs[0];
      if (r.xeroId === cid) continue;
      try {
        if (kind === 'customer') await p.customer.update({ where: { id: r.id }, data: { xeroId: cid } });
        else await p.supplier.update({ where: { id: r.id }, data: { xeroId: cid } });
        stamped++;
      } catch (e: any) { console.log(`  ${kind} stamp fail "${r.name}": ${e.message?.slice(0, 80)}`); }
    }
    console.log(`${kind}s: stamped xeroId on ${stamped}  (skipped ${skippedDup} in duplicate groups)`);
  }
}
main().catch(e => console.log('ERR', e.message?.slice(0, 200))).finally(() => p.$disconnect());
