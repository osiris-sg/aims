/**
 * Round BJ — READ-ONLY survey: the B/L reader (old prompt vs new prompt + text layer) over every ADH B/L / B/L draft
 * dumped by _bj-bl-dump.ts (dedupe by hash). No DB access; AI calls only. --dir=<dump> --old=<old rules source> --out=<json>
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { DocumentExtractionService } from '../src/document-extraction/document-extraction.service';
import { BL_SCHEMA, BL_SYSTEM_PROMPT, BL_USER_PROMPT, blFieldsFromText, parseWith, shipmentDraftFromBl, withTextFields } from '../src/shipments/trade-extract.rules';
import { pdfText } from '../src/shipments/trade-coa';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const dir = arg('dir')!;
const oldSrc = fs.readFileSync(arg('old')!, 'utf8');
const oldSys = eval(/export const BL_SYSTEM_PROMPT =\s*\n?\s*('(?:[^'\\]|\\.)*');/.exec(oldSrc)![1]);
const oldUser = eval('`' + /export const BL_USER_PROMPT = `([\s\S]*?)`;/.exec(oldSrc)![1] + '`');
const FIELDS = ['portOfLoading', 'portOfDischarge', 'placeOfReceipt', 'placeOfDelivery', 'containerCount', 'hsCode', 'countryOfOrigin'] as const;
(async () => {
  const x = Object.create(DocumentExtractionService.prototype) as DocumentExtractionService;
  Object.assign(x, { logger: { log() {}, warn() {}, error() {} } });
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const seen = new Map<string, any>();
  const rows: any[] = [];
  for (const f of meta) {
    const fp = path.join(dir, f.id + (path.extname(f.fileName) || '.bin'));
    if (!fs.existsSync(fp) || !/pdf|image/i.test(f.mimeType)) continue;
    const buf = fs.readFileSync(fp);
    const h = createHash('sha256').update(buf).digest('hex');
    if (seen.has(h)) { seen.get(h).also.push(f.ships.map((s: any) => s.ref).join(',')); continue; }
    const text = /pdf/i.test(f.mimeType) ? await pdfText(buf).catch(() => '') : '';
    const read = async (sys: string, user: string) => {
      try { return parseWith(BL_SCHEMA, (await x.extractStructured({ buffer: buf, mimetype: f.mimeType }, sys, user, { maxTokens: 4000 })).data, 'B/L'); } catch (e) { return { error: (e as Error).message } as any; }
    };
    const [o, n] = await Promise.all([read(oldSys, oldUser), read(BL_SYSTEM_PROMPT, BL_USER_PROMPT)]);
    const od = o.error ? null : shipmentDraftFromBl({ ...o, placeOfReceipt: null, shipperText: null });
    const nd = n.error ? null : shipmentDraftFromBl(withTextFields(n, text));
    const row = { file: f.fileName, docType: f.docType, ref: f.ships.map((s: any) => s.ref).join(','), also: [] as string[], textLen: text.replace(/\s/g, '').length, text: blFieldsFromText(text), old: od && Object.fromEntries(FIELDS.map((k) => [k, (od as any)[k] ?? null])), neu: nd && Object.fromEntries(FIELDS.map((k) => [k, (nd as any)[k] ?? null])), err: o.error || n.error || null };
    seen.set(h, row);
    rows.push(row);
    console.log(row.ref.padEnd(14), row.file.slice(0, 40).padEnd(40), JSON.stringify(row.old), '→', JSON.stringify(row.neu), row.err ?? '');
  }
  fs.writeFileSync(arg('out')!, JSON.stringify(rows, null, 1));
})();
