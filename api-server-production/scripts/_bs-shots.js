// Round BS screenshots (preview pages, no sign-in): the Answer flow's files step + grouped type list (EN / JA), and
// the per-shipment SUS COA for #25-1 (HTML built read-only by _bs-coa-preview.ts).
const puppeteer = require('puppeteer');
const fs = require('fs');
const OUT = process.argv[2];
const HTML = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: 'new' });
  for (const lang of ['en', 'ja']) {
    const p = await b.newPage();
    await p.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await p.goto(`http://localhost:3311/preview/shipments/answer?lang=${lang}`, { waitUntil: 'networkidle0' });
    const click = async (sel) => { await p.waitForSelector(sel, { timeout: 15000 }); await p.click(sel); await sleep(400); };
    await click('[data-tour="answer-yes"]');
    if (await p.$('[data-tour="answer-existing"]')) await click('[data-tour="answer-existing"]');
    await p.waitForSelector('[data-tour="choose-shipment-row"]', { timeout: 15000 });
    await p.click('[data-tour="choose-shipment-row"]');
    await sleep(300);
    await click('[data-tour="answer-next"]');
    await p.waitForSelector('[data-tour="answer-step-files"]', { timeout: 30000 });
    await p.waitForSelector('[data-tour="answer-file-row"]', { timeout: 60000 });
    await sleep(800);
    // Tick "Don't file" off on the first file so its type list shows (they default to Don't file: already filed).
    const dlg = await p.$('[role="dialog"]');
    await dlg.screenshot({ path: `${OUT}/bs-kato-invoice-card-${lang}.png` });
    const cb = await p.$$('[data-tour="answer-file-row"] input[type="checkbox"]');
    if (cb[1]) { await cb[1].click(); await sleep(400); }
    const sel = await p.$$('[data-tour="answer-file-row"] [role="combobox"], [data-tour="answer-file-row"] [aria-haspopup="listbox"]');
    const last = sel[sel.length - 1];
    if (last) { await last.click(); await sleep(600); }
    await p.screenshot({ path: `${OUT}/bs-type-list-${lang}.png` });
    await p.close();
  }
  if (HTML && fs.existsSync(HTML)) {
    const p = await b.newPage();
    await p.setViewport({ width: 1400, height: 1000 });
    await p.goto(`file://${HTML}`, { waitUntil: 'networkidle0' });
    await p.screenshot({ path: `${OUT}/bs-sus-coa-25-1.png`, fullPage: true });
    await p.close();
  }
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
