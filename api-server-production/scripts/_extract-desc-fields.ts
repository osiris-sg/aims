// Parse the structured refs out of rental-invoice descriptions into the
// TI2 custom fields (guru 2026-08-11): "Our DO No." → documentInfo.doNo/doDate,
// "Our Qtn Ref." → qinRef/qinDate, "Your PO No." → poNo, "Your WO/Works Order"
// → woNo, "Location:" → location, "Project(/Location):" → projectDept,
// "Attn:" (+Mobile/HP/Tel) → documentInfo.contact + config.attention + a
// CustomerContact row on the customer (deduped by name).
// Descriptions are left untouched. Targets (prod): the 70 generated August
// invoices + BI2026080117 + all 80 recurring templates; dev: templates only.
// Dry-run by default; --apply to write.
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

const ddmmyyyy = (s?: string | null) => {
  if (!s) return undefined;
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (!m) return undefined;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};

type Parsed = {
  doNo?: string; doDate?: string; qinRef?: string; qinDate?: string;
  poNo?: string; woNo?: string; location?: string; projectDept?: string;
  attnName?: string; attnPhone?: string;
};

function parseDesc(text: string): Parsed {
  const out: Parsed = {};
  let m: RegExpExecArray | null;
  // Our DO No. DO202601-006 dated 12/01/2026   (also "Our D/O No.", "Our DO No. BI202308-006")
  if ((m = /Our\s+D\/?O\s+No\.?\s*:?\s*([A-Z0-9/-]+)(?:\s+dated\s+(\d{1,2}\/\d{1,2}\/\d{4}))?/i.exec(text))) {
    out.doNo = m[1]; out.doDate = ddmmyyyy(m[2]);
  }
  // Our Qtn Ref. BI/EL/2025-0407 (REV 1) dated/dtd 10/04/2025 — single line only
  if ((m = /(?:Our\s+)?(?:Qtn|Quotation)\s+Ref\.?\s*(?:No\.?)?\s*:?\s*([^\n]+?)\s+(?:dated|dtd)\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text))) {
    out.qinRef = m[1].trim().replace(/\s{2,}/g, ' '); out.qinDate = ddmmyyyy(m[2]);
  } else if ((m = /(?:Our\s+)?(?:Qtn|Quotation)\s+Ref\.?\s*(?:No\.?)?\s*:?\s*([A-Z0-9/().-]+(?:\s\((?:REV|Rev)[^)]*\))?)/i.exec(text))) {
    out.qinRef = m[1].trim();
  }
  // Your PO No. PUPO004355 / Your P.O. No: XXX
  if ((m = /Your\s+P\.?\s?O\.?\s+(?:No\.?|Number)\s*:?\s*([A-Z0-9/-]+)/i.exec(text))) out.poNo = m[1];
  // Your WO No. / Your Works Order (No.)
  if ((m = /Your\s+(?:W\/?O|Works?\s+Order)\s+(?:No\.?|Number)?\s*:?\s*([A-Z0-9/-]+)/i.exec(text))) out.woNo = m[1];
  // Location: 51 Canberra Cres…  (also "Site Location:")
  if ((m = /(?:^|\n)\s*(?:Site\s+)?Location\s*:\s*([^\n]+)/i.exec(text))) out.location = m[1].trim();
  // Project: X / Project Location: X (prefer plain "Project:")
  if ((m = /(?:^|\n)\s*Project\s*:\s*([^\n]+)/i.exec(text))) out.projectDept = m[1].trim();
  else if ((m = /(?:^|\n)\s*Project\s+Location\s*:\s*([^\n]+)/i.exec(text))) out.projectDept = m[1].trim();
  // Attn: Mr Feng Tianru  (+ Mobile/HP/Tel/Contact line)
  if ((m = /Attn\.?\s*:?\s*([^\n(]+)/i.exec(text))) {
    let name = m[1].trim().replace(/[.,;]$/, '');
    // "Attn: Yong Xian - 9649 2740" — split trailing dash-phone off the name
    const inline = /^(.*?)\s*[-–—]\s*(\d{4}\s?\d{4})$/.exec(name);
    if (inline) { name = inline[1].trim(); out.attnPhone = inline[2]; }
    out.attnName = name;
    if (!out.attnPhone) {
      const p = /(?:Mobile|HP|H\/P|Tel|Contact)\s*(?:No\.?)?\s*:?\s*(\+?65\s?)?(\d{4}\s?\d{4})/i.exec(text);
      if (p) out.attnPhone = (p[2] || '').replace(/\s+/g, ' ').trim();
    }
  }
  return out;
}

const label = (pr: Parsed) => Object.entries(pr).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' | ');

async function run(envFile: string, doDocs: boolean) {
  const url = fs.readFileSync(path.resolve(__dirname, '..', envFile), 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)![1];
  const p = new PrismaClient({ datasources: { db: { url } } });
  console.log(`\n########## ${envFile} ##########`);
  try {
    // ---- documents (generated Aug invoices + the Obayashi July-period one) ----
    if (doDocs) {
      const docs = await p.document.findMany({
        where: { organizationId: ORG, type: 'INVOICE', name: { gte: 'BI2026080117', lte: 'BI2026080187' } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, config: true },
      });
      for (const d of docs) {
        const c: any = d.config;
        const text = (c.items || []).map((i: any) => i.description || '').join('\n');
        const pr = parseDesc(text);
        if (!label(pr)) { console.log(`DOC  ${d.name}: nothing parsed`); continue; }
        console.log(`DOC  ${d.name}: ${label(pr)}`);
        if (!APPLY) continue;
        const di = { ...(c.documentInfo || {}) };
        if (pr.doNo && !di.doNo) { di.doNo = pr.doNo; if (pr.doDate) di.doDate = pr.doDate; }
        if (pr.qinRef && !di.qinRef) { di.qinRef = pr.qinRef; if (pr.qinDate) di.qinDate = pr.qinDate; }
        if (pr.poNo && !di.poNo) di.poNo = pr.poNo;
        if (pr.woNo && !di.woNo) di.woNo = pr.woNo;
        if (pr.location && !di.location) di.location = pr.location;
        if (pr.projectDept && !di.projectDept) di.projectDept = pr.projectDept;
        if (pr.attnName && !di.contact) di.contact = pr.attnName + (pr.attnPhone ? ` (${pr.attnPhone})` : '');
        const attention = c.attention && c.attention.name ? c.attention : { name: pr.attnName || '', email: '', phone: pr.attnPhone || '' };
        await p.document.update({ where: { id: d.id }, data: { config: { ...c, documentInfo: di, ...(pr.attnName ? { attention } : {}) } as any } });
      }
    }

    // ---- recurring templates ----
    const tpls = await p.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, customerId: true, config: true } });
    const contactsAdded = new Set<string>();
    for (const t of tpls) {
      const c: any = t.config || {};
      const text = (c.items || []).map((i: any) => i.description || '').join('\n');
      const pr = parseDesc(text);
      if (!label(pr)) continue;
      console.log(`TPL  ${t.name.slice(0, 40)}: ${label(pr)}`);
      if (APPLY) {
        const di = { ...(c.documentInfo || {}) };
        if (pr.doNo && !di.doNo) { di.doNo = pr.doNo; if (pr.doDate) di.doDate = pr.doDate; }
        if (pr.qinRef && !di.qinRef) { di.qinRef = pr.qinRef; if (pr.qinDate) di.qinDate = pr.qinDate; }
        if (pr.poNo && !di.poNo) di.poNo = pr.poNo;
        if (pr.woNo && !di.woNo) di.woNo = pr.woNo;
        if (pr.location && !di.location) di.location = pr.location;
        if (pr.projectDept && !di.projectDept) di.projectDept = pr.projectDept;
        if (pr.attnName && !di.contact) di.contact = pr.attnName + (pr.attnPhone ? ` (${pr.attnPhone})` : '');
        await p.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...c, documentInfo: di } } });
      }
      // ---- customer contact (prod only == doDocs env) ----
      if (doDocs && pr.attnName && t.customerId) {
        const key = `${t.customerId}:${pr.attnName.toLowerCase()}`;
        if (!contactsAdded.has(key)) {
          contactsAdded.add(key);
          const existing = await p.customerContact.findFirst({ where: { customerId: t.customerId, name: { equals: pr.attnName, mode: 'insensitive' } } });
          if (existing) {
            console.log(`     contact exists: ${pr.attnName}`);
            if (APPLY && pr.attnPhone && !existing.phone) await p.customerContact.update({ where: { id: existing.id }, data: { phone: pr.attnPhone } });
          } else {
            console.log(`     + customer contact: ${pr.attnName}${pr.attnPhone ? ` (${pr.attnPhone})` : ''}`);
            if (APPLY) await p.customerContact.create({ data: { customerId: t.customerId, name: pr.attnName, phone: pr.attnPhone || null } });
          }
        }
      }
    }
  } finally {
    await p.$disconnect();
  }
}

(async () => {
  await run('.env.production', true);
  await run('.env', false); // dev: templates only, for parity
  console.log(APPLY ? '\nAPPLIED' : '\nDRY RUN — pass --apply');
})().catch((e) => { console.error(e); process.exit(1); });
