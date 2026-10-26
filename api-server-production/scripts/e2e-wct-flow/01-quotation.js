// Stage 1 — office builds the quotation from the services master and sends
// the customer the sign link. Records videos/01-quotation.
const { PORTAL, adminContext, api, state, beat, finish } = require('./lib');

const CUSTOMER_NAME = process.env.WCT_TEST_CUSTOMER || 'Yoshinoya (Suntec City)';

async function ensureCustomer(page) {
  // House convention: POST / = list (search). Fall back to create-by-name.
  let list = await api(page, '/customers', 'POST', { search: CUSTOMER_NAME, page: 1, limit: 10 }).catch(() => null);
  // getCustomers returns { docs, ... }, wrapped by the response interceptor as
  // { success, data: { docs } }.
  const rows = Array.isArray(list) ? list : (list?.data?.docs ?? list?.docs ?? list?.data?.items ?? list?.data ?? list?.items ?? []);
  let c = rows.find((r) => String(r.name || '').toLowerCase() === CUSTOMER_NAME.toLowerCase());
  if (!c) c = await api(page, '/customers/create-by-name', 'POST', { name: CUSTOMER_NAME, address: '3 Temasek Boulevard, #B1-100 Suntec City Mall, Singapore 038983' });
  return c?.data ?? c;
}

async function main() {
  const s = await adminContext('01-quotation');
  const { page } = s;
  try {
    // api() reads the Clerk session token off the page, so the page must be on
    // the portal with Clerk loaded before the first API call.
    await page.goto(`${PORTAL}/portal/sales/quotations`);
    await page.waitForFunction(() => window.Clerk && window.Clerk.session, { timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    const customer = await ensureCustomer(page);
    const code = customer.code || customer.customerCode;
    console.log('customer', customer.id, code, customer.name);

    await page.goto(`${PORTAL}/portal/sales/quotations`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await beat(page);
    await page.locator('[data-tour="page-create-button"]').first().click();
    // Template / numbering picker (if more than one): prefer the WCT one.
    const wctOpt = page.getByRole('button', { name: /WCT/i }).or(page.getByText(/WCT Quotation/i));
    if (await wctOpt.first().isVisible({ timeout: 4000 }).catch(() => false)) await wctOpt.first().click();
    await page.waitForURL(/\/portal\/documents\//, { timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await beat(page);

    // Customer: the code field takes the CODE + Enter (CustomerCodeField).
    const custInput = page.locator('[data-tour="editor-customer"] input').first();
    await custInput.click();
    await custInput.fill(code || CUSTOMER_NAME);
    await custInput.press('Enter');
    await beat(page, 800);

    await page.getByLabel(/Job Location/i).first().fill('Yoshinoya, Suntec City Mall #B1-100').catch(() => {});
    await page.getByLabel(/^Subject/i).first().fill('Kitchen exhaust system chemical degreasing — maintenance agreement').catch(() => {});
    await beat(page, 600);

    // Services master: tick everything the picker shows, add in one go.
    await page.locator('[data-tour="editor-add-service"]').click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Select all visible services').check();
    await beat(page);
    await dlg.locator('[data-tour="service-picker-add-selected"]').click();
    await beat(page, 1500);

    await page.locator('[data-tour="editor-save"]').first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await beat(page, 1500);
    const docUrl = page.url();
    const docId = docUrl.split('/').filter(Boolean).pop().split('?')[0];

    // Preview the WCT paper layout (server-rendered iframe) for the camera.
    const preview = page.locator('[data-tour="editor-preview"]').first();
    if (await preview.isVisible().catch(() => false)) { await preview.click(); await beat(page, 2500); await preview.click(); }

    // Send for signature → copy the public link.
    await page.locator('[data-tour="editor-more-menu"]').click();
    await page.getByRole('menuitem', { name: /Send for signature/i }).click();
    const linkInput = page.getByRole('dialog').locator('input[readonly]').first();
    await linkInput.waitFor({ timeout: 20000 });
    // The field shows "Creating link…" until the token is minted — poll until
    // it holds a real /sign/ URL.
    await page.waitForFunction(
      (el) => el && /\/sign\//.test(el.value || ''),
      await linkInput.elementHandle(),
      { timeout: 30000 },
    );
    const signUrl = await linkInput.inputValue();
    if (!/\/sign\//.test(signUrl)) throw new Error(`unexpected sign link: ${signUrl}`);
    await beat(page, 1500);
    state.save({ customerId: customer.id, quotationId: docId, quotationUrl: docUrl, signUrl });
    console.log('quotation', docId, 'sign link', signUrl);
  } finally {
    await finish(s, '01-quotation');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
