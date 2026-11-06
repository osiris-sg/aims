/** Round BJ — READ-ONLY: permit invoice no. + CIF vs the SG→JP invoices (dumped texts from _bj-bl-dump.ts). */
import * as fs from 'fs';
import * as path from 'path';
import { parsePermitText } from '../src/shipments/trade-customs';
const [permitDir, sgjpDir] = process.argv.slice(2);
const pm = JSON.parse(fs.readFileSync(path.join(permitDir, 'meta.json'), 'utf8'));
const sm = JSON.parse(fs.readFileSync(path.join(sgjpDir, 'meta.json'), 'utf8'));
const sg = sm.map((f: any) => {
  const t = fs.readFileSync(path.join(sgjpDir, f.id + '.txt'), 'utf8');
  const no = t.match(/ADH\d{8}/)?.[0] ?? null;
  const tot = [...t.matchAll(/US\$\s*([\d,]+\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, '')));
  return { no, total: tot.length ? Math.max(...tot) : null, refs: f.ships.map((s: any) => s.ref).join(','), file: f.fileName };
});
for (const f of pm) {
  const t = fs.readFileSync(path.join(permitDir, f.id + '.txt'), 'utf8');
  const r: any = parsePermitText(t);
  const d = r.data ?? {};
  const inv = d.invoiceNo ?? t.match(/ADH\d{8}/)?.[0] ?? null;
  const hit = sg.filter((x: any) => x.no && x.no === inv);
  console.log([f.ships.map((s: any) => s.ref).join(','), f.fileName.slice(0, 40), d.declarationNo ?? '', inv, `${d.invoiceTerms ?? ''} ${d.invoiceCurrency ?? ''} ${d.invoiceAmount ?? ''}`, hit.map((h: any) => `${h.refs} ${h.no} ${h.total} ${h.total === d.invoiceAmount ? 'MATCH' : 'differs'}`).join(' | ') || '—'].join(' · '));
}
