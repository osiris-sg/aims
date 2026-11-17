import { BadRequestException } from '@nestjs/common';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { isOrgFeatureEnabled, QUOTATION_CATEGORY_FLAG } from '../common/org-features';
import { optionNames } from '../deliveries/job-category';

/**
 * Quotation category (WCT group, 2026-11-18): an optional pick on each
 * quotation for the sales report, from a list the org edits in Settings >
 * Quotation categories. No schema change:
 *   - the list is a CustomField (entityType 'Quotation', fieldName
 *     'quotation_category', fieldType 'select', options [{ value, label }]),
 *     created on the first save (nothing is seeded);
 *   - a quotation's pick is config.quotationCategory (a string).
 * Blank (or no pick) reads as "Uncategorised". A pick later removed from the
 * list keeps its name on the quotation and in the report.
 *
 * Gate: features.enableQuotationCategory. Every other org has no list and no field.
 */
export const QUOTATION_CATEGORY_ENTITY = 'Quotation';
export const QUOTATION_CATEGORY_FIELD = 'quotation_category';
export const QUOTATION_CATEGORY_KEY = 'quotationCategory';
export const UNCATEGORISED = 'Uncategorised';
const MAX_OPTIONS = 50;
const MAX_LEN = 60;

/** A submitted list made clean: trimmed, no blanks, no repeats (any case), at most 50 of 60 chars. An empty list is allowed. */
export function cleanQuotationCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new BadRequestException('Send the list of categories');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const s = String(typeof v === 'object' && v ? ((v as any).label ?? (v as any).value ?? '') : (v ?? ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) continue;
    if (s.length > MAX_LEN) throw new BadRequestException(`A category is limited to ${MAX_LEN} characters`);
    if (s.toLowerCase() === UNCATEGORISED.toLowerCase()) throw new BadRequestException(`"${UNCATEGORISED}" is the blank choice, it cannot be a category`);
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  if (out.length > MAX_OPTIONS) throw new BadRequestException(`At most ${MAX_OPTIONS} categories`);
  return out;
}

/** A quotation's category as the report shows it: its pick, else "Uncategorised". */
export function categoryLabel(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return s || UNCATEGORISED;
}

export async function isQuotationCategoryEnabled(prisma: any, organizationId: string): Promise<boolean> {
  return isOrgFeatureEnabled(prisma, organizationId, QUOTATION_CATEGORY_FLAG);
}

/** The org's list (empty until the first save). */
export async function quotationCategories(prisma: any, organizationId: string): Promise<string[]> {
  const row = await runAsOrg(organizationId, () =>
    prisma.customField.findFirst({
      where: { organizationId, entityType: QUOTATION_CATEGORY_ENTITY, fieldName: QUOTATION_CATEGORY_FIELD },
      select: { options: true, isActive: true },
    }),
  );
  return row && (row as any).isActive !== false ? optionNames((row as any).options) : [];
}

/** Replace the org's list (order kept). Creates the CustomField row on the first save. */
export async function saveQuotationCategories(prisma: any, organizationId: string, options: string[]): Promise<string[]> {
  const stored = options.map((o) => ({ value: o, label: o }));
  await runAsOrg(organizationId, () =>
    prisma.customField.upsert({
      where: { organizationId_entityType_fieldName: { organizationId, entityType: QUOTATION_CATEGORY_ENTITY, fieldName: QUOTATION_CATEGORY_FIELD } },
      update: { options: stored, isActive: true },
      create: {
        organizationId,
        entityType: QUOTATION_CATEGORY_ENTITY,
        fieldName: QUOTATION_CATEGORY_FIELD,
        displayLabel: 'Category',
        fieldType: 'select',
        required: false,
        options: stored,
        isActive: true,
        showInForm: true,
        showInList: false,
      },
    }),
  );
  return quotationCategories(prisma, organizationId);
}
