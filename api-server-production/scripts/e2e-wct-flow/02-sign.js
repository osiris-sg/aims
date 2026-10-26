// Stage 2 — the CUSTOMER opens the link, signs, accepts. Records videos/02-sign.
const { publicContext, state, scribble, beat, finish } = require('./lib');

async function main() {
  const { signUrl } = state.load();
  if (!signUrl) throw new Error('no signUrl in state — run 01-quotation.js first');
  const s = await publicContext('02-sign');
  const { page } = s;
  try {
    await page.goto(signUrl, { waitUntil: 'networkidle' });
    await beat(page, 2000);
    await page.mouse.wheel(0, 1200); await beat(page, 1500); // scroll the quotation
    await page.getByLabel(/name/i).first().fill(process.env.WCT_SIGNER || 'Tan Mei Ling');
    await scribble(page, page.locator('canvas').first());
    await page.getByRole('checkbox').last().check();
    await beat(page, 800);
    await page.getByRole('button').filter({ hasText: /sign|accept|confirm/i }).last().click();
    await page.getByRole('alert').filter({ hasText: /accepted|signed|thank/i }).first().waitFor({ timeout: 30000 });
    await beat(page, 2500);
    state.save({ signedAt: new Date().toISOString() });
    console.log('customer accepted the quotation');
  } finally {
    await finish(s, '02-sign');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
