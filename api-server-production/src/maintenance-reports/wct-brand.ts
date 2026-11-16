import { WCT_BRAND_SETTING, type WctBrand } from './msr-templates';

/**
 * The WCT group company whose letterhead and wording a WCT report carries
 * (2026-11-16): the org setting `serviceReportTemplate` ('BCAIR' = BC Air).
 * null = WCT (the setting absent), so WCT's rows stay exactly as before (no
 * `brand` key). Read where a report is made, and stamped on it.
 */
export async function wctBrandSetting(prisma: { organizationUIConfig: { findUnique: (a: any) => Promise<any> } }, organizationId: string): Promise<WctBrand | null> {
  try {
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId }, select: { features: true } });
    return ((ui?.features as any) || {})[WCT_BRAND_SETTING] === 'BCAIR' ? 'BCAIR' : null;
  } catch {
    return null;
  }
}

/** `{ brand }` to spread into a new WCT report's serviceData, or nothing for WCT. */
export async function wctBrandStamp(prisma: Parameters<typeof wctBrandSetting>[0], organizationId: string): Promise<{ brand?: WctBrand }> {
  const b = await wctBrandSetting(prisma, organizationId);
  return b ? { brand: b } : {};
}
