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
      // dev has no PORTAL_URL configured, so the API hands back a relative path.
      if (link && link.startsWith('/')) link = `${PORTAL}${link}`;
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
      // Items are under `deliveryItems`; each free-typed service line needs
      // `minPhotos` condition photos before it can be delivered, and the photo
      // upload returns { Key }.
      const items = v.deliveryItems || v.items || [];
      // Exact states only — a loose /delivered/ also matches "not_delivered".
      const DELIVERED = /^(not_installed|installed|completed)$/i;
      for (const it of items) {
        if (DELIVERED.test(String(it.deliveryStatus || it.status || ''))) continue;
        try {
          const need = Math.max(1, Number(it.minPhotos) || 1);
          const keys = [];
          for (let k = 0; k < need; k++) {
            const up = await publicApi(page, `/public/delivery/${token}/photo`, 'POST', undefined, { file: { name: `proof${k + 1}.jpg`, mimeType: 'image/jpeg', buffer: TINY_JPEG } });
            const u = up?.data ?? up;
            const key = u?.Key || u?.key || u?.url;
            if (key) keys.push(key);
          }
          await publicApi(page, `/public/delivery/${token}/items/${it.id}/deliver`, 'POST', { photos: keys });
          await beat(page, 600); // throttle: the public surface is rate-limited
        } catch (e) {
          console.log(`  item ${it.id} deliver skipped: ${e.message.slice(0, 120)}`);
        }
      }
      await page.reload({ waitUntil: 'networkidle' }); await beat(page, 2000);
      // Signature: draw on the page's pad if present, else send one via API.
      const canvas = page.locator('canvas').first();
      let signature;
      if (await canvas.isVisible().catch(() => false)) {
        await scribble(page, canvas);
        signature = await canvas.evaluate((c) => c.toDataURL('image/png'));
      }
      // finalize requires a non-empty signature; the guest page may not expose a
      // drawable canvas, so fall back to a valid 1×1 PNG data URL.
      const FALLBACK_SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      if (!signature || signature.length < 100) signature = FALLBACK_SIG;
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
