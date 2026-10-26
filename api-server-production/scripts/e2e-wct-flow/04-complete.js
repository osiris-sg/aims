// Stage 4 — the field tech completes the job through the guest delivery link
// (photo per line, one signature at the end); the invoice is created
// automatically at the quoted amounts. Records videos/04-complete (guest page)
// and videos/05-invoice (office sees the invoice + ledger).
const { PORTAL, adminContext, publicContext, api, publicApi, state, TINY_JPEG, scribble, beat, finish } = require('./lib');

async function main() {
  const st = state.load();
  if (!st.doDocumentId) throw new Error('no doDocumentId in state — run 03-schedule.js first (or set it by hand)');

  // Office mints the guest link for the DO.
  let link;
  {
    const s = await adminContext('04a-guest-link');
    try {
      await s.page.goto(`${PORTAL}/portal/deliveries`); await s.page.waitForLoadState('networkidle').catch(() => {});
      const res = await api(s.page, `/documents/${st.doDocumentId}/delivery-share-link`, 'POST', {});
      const r = res?.data ?? res;
      link = r.url || r.link || (r.token ? `${PORTAL}/guest/delivery/${r.token}` : null);
      if (!link) throw new Error(`no guest link in ${JSON.stringify(r).slice(0, 200)}`);
      console.log('guest link', link);
    } finally { await finish(s, '04a-guest-link'); }
  }
  const token = link.split('/').pop();

  // Field tech on the guest page: photos per line, finalize with a signature.
  {
    const s = await publicContext('04-complete');
    const { page } = s;
    try {
      await page.goto(link, { waitUntil: 'networkidle' });
      await beat(page, 2500);
      const view = await publicApi(page, `/public/delivery/${token}`);
      const v = view?.data ?? view;
      const items = v.items || [];
      for (const it of items) {
        const up = await publicApi(page, `/public/delivery/${token}/photo`, 'POST', undefined, { file: { name: 'proof.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG } });
        const url = up?.url || up?.data?.url || up?.key;
        await publicApi(page, `/public/delivery/${token}/items/${it.id}/deliver`, 'POST', { photos: url ? [url] : [] });
      }
      await page.reload({ waitUntil: 'networkidle' }); await beat(page, 2000);
      // Signature: draw on the page's pad if present, else send one via API.
      const canvas = page.locator('canvas').first();
      let signature;
      if (await canvas.isVisible().catch(() => false)) {
        await scribble(page, canvas);
        signature = await canvas.evaluate((c) => c.toDataURL('image/png'));
      }
      await publicApi(page, `/public/delivery/${token}/finalize`, 'POST', { signature, signedByName: process.env.WCT_SIGNER || 'Tan Mei Ling', installNeeded: false });
      await page.reload({ waitUntil: 'networkidle' }); await beat(page, 2500);
      console.log('run finalized');
    } finally { await finish(s, '04-complete'); }
  }

  // Office: the auto-created invoice and the ledger posting.
  {
    const s = await adminContext('05-invoice');
    const { page } = s;
    try {
      await page.goto(`${PORTAL}/portal/sales/invoices`); await page.waitForLoadState('networkidle').catch(() => {});
      await beat(page, 2000);
      await page.getByRole('row').nth(1).click().catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {}); await beat(page, 3000);
      await page.goto(`${PORTAL}/portal/accounting/ledger`); await page.waitForLoadState('networkidle').catch(() => {}); await beat(page, 3000);
    } finally { await finish(s, '05-invoice'); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
