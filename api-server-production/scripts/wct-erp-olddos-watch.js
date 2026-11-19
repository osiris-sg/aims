/**
 * Old ERP DOs (WCT, Elroy 19 Nov): picks up the DO prints the ERP tab downloads (scripts/wct-erp-catchup/
 * erp-olddo.browser.js -> ~/Downloads/erp-olddo-<id>.pdf), parses each with wct-erp-dos.js parseDoPdf, appends
 * the header + lines, DELETES the PDF (nothing piles up in Downloads) and saves the CSVs every 100 DOs, so a
 * stopped run resumes where it was. Also moves erp-olddo-list.csv (the list feed) into the folder.
 * Writes <out>/erp-do-list.csv (do_kind rows as the catch-up merge does), erp-do-parsed.csv, erp-do-lines.csv,
 * progress.json. Read-only towards AIMS and the ERP (local files only).
 *   node scripts/wct-erp-olddos-watch.js --out <folder> [--downloads ~/Downloads] [--idle-min 30]
 * Stops after --idle-min minutes with no new file, or when <out>/STOP exists.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseDoPdf, readCsv, writeCsv } = require('./wct-erp-dos');

const argv = process.argv.slice(2);
const one = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const OUT = one('--out');
const DL = one('--downloads', path.join(os.homedir(), 'Downloads'));
const IDLE_MS = Number(one('--idle-min', '30')) * 60e3;
if (!OUT) throw new Error('--out <folder>');
fs.mkdirSync(OUT, { recursive: true });
const PARSED_COLS = ['erp_id', 'do_no', 'pdf_do_no', 'quotation_no', 'pdf_date', 'sold_to', 'sold_to_address', 'attention', 'attention_phone', 'ship_to', 'ship_to_address', 'line_count', 'pages', 'parse_issues'];
const LINE_COLS = ['erp_id', 'do_no', 'line_no', 'description', 'qty', 'remark'];
const LIST_COLS = ['do_kind', 'erp_id', 'do_no', 'date', 'contract_no', 'engagement_id', 'customer', 'term', 'pulled_at'];
const fParsed = path.join(OUT, 'erp-do-parsed.csv');
const fLines = path.join(OUT, 'erp-do-lines.csv');
const fList = path.join(OUT, 'erp-do-list.csv');
const parsed = new Map(fs.existsSync(fParsed) ? readCsv(fParsed).map((r) => [r.erp_id, r]) : []);
const lines = new Map();
if (fs.existsSync(fLines)) for (const l of readCsv(fLines)) lines.set(l.erp_id, [...(lines.get(l.erp_id) || []), l]);
let listBy = new Map(fs.existsSync(fList) ? readCsv(fList).map((r) => [r.erp_id, r]) : []);
let sinceSave = 0, lastNew = Date.now(), started = Date.now(), startCount = parsed.size;

function save() {
  const tmp = (f) => f + '.tmp';
  writeCsv(tmp(fParsed), PARSED_COLS, [...parsed.values()]);
  writeCsv(tmp(fLines), LINE_COLS, [...lines.values()].flat());
  fs.renameSync(tmp(fParsed), fParsed);
  fs.renameSync(tmp(fLines), fLines);
  const done = parsed.size - startCount, secs = (Date.now() - started) / 1000;
  fs.writeFileSync(path.join(OUT, 'progress.json'), JSON.stringify({ at: new Date().toISOString(), parsed: parsed.size, list: listBy.size, thisRun: done, perHour: secs > 0 ? Math.round((done / secs) * 3600) : null }, null, 1));
  sinceSave = 0;
}

async function tick() {
  const files = fs.readdirSync(DL);
  const listFile = files.find((f) => /^erp-olddo-list( \(\d+\))?\.csv$/.test(f));
  if (listFile) {
    const rows = readCsv(path.join(DL, listFile));
    writeCsv(fList, LIST_COLS, rows);
    listBy = new Map(rows.map((r) => [r.erp_id, r]));
    fs.unlinkSync(path.join(DL, listFile));
    console.log(`${new Date().toISOString()} list: ${rows.length} DOs`);
    lastNew = Date.now();
  }
  for (const f of files) {
    const m = /^erp-olddo-(\d+)( \(\d+\))?\.pdf$/.exec(f);
    if (!m) continue;
    const id = m[1];
    const full = path.join(DL, f);
    try {
      const buf = fs.readFileSync(full);
      if (!parsed.has(id)) {
        const d = await parseDoPdf(buf);
        const doNo = listBy.get(id)?.do_no || d.doNo;
        if (listBy.get(id) && d.doNo !== doNo) d.issues.push(`PDF number ${d.doNo} differs from the list ${doNo}`);
        parsed.set(id, { erp_id: id, do_no: doNo, pdf_do_no: d.doNo, quotation_no: d.quotationNo, pdf_date: d.date, sold_to: d.soldTo, sold_to_address: d.soldToAddress.join('\n'), attention: d.attention, attention_phone: d.attentionPhone, ship_to: d.shipTo, ship_to_address: d.shipToAddress.join('\n'), line_count: d.lines.length, pages: d.pages, parse_issues: d.issues.join('; ') });
        lines.set(id, d.lines.map((l) => ({ erp_id: id, do_no: doNo, line_no: l.no, description: l.description, qty: l.qty, remark: l.remark })));
        sinceSave++;
        lastNew = Date.now();
      }
      fs.unlinkSync(full);
    } catch (e) {
      // A file still being written, or a broken PDF: retried next tick; after 3 tries it is recorded as an issue.
      const k = `__err_${id}`;
      global[k] = (global[k] || 0) + 1;
      if (global[k] >= 3) {
        parsed.set(id, { erp_id: id, do_no: listBy.get(id)?.do_no || '', parse_issues: `PDF not readable: ${e.message}` });
        try { fs.unlinkSync(full); } catch {}
        sinceSave++;
      }
    }
    if (sinceSave >= 100) {
      save();
      const p = JSON.parse(fs.readFileSync(path.join(OUT, 'progress.json'), 'utf8'));
      console.log(`${p.at} parsed ${p.parsed} (this run ${p.thisRun}, ${p.perHour}/h)`);
    }
  }
}

(async () => {
  console.log(`${new Date().toISOString()} watching ${DL} -> ${OUT} (already parsed ${parsed.size})`);
  for (;;) {
    await tick();
    if (fs.existsSync(path.join(OUT, 'STOP')) || Date.now() - lastNew > IDLE_MS) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  save();
  console.log(`${new Date().toISOString()} stopped: parsed ${parsed.size}`);
})().catch((e) => {
  try { save(); } catch {}
  console.error('ERR', e.message);
  process.exit(1);
});
