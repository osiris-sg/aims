import { BadRequestException } from '@nestjs/common';

/**
 * Stepped schedule (enableScheduleWizard, Biofuel 2026-11-25): a free-typed line
 * whose text IS a catalog product (name or code, case-insensitive, trimmed, e.g.
 * "LION375") is linked to that product on save, so the rider gets Scan tag /
 * Enter serial instead of a photo-only typed line (#122). Two or more products
 * with that exact name/code: refused, the office picks. Anything else (cables,
 * accessories) stays typed. The dialog does the same before save and also asks
 * on near matches; this is the server's safety net for every save path
 * (create, edit, draft promotion, a draft made from a quotation / SO).
 */
export interface ScheduleItemInput {
  assetId?: string;
  description?: string;
  quantity: number;
  assetClass?: any;
}
export interface ProductRow {
  id: string;
  name: string;
  skuKey: string | null;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Products whose name or code equals the typed text exactly (case-insensitive, trimmed). */
export function exactProductMatches(text: string, products: ProductRow[]): ProductRow[] {
  const t = norm(text);
  if (!t) return [];
  return products.filter((p) => norm(p.name) === t || (p.skuKey != null && norm(p.skuKey) === t));
}

export const pickProductMessage = (text: string) =>
  `More than one product is called "${text.trim()}". Pick the product for that line.`;

/**
 * Link exact matches. `strict` (a real schedule) refuses an ambiguous line; a
 * draft keeps it typed so the office can still park the run.
 */
export function linkTypedLines(
  items: ScheduleItemInput[],
  products: ProductRow[],
  opts: { strict: boolean },
): { items: ScheduleItemInput[]; linked: { description: string; assetId: string }[] } {
  const linked: { description: string; assetId: string }[] = [];
  const out = items.map((it) => {
    if (it.assetId || !norm(it.description)) return it;
    const hits = exactProductMatches(it.description!, products);
    if (hits.length === 1) {
      linked.push({ description: it.description!.trim(), assetId: hits[0].id });
      return { assetId: hits[0].id, quantity: it.quantity };
    }
    if (hits.length > 1 && opts.strict) throw new BadRequestException(pickProductMessage(it.description!));
    return it;
  });
  return { items: out, linked };
}

/** Load only the products that could match the typed lines (one query). */
export async function loadTypedLineCandidates(prisma: any, organizationId: string, items: ScheduleItemInput[] | undefined): Promise<ProductRow[]> {
  const texts = [...new Set((items ?? []).filter((i) => !i.assetId && norm(i.description)).map((i) => i.description!.trim()))];
  if (!texts.length) return [];
  return prisma.asset.findMany({
    where: {
      organizationId,
      deletedAt: null,
      OR: texts.flatMap((t) => [
        { name: { equals: t, mode: 'insensitive' } },
        { skuKey: { equals: t, mode: 'insensitive' } },
      ]),
    },
    select: { id: true, name: true, skuKey: true },
  });
}

/** Gate + apply: a no-op unless the org has the stepped schedule flag. */
export async function applyTypedLineLinking(
  prisma: any,
  organizationId: string,
  items: ScheduleItemInput[] | undefined,
  opts: { wizardOrg: boolean; strict: boolean },
): Promise<ScheduleItemInput[] | undefined> {
  if (!opts.wizardOrg || !items?.length) return items;
  const products = await loadTypedLineCandidates(prisma, organizationId, items);
  if (!products.length) return items;
  return linkTypedLines(items, products, { strict: opts.strict }).items;
}
