/**
 * Old ERP DOs in bulk (WCT, Elroy 19 Nov: every DO Oct 2017 - Oct 2026). Runs INSIDE a logged-in
 * wct.iserviceshub.com tab; GET requests only, never reads cookies, never posts.
 *   __erpOldDoList({ from: '2017-01-01', to: '2026-10-31' })  -> downloads erp-olddo-list.csv (one row per DO)
 *   __erpOldDoPdfs({ ids: [...], delayMs: 300 })               -> downloads erp-olddo-<id>.pdf, one per DO
 * The PDFs are picked up, parsed and deleted by scripts/wct-erp-olddos-watch.js; a stopped run is resumed by
 * calling __erpOldDoPdfs again with the ids still missing. Progress: window.__erpOldDoState.
 */
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (v) => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const get = async (qs, kind) => {
    for (let t = 0; t < 4; t++) {
      try {
        const r = await fetch(location.origin + '/?' + qs, { credentials: 'same-origin', cache: 'no-store' });
        if (r.ok) {
          if (kind === 'blob') { const b = await r.blob(); if (!/pdf/i.test(b.type)) throw new Error('session expired (not a PDF)'); return b; }
          const s = await r.text(); if (/type=["']?password/i.test(s) && s.length < 20000) throw new Error('session expired'); return s;
        }
      } catch (e) { if (/session/.test(e.message)) throw e; }
      await sleep(3000 * (t + 1));
    }
    throw new Error('fetch failed: ' + qs.replace(/&.*/, ''));
  };
  const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  const dmy = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s).trim(); };
  const LB = (f, t) => `m=engagements&a=list_do&do_no=&date_from=${f}&date_to=${t}&contract_id=&customer_id=&suppressHeaders=true&sEcho=1`;

  window.__erpOldDoList = async ({ from, to, delayMs = 300 }) => {
    const S = (window.__erpOldDoState = { phase: 'list', rows: 0, done: false, t0: Date.now(), errors: [] });
    const out = [];
    for (let start = 0; ; start += 500) {
      const j = JSON.parse(await get(LB(from, to) + '&iDisplayStart=' + start + '&iDisplayLength=500'));
      out.push(...j.aaData);
      S.rows = out.length; S.total = Number(j.iTotalRecords);
      if (out.length >= S.total || !j.aaData.length) break;
      await sleep(delayMs);
    }
    const rows = out.map((r) => ['do', String(r.DT_RowId ?? r[5] ?? ''), strip(r[0]), dmy(strip(r[1])), strip(r[2]), (String(r[2]).match(/engagement_id=(\d+)/) || [])[1] || '', strip(r[3]), strip(r[4]), new Date().toISOString()]);
    dl(new Blob(['﻿' + [['do_kind', 'erp_id', 'do_no', 'date', 'contract_no', 'engagement_id', 'customer', 'term', 'pulled_at'], ...rows].map((r) => r.map(q).join(',')).join('\n') + '\n'], { type: 'text/csv' }), 'erp-olddo-list.csv');
    S.done = true; S.secs = Math.round((Date.now() - S.t0) / 1000);
    return S;
  };

  window.__erpOldDoPdfs = async ({ ids, delayMs = 300 }) => {
    const S = (window.__erpOldDoState = { phase: 'pdfs', total: ids.length, pdfs: 0, done: false, stopped: false, t0: Date.now(), errors: [] });
    for (const id of ids) {
      if (window.__erpOldDoStop) { S.stopped = true; break; }
      try {
        dl(await get(`m=DO&a=vw_form_add_do&c=_do_print_PDF&suppressHeaders=true&do_id=${id}`, 'blob'), `erp-olddo-${id}.pdf`);
        S.pdfs++; S.last = id;
      } catch (e) {
        S.errors.push(id + ': ' + e.message);
        if (/session/.test(e.message)) { S.stopped = true; break; }
      }
      await sleep(delayMs);
    }
    S.done = true; S.secs = Math.round((Date.now() - S.t0) / 1000);
    return S;
  };
  return 'old DO puller loaded';
})();
