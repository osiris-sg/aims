import { Prisma } from '@prisma/client';

/**
 * Keep a delivery document's per-line `deploymentType` in step with the unit's
 * ProjectDeployment.type.
 *
 * WHY THIS EXISTS (guru, 2026-10-20: "even if i change this to sale when i
 * download the DO it still says rental"):
 * `createDoFromDelivery` freezes `deploymentType` onto each config.items[] line
 * when the DO is born, and ALL THREE renderers read that frozen value —
 * CleanDocumentPreview (portal preview), public-document.service (public DO
 * view) and pdf-generator.service (the downloaded PDF) — each resolving the
 * verb as `items.some(i => i.deploymentType === 'SALE') ? 'Sale' : 'Rental'`.
 * An absent key therefore reads as RENTAL.
 *
 * The office Rental/Sale toggle and "Convert to sale" used to write only
 * ProjectDeployment.type, so a DO created before the flip kept printing
 * "Rental of N units of …" for ever, with no way to correct it from the UI.
 * Every writer of ProjectDeployment.type must call this.
 *
 * Idempotent, and scoped to the named units: lines for other units on the same
 * DO keep whatever intent they already carry (one DO can mix rental and sale).
 */
export async function restampDeploymentTypeOnDocuments(
  db: Prisma.TransactionClient,
  organizationId: string,
  inventoryIds: string[],
  type: 'RENTAL' | 'SALE',
): Promise<string[]> {
  const ids = inventoryIds.filter(Boolean);
  if (!ids.length) return [];
  const wanted = new Set(ids);

  // Delivery documents are few per org and config is JSON, so the match is done
  // in memory rather than with a nested JSON path query.
  const docs = await db.document.findMany({
    where: { organizationId, type: { in: ['DELIVERY_ORDER', 'RETURN_DELIVERY_ORDER'] } },
    select: { id: true, name: true, config: true },
  });

  const updated: string[] = [];
  for (const doc of docs) {
    const config: any = doc.config || {};
    const items: any[] = Array.isArray(config.items) ? config.items : [];
    if (!items.length) continue;

    let touched = false;
    const next = items.map((line) => {
      if (!line?.inventoryItemId || !wanted.has(line.inventoryItemId)) return line;
      // Absent counts as RENTAL — that is how the renderers read it.
      if ((line.deploymentType ?? 'RENTAL') === type) return line;
      touched = true;
      return { ...line, deploymentType: type };
    });
    if (!touched) continue;

    await db.document.update({ where: { id: doc.id }, data: { config: { ...config, items: next } } });
    updated.push(doc.name);
  }
  return updated;
}
