/**
 * Round BJ — HS code per product (Clients › Products). A shipment's HS code comes from its B/L / CI; when they print
 * none, the product's applies. A different code (typed or read, e.g. 7201.60) is only warned about, never blocked.
 */
import type { ClientProduct } from './clients-products';
import { parseSize, productLabel } from './clients-products';
import { profileFor, supplierProfileFor } from './trade-profile';
import type { Db } from './trade-config.service';

/** "7601.20", "76012000", "7601.20.00", "HS 7601 20" → "7601.20" (heading + subheading); else the trimmed text or null. */
export function normHs(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  const d = t.replace(/\D/g, '');
  return d.length >= 6 ? `${d.slice(0, 4)}.${d.slice(4, 6)}` : t;
}

/** Both codes known and different at the 6-digit level. */
export const hsDiffers = (a: string | null | undefined, b: string | null | undefined) => {
  const x = normHs(a);
  const y = normHs(b);
  return !!x && !!y && x !== y;
};

/** The warning shown next to an HS code that isn't the product's. */
export const hsWarning = (code: string | null | undefined, productHs: string | null | undefined) =>
  hsDiffers(code, productHs) ? `HS code differs from the product (${normHs(productHs)})` : null;

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase();

/** The product (visible, same grade family and size when known) a shipment of `grade` / `size` ships; one with an HS code first. */
export function productFor(products: ClientProduct[] | null | undefined, grade: string | null | undefined, size: string | null | undefined): ClientProduct | null {
  const g = norm(grade).match(/^[A-Z]?\d{4}/)?.[0] ?? norm(grade);
  const sz = parseSize(size);
  const fits = (products ?? []).filter((p) => {
    if (p.hidden) return false;
    if (p.grade && g && !norm(p.grade).startsWith(g) && !g.startsWith(norm(p.grade))) return false;
    if (sz && p.diameterMm && p.lengthMm && (p.diameterMm !== sz.diameterMm || p.lengthMm !== sz.lengthMm)) return false;
    return !!(p.grade || p.diameterMm);
  });
  return fits.find((p) => normHs(p.hsCode)) ?? fits[0] ?? null;
}

export interface ProductHs {
  hsCode: string;
  product: string;
  party: 'customer' | 'supplier';
}

/** The HS code of the product this shipment ships: the customer's product, else the supplier's. Null when neither has one. */
export function productHsOf(
  profiles: { customerProfiles: unknown; supplierProfiles: unknown } | null | undefined,
  s: { customerId: string | null; supplierId: string | null; grade: string | null; size: string | null },
  label: (p: ClientProduct) => string,
): ProductHs | null {
  if (!profiles) return null;
  const cp = s.customerId ? productFor(profileFor(profiles.customerProfiles, s.customerId).products, s.grade, s.size) : null;
  if (cp && normHs(cp.hsCode)) return { hsCode: normHs(cp.hsCode)!, product: label(cp), party: 'customer' };
  const sp = s.supplierId ? productFor(supplierProfileFor(profiles.supplierProfiles, s.supplierId).products, s.grade, s.size) : null;
  if (sp && normHs(sp.hsCode)) return { hsCode: normHs(sp.hsCode)!, product: label(sp), party: 'supplier' };
  return null;
}

/** Load the shipment's order / contract product and the org's profiles → its product HS code. */
export async function productHsForShipment(db: Db, organizationId: string, shipmentId: string): Promise<ProductHs | null> {
  const s = await db.shipment.findFirst({
    where: { id: shipmentId, organizationId },
    select: {
      customerId: true,
      sizeSpec: true,
      order: { select: { customerId: true, supplierId: true, grade: true, size: true } },
      contract: { select: { supplierId: true } },
      contractLine: { select: { grade: true, sizeSpec: true } },
    },
  });
  if (!s) return null;
  const settings = await db.tradeSetting.findFirst({ where: { organizationId }, select: { customerProfiles: true, supplierProfiles: true } });
  return productHsOf(
    settings,
    {
      customerId: s.order?.customerId ?? s.customerId,
      supplierId: s.order?.supplierId ?? s.contract?.supplierId ?? null,
      grade: s.order?.grade ?? s.contractLine?.grade ?? null,
      size: s.sizeSpec ?? s.order?.size ?? s.contractLine?.sizeSpec ?? null,
    },
    productLabel,
  );
}
