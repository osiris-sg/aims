import { PrismaClient } from '@prisma/client';

const DOC_CODE: Record<string, string> = { INVOICE: 'INV', QUOTATION: 'QO', DELIVERY_ORDER: 'DO' };
function fmt(pattern: string, serial: number, date: Date, docCode = ''): string {
  const YYYY = String(date.getFullYear());
  const YY = YYYY.slice(2);
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const DD = String(date.getDate()).padStart(2, '0');
  return (pattern || '').replace(/\{([^}]+)\}/g, (_m, tok: string) => {
    if (/^#+$/.test(tok)) return String(serial).padStart(tok.length, '0');
    if (tok === 'DOC') return docCode;
    return tok.replace(/YYYY/g, YYYY).replace(/YY/g, YY).replace(/MM/g, MM).replace(/DD/g, DD);
  });
}

(async () => {
  const p = new PrismaClient();
  const org = await p.organization.findFirst({ where: { name: { contains: 'Biofuel' } } });
  const formats = await p.documentNumberFormat.findMany({ where: { organizationId: org!.id, documentType: 'INVOICE' }, orderBy: { sortOrder: 'asc' } });
  const when = new Date();
  for (const f of formats) {
    const m = /\{(#+)\}/.exec(f.pattern)!;
    const prefix = fmt(f.pattern.slice(0, m.index), 0, when, 'INV');
    const suffix = fmt(f.pattern.slice(m.index + m[0].length), 0, when, 'INV');
    const existing = await p.document.findMany({ where: { organizationId: org!.id, name: { startsWith: prefix } }, select: { name: true } });
    let maxExisting = 0; let maxName = '';
    for (const d of existing) {
      const name = d.name || '';
      if (suffix && !name.endsWith(suffix)) continue;
      const mid = name.slice(prefix.length, suffix ? name.length - suffix.length : undefined);
      if (/^\d+$/.test(mid)) { const v = parseInt(mid, 10); if (v > maxExisting) { maxExisting = v; maxName = name; } }
    }
    const serial = Math.max(f.nextSerial, maxExisting + 1);
    console.log(`${f.label}: pattern=${f.pattern} prefix="${prefix}" matches=${existing.length} maxExisting=${maxExisting} (${maxName}) nextSerial(db)=${f.nextSerial} → NEXT: ${fmt(f.pattern, serial, when, 'INV')}`);
  }
  await p.$disconnect();
})();
