import { BadRequestException } from '@nestjs/common';
import { applyTypedLineLinking, exactProductMatches, linkTypedLines, loadTypedLineCandidates } from './typed-line-product';

// Biofuel #122 (2026-11-25): "LION375" typed instead of picked left the rider
// with a photo-only line and no Scan tag / Enter serial.
const LION375 = { id: 'a-375', name: 'LION375', skuKey: 'LION375' };
const LION250 = { id: 'a-250', name: 'LION250', skuKey: 'LION250' };
const DUP_A = { id: 'd-1', name: 'Generator', skuKey: 'GEN-A' };
const DUP_B = { id: 'd-2', name: 'Generator', skuKey: 'GEN-B' };
const CATALOG = [LION375, LION250, DUP_A, DUP_B];

describe('exactProductMatches', () => {
  it('matches name or code, case-insensitive and trimmed', () => {
    expect(exactProductMatches('  lion375 ', CATALOG)).toEqual([LION375]);
    expect(exactProductMatches('gen-b', CATALOG)).toEqual([DUP_B]);
  });
  it('does not match partial text', () => {
    expect(exactProductMatches('LION375 BESS', CATALOG)).toEqual([]);
    expect(exactProductMatches('LION', CATALOG)).toEqual([]);
  });
});

describe('linkTypedLines', () => {
  it('exact match auto-links (qty kept, description dropped)', () => {
    const r = linkTypedLines([{ description: 'LION375', quantity: 1, assetClass: 'EQUIPMENT' }], CATALOG, { strict: true });
    expect(r.items).toEqual([{ assetId: 'a-375', quantity: 1 }]);
    expect(r.linked).toEqual([{ description: 'LION375', assetId: 'a-375' }]);
  });
  it('no match stays typed', () => {
    const typed = [{ description: '60 es DG', quantity: 1 }, { description: '25mm 5 core cable 10 meter', quantity: 1 }];
    expect(linkTypedLines(typed, CATALOG, { strict: true }).items).toEqual(typed);
  });
  it('2+ product matches: refused on a real schedule, no auto-link', () => {
    expect(() => linkTypedLines([{ description: 'generator', quantity: 1 }], CATALOG, { strict: true })).toThrow(BadRequestException);
    expect(() => linkTypedLines([{ description: 'generator', quantity: 1 }], CATALOG, { strict: true })).toThrow(/Pick the product/);
  });
  it('2+ product matches on a draft: kept typed, not refused', () => {
    const r = linkTypedLines([{ description: 'Generator', quantity: 2 }], CATALOG, { strict: false });
    expect(r.items).toEqual([{ description: 'Generator', quantity: 2 }]);
    expect(r.linked).toEqual([]);
  });
  it('a line already linked is left alone', () => {
    const it0 = { assetId: 'a-250', quantity: 2 };
    expect(linkTypedLines([it0], CATALOG, { strict: true }).items[0]).toBe(it0);
  });
});

describe('applyTypedLineLinking (flag gate)', () => {
  const prisma = () => ({ asset: { findMany: jest.fn(async () => [LION375]) } });
  it('WCT / any org without enableScheduleWizard: unchanged, no query', async () => {
    const p = prisma();
    const items = [{ description: 'LION375', quantity: 1 }];
    expect(await applyTypedLineLinking(p, 'wct', items, { wizardOrg: false, strict: true })).toBe(items);
    expect(p.asset.findMany).not.toHaveBeenCalled();
  });
  it('Biofuel (flag on): links the exact line, keeps the typed accessories', async () => {
    const p = prisma();
    const out = await applyTypedLineLinking(
      p,
      'bio',
      [
        { description: 'LION375', quantity: 1 },
        { description: '60 es DG', quantity: 1 },
      ],
      { wizardOrg: true, strict: true },
    );
    expect(out).toEqual([{ assetId: 'a-375', quantity: 1 }, { description: '60 es DG', quantity: 1 }]);
  });
  it('candidate query is org-scoped, live products only, exact insensitive on name/code', async () => {
    const p = prisma();
    await loadTypedLineCandidates(p, 'bio', [{ description: ' LION375 ', quantity: 1 }, { assetId: 'x', quantity: 1 }]);
    const where = (p.asset.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.organizationId).toBe('bio');
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toEqual([
      { name: { equals: 'LION375', mode: 'insensitive' } },
      { skuKey: { equals: 'LION375', mode: 'insensitive' } },
    ]);
  });
});
