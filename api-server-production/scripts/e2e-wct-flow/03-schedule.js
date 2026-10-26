// Stage 3 — the office finds the DRAFT delivery the acceptance created, sets
// the date and schedules it; the Delivery Order is minted with the quotation
// number. Records videos/03-schedule.
const { PORTAL, adminContext, api, state, beat, finish } = require('./lib');

async function main() {
  const st = state.load();
  const s = await adminContext('03-schedule');
  const { page } = s;
  try {
    await page.goto(`${PORTAL}/portal/deliveries`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await beat(page, 1500);
    // The draft row carries a "Draft" chip; its note names the quotation.
    const draftRow = page.getByRole('row').filter({ hasText: /Draft/ }).first();
    await draftRow.waitFor({ timeout: 30000 });
    await draftRow.click();
    await page.waitForURL(/\/portal\/deliveries\/[^/]+$/);
    await page.waitForLoadState('networkidle').catch(() => {});
    const runId = page.url().split('/').pop();
    await beat(page, 1500);

    await page.getByRole('button', { name: /^Edit$/ }).click();
    const dlg = page.getByRole('dialog');
    await dlg.waitFor();
    // Date: tomorrow. MUI x-date-pickers DatePicker (dayjs adapter, MM/DD/YYYY
    // segmented field) — focus and type the digits; the segments auto-advance.
    // fill() does not work on the segmented input, which left Save disabled.
    const d = new Date(Date.now() + 86400000);
    const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear();
    const dateField = dlg.getByRole('textbox', { name: /Date/i }).first();
    await dateField.click();
    await dateField.pressSequentially(`${mm}${dd}${yyyy}`, { delay: 70 });
    // Time is a native type="time" field (defaults to 09:00).
    const timeField = dlg.locator('input[type="time"]').first();
    if (await timeField.isVisible().catch(() => false)) await timeField.fill('09:00').catch(() => {});
    await beat(page, 800);
    const submitBtn = dlg.getByRole('button', { name: /^(Schedule|Save changes)$/ });
    await submitBtn.waitFor();
    // Surface a still-disabled submit (missing rows / date) instead of timing out.
    if (await submitBtn.isDisabled().catch(() => false)) {
      const rowCount = await dlg.locator('input[type="time"]').count();
      throw new Error(`Schedule button disabled — date or rows missing (time fields: ${rowCount}). Check the draft carried the quotation service lines.`);
    }
    await submitBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await beat(page, 2000);

    // The run now carries its DO; read it back via the API for stage 4.
    const run = await api(page, `/deliveries/${runId}`);
    const r = run?.data ?? run;
    const doId = r?.documentId || r?.items?.find((i) => i.documentId)?.documentId || r?.document?.id;
    state.save({ runId, doDocumentId: doId || null });
    console.log('scheduled run', runId, 'DO document', doId);

    if (doId) { await page.goto(`${PORTAL}/portal/documents/DELIVERY_ORDER/-/${doId}`).catch(() => {}); await beat(page, 2500); }
  } finally {
    await finish(s, '03-schedule');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
