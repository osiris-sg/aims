/**
 * Re-stamp credit notes that AIMS has applied but whose own balance never moved.
 *
 * Until 2026-11-28 `creditNoteMoneyAfterApplied` skipped every IMPORTED note —
 * right while Xero owned the balance, wrong once Xero was retired: a Manual
 * Offset consumed the note, the invoices went to paid, and the note kept its
 * import-time credit, so the customer's statement still showed it (VCE's
 * CN202608005, 10,680.24 — guru 2026-11-28).
 *
 * The rule, identical to the code path: what the note could still give when
 * AIMS took over (xeroRemainingCredit for an imported note, the gross for a
 * native one) MINUS what AIMS Payment rows have applied since.
 *
 *   npx tsx scripts/restamp-applied-credit-notes.ts --env prod
 *   …--apply
 */
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const ENV = (arg('env', 'prod') || 'prod') as Env;
const ORG = arg('org', '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1')!;
const APPLY = args.includes('--apply');
const R2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
loadEnv(ENV);

(async () => {
  const { plat, disconnect } = clientsFor(ENV, 'org_wct');
  const p: any = plat;
  try {
    const notes = await p.document.findMany({
      where: { organizationId: ORG, type: { in: ['CN', 'CREDIT_NOTE'] } },
      select: { id: true, name: true, config: true },
    });
    let drifted = 0;
    for (const d of notes) {
      const c: any = d.config || {};
      if (c.voided) continue;
      const gross = Math.abs(Number(c.totalWithTax ?? c.nettTotal ?? c.xeroGross ?? 0));
      if (!(gross > 0)) continue;
      const rows = await p.payment.findMany({ where: { organizationId: ORG, documentId: d.id }, select: { amount: true } });
      const used = R2(rows.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0));
      if (used <= 0.005) continue; // nothing applied here: the importer's figure stands
      const imported = !!(c.xeroImported || c.erpImport);
      const rem = Number(c.xeroRemainingCredit);
      const openable = imported && Number.isFinite(rem) ? Math.max(0, Math.min(gross, rem)) : gross;
      const owed = R2(Math.max(0, openable - used));
      const paid = R2(Math.max(0, gross - owed));
      const owedNow = Number(c.outstandingBalance);
      if (Number.isFinite(owedNow) && Math.abs(owedNow - owed) < 0.005) continue;
      drifted++;
      console.log(`  ${d.name}: gross ${gross.toFixed(2)} · applied here ${used.toFixed(2)} · owed ${Number.isFinite(owedNow) ? owedNow.toFixed(2) : 'unstamped'} → ${owed.toFixed(2)}`);
      if (!APPLY) continue;
      await p.document.update({
        where: { id: d.id },
        data: { config: { ...c, outstandingBalance: owed, xeroBalance: owed, paidToDate: paid, xeroAmountPaid: paid } },
      });
    }
    console.log(drifted ? `\n  ${APPLY ? 're-stamped' : 'would re-stamp'} ${drifted} credit note(s)` : '\n  nothing drifted');
    if (!APPLY && drifted) console.log('  (dry run — pass --apply)');
  } finally { await disconnect(); }
})();
