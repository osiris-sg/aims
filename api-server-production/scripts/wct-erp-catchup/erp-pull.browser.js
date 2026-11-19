/**
 * WCT old-ERP catch-up puller (read-only). Runs INSIDE a logged-in wct.iserviceshub.com tab
 * (paste into DevTools, or run through the browser extension). GET requests only; it never
 * reads cookies or tokens and never posts. Downloads part CSVs to ~/Downloads:
 *   erp-catchup-part-01.csv  quotation list (every quotation: id, number, customer, site, subject, date, total, status)
 *   erp-catchup-part-02.csv  invoice list (same for invoices)
 *   erp-catchup-part-03.csv  credit-note list
 *   erp-catchup-part-NN.csv  details (header columns = the original export's wct-quotes-full /
 *                            wct-invoices-full, plus kind/amount_paid) and lines (wct-*-lines columns)
 *   erp-catchup-do-<id>.pdf  with doFrom: every DO dated doFrom..today (Contracts > Delivery Order) as
 *                            the ERP's own print, plus a do_kind part (see __erpDoPull below)
 * Details are fetched only for quotations / invoices with an ERP id above the given thresholds
 * (the highest ERP ids already imported) and for invoices whose list status is Partial.
 *   __erpCatchup({ lastQuoteId, lastInvoiceId, extraQuoteIds: [], extraInvoiceIds: [] })
 *   (node scripts/wct-erp-catchup.js --env prod --print-pull prints the exact call)
 * Progress: window.__erpCatchupState. Then: node scripts/wct-erp-catchup.js --env prod
 */
window.__erpCatchup = async ({ lastQuoteId, lastInvoiceId, extraQuoteIds = [], extraInvoiceIds = [], openQuoteNos = [], cnSince = '', importedQuoteRanges = '', importedInvoiceRanges = '', listsOnly = false, delayMs = 400, detailsPerPart = 40, doFrom = '', doCountFrom = '', doSkipIds = [] }) => {
  const S = (window.__erpCatchupState = { phase: 'lists', parts: 0, details: 0, detailTotal: 0, errors: [], done: false, t0: Date.now() });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (v) => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const save = (rows) => {
    S.parts++;
    const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\n') + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'erp-catchup-part-' + String(S.parts).padStart(2, '0') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const get = async (qs) => {
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(location.origin + '/?' + qs, { credentials: 'same-origin', cache: 'no-store' });
        if (r.ok) { const s = await r.text(); if (/type=["']?password/i.test(s) && s.length < 20000) throw new Error('session expired'); return s; }
      } catch (e) { if (/session/.test(e.message)) throw e; }
      await sleep(3000);
    }
    throw new Error('fetch failed: ' + qs.replace(/&.*/, ''));
  };
  const strip = (h) => String(h ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').trim();
  const money = (s) => String(s ?? '').replace(/[$,\s]/g, '');
  const dmy = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s).trim(); };
  const pageAll = async (base, total) => {
    const out = [];
    for (let start = 0; start < total; start += 500) {
      const j = JSON.parse(await get(base + '&sEcho=1&iDisplayStart=' + start + '&iDisplayLength=500'));
      out.push(...j.aaData);
      await sleep(delayMs);
    }
    return out;
  };
  const count = async (base) => Number(JSON.parse(await get(base + '&sEcho=1&iDisplayStart=0&iDisplayLength=1')).iTotalRecords);

  // ── 1. lists ──
  // Lists are slow on the ERP side (20-40 s per 500 rows), so only what the catch-up needs is listed:
  // invoices by status (Outstanding / Cancelled / Draft / Postponed) and the newest pages of each list.
  const QB = (st) => 'm=sales&a=server_processing_quotation&quotation_no=&status_id=' + st + '&department_id=25&suppressHeaders=true';
  const IB = (st) => 'm=sales&a=server_processing_invoice&invoice_no=&status_id=' + st + '&contract_no=&suppressHeaders=true';
  const CB = 'm=sales&a=_ajax_creditNote&suppressHeaders=true&status=&credit_date_from_voucher=2010-01-01&credit_date_to_voucher=2035-12-31';
  const tail = async (base, fromId) => {
    // The lists are in ERP id order (oldest first); read 500-row pages from the end until ids drop to fromId.
    const total = await count(base); const out = [];
    for (let start = Math.max(0, total - 500); ; start = Math.max(0, start - 500)) {
      const j = JSON.parse(await get(base + '&sEcho=1&iDisplayStart=' + start + '&iDisplayLength=500'));
      out.push(...j.aaData);
      if (!start || j.aaData.some((r) => Number(r.DT_RowId) <= fromId)) break;
      await sleep(delayMs);
    }
    return out;
  };
  const qRow = (r, list) => {
    const site = /<div style="font-size:0.9em[^>]*>([\s\S]*?)<\/div>/.exec(r[2]);
    return { list, erp_id: r.DT_RowId, erp_revision_id: (r[1].match(/quotation_revision_id=(\d+)/) || [])[1] || '', no: strip(r[1]).replace(/^\[\+\]\s*/, ''), customer: strip(/client_quotation[^>]*>([\s\S]*?)<\/div>/.exec(r[2])?.[1] ?? r[2]), client_site: site ? strip(site[1]) : '', subject: strip(r[3]), date: dmy(strip(r[4])), total: money(strip(r[5])), status: strip(r[6]) };
  };
  const iRow = (r, list) => {
    const cust = String(r[2]).split(/<br\s*\/?>|\n/);
    return { list, erp_id: r.DT_RowId, erp_revision_id: (r[1].match(/invoice_revision_id=(\d+)/) || [])[1] || '', no: strip(String(r[1]).replace(/<!--[\s\S]*?-->/g, '')).replace(/^\[\+\]\s*/, '').replace(/View payment.*$/, '').trim(), customer: strip(cust[0]), client_site: strip(cust.slice(1).join(' ')), subject: strip(r[4]), date: dmy(strip(r[6])), total: money(strip(r[7])), status: strip(r[8]) };
  };
  const quotes = [];
  for (const r of await tail(QB(5), lastQuoteId)) quotes.push(qRow(r, 'quotation:new'));
  for (const st of [2, 4]) for (const r of await pageAll(QB(st), await count(QB(st)))) quotes.push(qRow(r, 'quotation:status' + st));
  // Quotations still open (Sent) in AIMS: looked up by number on the list page (any status).
  for (const no of openQuoteNos) { const j = JSON.parse(await get(QB(5).replace('quotation_no=', 'quotation_no=' + encodeURIComponent(no)) + '&sEcho=1&iDisplayStart=0&iDisplayLength=50')); for (const r of j.aaData) quotes.push(qRow(r, 'quotation:search')); await sleep(delayMs); }
  save([['list', 'erp_id', 'erp_revision_id', 'quotation_no', 'customer', 'client_site', 'subject', 'date', 'total', 'status'], ...quotes.map((x) => [x.list, x.erp_id, x.erp_revision_id, x.no, x.customer, x.client_site, x.subject, x.date, x.total, x.status])]);
  const invoices = [];
  for (const r of await tail(IB(''), lastInvoiceId)) invoices.push(iRow(r, 'invoice:new'));
  for (const st of [4, 6, 5, 7]) for (const r of await pageAll(IB(st), await count(IB(st)))) invoices.push(iRow(r, 'invoice:status' + st));
  save([['list', 'erp_id', 'erp_revision_id', 'invoice_no', 'customer', 'client_site', 'subject', 'date', 'total', 'status'], ...invoices.map((x) => [x.list, x.erp_id, x.erp_revision_id, x.no, x.customer, x.client_site, x.subject, x.date, x.total, x.status])]);
  const cns = await pageAll(CB, await count(CB));
  save([['list', 'erp_id', 'credit_note_no', 'customer', 'date', 'invoice_no', 'invoice_status', 'total', 'refund_receipt', 'status'], ...cns.map((r) => { const tot = strip(r[6]).split(/\s+/); return ['credit_note', r.DT_RowId, strip(r[1]), strip(r[2]), dmy(strip(r[3])), strip(r[4]), strip(r[5]), money(tot[0]), tot.slice(1).join(' '), strip(r[7])]; })]);

  // ── 2. details ──
  if (listsOnly) { S.done = true; return S; }
  // ERP ids already in AIMS ("a-b,c" ranges): any in-scope document in the recent window that AIMS does not
  // have yet is fetched too (e.g. a quotation that was Draft at the last run and is Accepted now).
  const inRanges = (spec) => { const rs = String(spec || '').split(',').filter(Boolean).map((x) => x.split('-').map(Number)); return (id) => rs.some(([a, b]) => id >= a && id <= (b ?? a)); };
  const qHave = inRanges(importedQuoteRanges), iHave = inRanges(importedInvoiceRanges);
  const Q_SCOPE = ['Accepted', 'Declined', 'Sent'], I_SCOPE = ['Paid', 'Overdue', 'Receivable', 'Partial'];
  // Open invoices that got a credit note on or after cnSince: their Amount Due is read too.
  const cnInvoices = new Set(cns.filter((r) => cnSince && dmy(strip(r[3])) >= cnSince).map((r) => strip(r[4])));
  const want = [
    ...[...new Map(quotes.filter((x) => (Q_SCOPE.includes(x.status) && !qHave(Number(x.erp_id)) && (Number(x.erp_id) > lastQuoteId || (importedQuoteRanges && x.list === 'quotation:new'))) || extraQuoteIds.includes(Number(x.erp_id))).map((x) => [x.erp_id, x])).values()].map((x) => ({ kind: 'quotation', ...x })),
    ...[...new Map(invoices.filter((x) => (I_SCOPE.includes(x.status) && !iHave(Number(x.erp_id)) && (Number(x.erp_id) > lastInvoiceId || (importedInvoiceRanges && x.list === 'invoice:new'))) || x.status === 'Partial' || (cnInvoices.has(x.no) && x.list !== 'invoice:new') || extraInvoiceIds.includes(Number(x.erp_id))).map((x) => [x.erp_id, x])).values()].map((x) => ({ kind: 'invoice', ...x })),
  ];
  S.phase = 'details'; S.detailTotal = want.length;
  const QH = ['kind', 'erp_id', 'erp_revision_id', 'quotation_no', 'revision', 'date', 'status', 'department', 'reference_no', 'customer', 'client_site', 'billing_address', 'job_location', 'attention', 'attention_title', 'attention_mobile', 'attention_email', 'attention_tel', 'contract_no', 'service_order', 'sales_person', 'sales_email', 'sales_phone', 'coordinator', 'subject', 'sub_heading', 'subtotal', 'discount', 'gst_rate', 'gst_amount', 'total', 'list_total', 'line_count', 'notes', 'terms', 'erp_quotation_no', 'erp_quotation_id', 'amount_paid', 'balance_due'];
  const IH = ['kind', 'erp_id', 'erp_revision_id', 'invoice_no', 'revision', 'date', 'status', 'payment_term', 'department', 'reference_no', 'po_number', 'our_do_no', 'your_ref', 'customer', 'client_site', 'billing_address', 'job_location', 'attention', 'attention_title', 'attention_mobile', 'attention_email', 'attention_tel', 'contract_no', 'service_order', 'sales_person', 'sales_email', 'sales_phone', 'coordinator', 'subject', 'sub_heading', 'subtotal', 'discount', 'gst_rate', 'gst_amount', 'total', 'balance_due', 'credit_note', 'line_count', 'notes', 'terms', 'erp_quotation_no', 'erp_quotation_id', 'amount_paid'];
  const LH = ['kind', 'erp_id', 'doc_no', 'line_no', 'description', 'qty', 'unit_price', 'discount', 'amount'];
  let det = [], lines = [];
  const DH = ['detail_kind', ...IH.slice(1), ...QH.filter((h) => !IH.includes(h))];
  for (const w of want) {
    try {
      const isQ = w.kind === 'quotation';
      const h = await get(isQ
        ? `m=sales&a=vw_quotation&c=view_quotation_detail&suppressHeaders=true&quotation_id=${w.erp_id}&quotation_revision_id=${w.erp_revision_id}`
        : `m=sales&a=vw_invoice&c=view_invoice_detail&suppressHeaders=true&invoice_id=${w.erp_id}&invoice_revision_id=${w.erp_revision_id}`);
      const d = new DOMParser().parseFromString(h.replace(/<script[\s\S]*?<\/script>/gi, ''), 'text/html');
      const val = (id) => { const e = d.getElementById(id) || d.querySelector(`[name="${id}"]`); if (!e) return ''; if (e.tagName === 'SELECT') { const o = e.selectedOptions[0]; return o && !/^-+\s*select/i.test(o.text.trim()) ? o.text.trim() : ''; } return String(e.value ?? '').trim(); };
      const attnEl = d.querySelector(isQ ? '[id^=attention_id]' : '[id^=inv_attention_id_]');
      const attnRaw = attnEl ? (attnEl.tagName === 'SELECT' ? attnEl.selectedOptions[0]?.text : attnEl.value) || '' : '';
      const [attnName, ...attnRest] = attnRaw.split(' - ');
      const txt = d.body.innerText.replace(/\s+/g, ' ');
      const after = (k) => { const m = new RegExp(k + '\\s*:?\\s*\\$\\s*([\\d,.-]+)').exec(txt); return m ? money(m[1]) : ''; };
      const qm = /Quotation No:\s*(?:<a[^>]*quotation=(\d+)[^>]*>([^<]*)<\/a>|([^<]*)<)/.exec(h);
      // lines
      const tbl = [...d.querySelectorAll('table')].filter((t) => t.rows.length && /Unit Price/.test(t.rows[0].textContent) && /Amount/.test(t.rows[0].textContent)).sort((a, b) => b.rows.length - a.rows.length)[0] || null;
      const L = [];
      if (tbl) for (const tr of tbl.rows) {
        const c = [...tr.cells];
        if (c.length < 7 || !/^\d+$/.test(c[1].innerText.trim())) continue;
        const desc = (c[2].querySelector('textarea')?.value ?? c[2].innerText).replace(/\r/g, '').trim();
        L.push([w.kind, w.erp_id, w.no, c[1].innerText.trim(), desc, money(c[3].innerText), money(c[4].innerText), c[5].innerText.trim(), money(c[6].innerText)]);
      }
      const subtotal = L.reduce((s, l) => s + (Number(l[8]) || 0), 0);
      const discount = money(val(isQ ? 'quotation_revision_discount' : 'invoice_revision_discount')) || '0.00';
      const rate = val(isQ ? 'quotation_revision_tax' : 'invoice_revision_tax');
      const gstAmt = money(val(isQ ? 'quo_revision_tax' : 'inv_revision_tax'));
      const row = {
        erp_id: w.erp_id, erp_revision_id: w.erp_revision_id, invoice_no: isQ ? '' : val('invoice_no') || w.no, quotation_no: isQ ? val('quotation_no') || w.no : '',
        revision: isQ ? val('quotation_revision') : val('invoice_revision'), date: val(isQ ? 'quotation_date' : 'invoice_date') || w.date, status: w.status,
        payment_term: isQ ? '' : val('term'), department: val('department'), reference_no: val('reference_no'), po_number: val('po_number'), our_do_no: val('our_delivery_order_no'), your_ref: val('invoice_your_ref'),
        customer: val(isQ ? 'customer_id' : 'inv_customer_id') || w.customer, client_site: w.client_site, billing_address: val(isQ ? 'address_id' : 'inv_address_id'), job_location: val(isQ ? 'job_location_id' : 'inv_job_location_id'),
        attention: (attnName || '').trim(), attention_title: val('contacts_title_id'), attention_mobile: attnRest.join(' - ').trim(), attention_email: '', attention_tel: '',
        contract_no: val('select_contract_no'), service_order: val(isQ ? 'service_order' : 'invoice_serviceoder') || val(isQ ? 'quotation_serviceoder' : ''),
        sales_person: val(isQ ? 'quotation_sale_person' : 'invoice_sale_person'), sales_email: val(isQ ? 'quotation_sale_person_email' : 'invoice_sale_person_email'), sales_phone: val(isQ ? 'quotation_sale_person_phone' : 'invoice_sale_person_phone'),
        coordinator: val(isQ ? 'contact_coordinator_id' : 'contact_coordinator_id_'), subject: val(isQ ? 'quotation_subject' : 'invoice_subject') || w.subject, sub_heading: val('sub_heading'),
        subtotal: subtotal.toFixed(2), discount, gst_rate: rate, gst_amount: gstAmt, total: w.total, list_total: w.total, balance_due: isQ ? '' : after('Amount Due'), amount_paid: isQ ? '' : after('Amount Paid'),
        credit_note: '', line_count: String(L.length), notes: val(isQ ? 'quotation_revision_notes' : 'invoice_revision_notes'), terms: val(isQ ? 'quotation_revision_term_condition_contents' : 'invoice_revision_term_condition'),
        erp_quotation_no: isQ ? '' : qm ? (qm[2] || qm[3] || '').trim() : '', erp_quotation_id: isQ ? '' : qm ? qm[1] || '' : '',
      };
      det.push([w.kind, ...DH.slice(1).map((k) => row[k] ?? '')]);
      lines.push(...L);
    } catch (e) {
      S.errors.push(w.kind + ' ' + w.no + ': ' + e.message);
      if (/session/.test(e.message)) break;
    }
    S.details++;
    if (det.length >= detailsPerPart) flush2();
    await sleep(delayMs);
  }
  function flush2() { if (det.length) { save([DH, ...det]); save([LH, ...lines]); det = []; lines = []; } }
  flush2();
  // ── 3. delivery orders (2026-11-19): Contracts > Delivery Order ──
  if (doFrom) { S.phase = 'dos'; S.dos = await window.__erpDoPull({ from: doFrom, countFrom: doCountFrom, delayMs, partNo: () => ++S.parts, skipIds: doSkipIds }); }
  S.done = true; S.secs = Math.round((Date.now() - S.t0) / 1000);
  return S;
};

/**
 * Delivery orders (2026-11-19). The ERP keeps DOs under Contracts > "Delivery Order" (m=engagements,
 * list a=list_do, DataTables JSON, filtered by DO date). A DO's detail form is POST-only, so the DO
 * itself is read from its print (GET m=DO&a=vw_form_add_do&c=_do_print_PDF&do_id=<id>, a ~1 MB PDF:
 * header, Sold To / Ship To, attention, quotation number, lines S/No / description / qty / remark).
 * The ERP has no DO status and no signed copy / attachment. Downloads to ~/Downloads:
 *   erp-catchup-part-NN.csv       do_kind=do (one row per DO dated from..today) and do_kind=do_month
 *                                 (DO count per month from countFrom to the month before `from`)
 *   erp-catchup-do-<id>.pdf       the ERP's DO print, one per DO (parsed by wct-erp-catchup.js)
 *   __erpDoPull({ from: '2026-11-01', countFrom: '2017-10', skipIds: [] })   skipIds: DOs already in AIMS (no print)
 */
window.__erpDoPull = async ({ from, to = '', countFrom = '', delayMs = 400, partNo = null, pdfs = true, skipIds = [] }) => {
  const S = (window.__erpDoPullState = { phase: 'list', dos: 0, pdfs: 0, errors: [], done: false, t0: Date.now() });
  let localPart = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (v) => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const save = (rows) => dl(new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\n') + '\n'], { type: 'text/csv' }), 'erp-catchup-part-' + String(partNo ? partNo() : 90 + ++localPart).padStart(2, '0') + '.csv');
  const get = async (qs, kind = 'text') => {
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(location.origin + '/?' + qs, { credentials: 'same-origin', cache: 'no-store' });
        if (r.ok) {
          if (kind === 'blob') { const b = await r.blob(); if (!/pdf/i.test(b.type)) throw new Error('session expired (not a PDF)'); return b; }
          const s = await r.text(); if (/type=["']?password/i.test(s) && s.length < 20000) throw new Error('session expired'); return s;
        }
      } catch (e) { if (/session/.test(e.message)) throw e; }
      await sleep(3000);
    }
    throw new Error('fetch failed: ' + qs.replace(/&.*/, ''));
  };
  const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  const dmy = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s).trim(); };
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const LB = (f, t) => `m=engagements&a=list_do&do_no=&date_from=${f}&date_to=${t}&contract_id=&customer_id=&suppressHeaders=true&sEcho=1`;
  const list = async (f, t) => {
    const out = [];
    for (let start = 0; ; start += 500) {
      const j = JSON.parse(await get(LB(f, t) + '&iDisplayStart=' + start + '&iDisplayLength=500'));
      out.push(...j.aaData);
      if (out.length >= Number(j.iTotalRecords) || !j.aaData.length) break;
      await sleep(delayMs);
    }
    return out;
  };
  const rows = (await list(from, to || today)).map((r) => ({
    erp_id: String(r.DT_RowId ?? r[5] ?? ''), do_no: strip(r[0]), date: dmy(strip(r[1])), contract_no: strip(r[2]),
    engagement_id: (String(r[2]).match(/engagement_id=(\d+)/) || [])[1] || '', customer: strip(r[3]), term: strip(r[4]),
  }));
  S.dos = rows.length;
  save([['do_kind', 'erp_id', 'do_no', 'date', 'contract_no', 'engagement_id', 'customer', 'term', 'pulled_at'], ...rows.map((x) => ['do', x.erp_id, x.do_no, x.date, x.contract_no, x.engagement_id, x.customer, x.term, new Date().toISOString()])]);
  // Earlier months: counts only.
  if (countFrom) {
    S.phase = 'counts';
    const counts = [];
    const end = from.slice(0, 7);
    for (let [y, m] = countFrom.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` < end; m === 12 ? (y++, (m = 1)) : m++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const j = JSON.parse(await get(LB(`${ym}-01`, `${ym}-${last}`) + '&iDisplayStart=0&iDisplayLength=1'));
      counts.push(['do_month', ym, j.iTotalRecords]);
      await sleep(Math.min(delayMs, 200));
    }
    save([['do_kind', 'month', 'count'], ...counts]);
  }
  if (pdfs) {
    S.phase = 'pdfs';
    const skip = new Set(skipIds.map(String)); // DOs already in AIMS: listed, print not downloaded again
    for (const x of rows.filter((r) => !skip.has(r.erp_id))) {
      try {
        dl(await get(`m=DO&a=vw_form_add_do&c=_do_print_PDF&suppressHeaders=true&do_id=${x.erp_id}`, 'blob'), `erp-catchup-do-${x.erp_id}.pdf`);
        S.pdfs++;
      } catch (e) {
        S.errors.push(x.do_no + ': ' + e.message);
        if (/session/.test(e.message)) break;
      }
      await sleep(delayMs);
    }
  }
  S.done = true; S.secs = Math.round((Date.now() - S.t0) / 1000);
  return S;
};
