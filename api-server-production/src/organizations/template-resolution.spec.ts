/**
 * Guard used by scripts/setup-adh-org.ts step 0: a new org's seeded templates
 * must never change which template any OTHER org resolves (templates are a
 * cross-org pool; template-less orgs fall back to the newest isDefault one).
 */
import { checkTemplatePlan, resolveTemplate, type TemplateRow, type SelectionRow } from '../../scripts/lib/template-resolution';

const at = (d: string) => new Date(`2026-${d}T00:00:00Z`);
const tpl = (id: string, organizationId: string, o: Partial<TemplateRow> = {}): TemplateRow => ({ id, organizationId, type: 'INVOICE', isActive: true, isDefault: false, createdAt: at('01-01'), ...o });

// ciel: the current newest seeded default. bio: own active template. demo: nothing (falls back). acme: a selection.
const templates: TemplateRow[] = [
  tpl('t-old', 'osiris', { isDefault: true, createdAt: at('01-01') }),
  tpl('t-ciel', 'ciel', { isDefault: true, createdAt: at('06-01') }),
  tpl('t-bio', 'bio', { createdAt: at('03-01') }),
  tpl('t-pick', 'osiris', { createdAt: at('02-01') }),
];
const selections: SelectionRow[] = [{ organizationId: 'acme', type: 'INVOICE', templateId: 't-pick', isPrimary: true }];
const orgIds = ['osiris', 'ciel', 'bio', 'demo', 'acme'];
const planned = (isDefault: boolean): TemplateRow[] => [tpl('t-adh', 'adh', { isDefault, createdAt: at('10-14') })];

describe('resolveTemplate (mirrors getDocumentTemplateByType)', () => {
  it('primary selection, then own active, then newest isDefault of any org', () => {
    expect(resolveTemplate('acme', 'INVOICE', templates, selections)).toBe('t-pick');
    expect(resolveTemplate('bio', 'INVOICE', templates, selections)).toBe('t-bio');
    expect(resolveTemplate('demo', 'INVOICE', templates, selections)).toBe('t-ciel');
    expect(resolveTemplate('demo', 'QUOTATION', templates, selections)).toBeNull();
  });
});

describe('checkTemplatePlan', () => {
  it('passes isDefault: false templates — other orgs identical, new org on its own', () => {
    const r = checkTemplatePlan({ ownOrgId: 'adh', orgIds, types: ['INVOICE'], templates, selections, planned: planned(false) });
    expect(r.errors).toEqual([]);
    for (const c of r.cells.filter((x) => x.organizationId !== 'adh')) expect(c.after).toBe(c.before);
    expect(r.cells.find((c) => c.organizationId === 'adh')?.after).toBe('t-adh');
  });

  it('fails an isDefault: true template, naming the write and every org it would move', () => {
    const r = checkTemplatePlan({ ownOrgId: 'adh', orgIds, types: ['INVOICE'], templates, selections, planned: planned(true) });
    expect(r.errors).toContain('planned INVOICE template sets isDefault: true (would become the cross-org fallback)');
    // Orgs without their own template or a selection fall back to the newest isDefault one.
    expect(r.errors.filter((e) => e.includes('would change'))).toEqual(['INVOICE for org demo would change: t-ciel → t-adh']);
  });

  it('fails a planned template owned by another org', () => {
    const r = checkTemplatePlan({ ownOrgId: 'adh', orgIds, types: ['INVOICE'], templates, selections, planned: [tpl('t-x', 'bio', { createdAt: at('10-14') })] });
    expect(r.errors.some((e) => e.includes('belongs to another org'))).toBe(true);
  });
});
