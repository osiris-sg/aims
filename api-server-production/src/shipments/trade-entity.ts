/**
 * Issuing entities (2026-10): ADH trades through two companies.
 *   ADH_JP  アジアディールハブジャパン合同会社 — every customer invoice (Invoice #1 / #2 /
 *           single), customer PL / COA and the 出庫・納入依頼書 (SI), in Japanese
 *   ADH_SG  Asia Deal Hub Pte. Ltd. — the SG→JP invoice & packing list and
 *           anything addressed to Vedanta
 * A customer invoice is never issued by ADH_SG. Bank accounts are tagged too:
 * DBS / Wise / CFSB = ADH_SG, SMBC JPY = ADH_JP; an invoice offers only its
 * entity's accounts. Pure.
 */
export type IssuingEntity = 'ADH_JP' | 'ADH_SG';
export const ENTITIES: IssuingEntity[] = ['ADH_JP', 'ADH_SG'];

export const ENTITY_LABEL: Record<IssuingEntity, string> = {
  ADH_JP: 'アジアディールハブジャパン合同会社 (ADH JP)',
  ADH_SG: 'Asia Deal Hub Pte. Ltd. (ADH SG)',
};

/** Customer invoices: never under ADH_SG. */
export const CUSTOMER_INVOICE_TYPES = ['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE'];

/** The entity a generated document is issued by, by type. */
export function entityFor(docType: string): IssuingEntity {
  return docType === 'SGJP_IV_PL' ? 'ADH_SG' : 'ADH_JP';
}

/** Why this entity can't issue this document (null = fine). */
export function entityProblem(docType: string, entity: string | null | undefined): string | null {
  if (!entity) return null;
  if (!ENTITIES.includes(entity as IssuingEntity)) return `Unknown entity "${entity}"`;
  if (CUSTOMER_INVOICE_TYPES.includes(docType) && entity === 'ADH_SG') return 'A customer invoice is issued by ADH Japan (アジアディールハブジャパン合同会社), not by Asia Deal Hub Pte. Ltd.';
  return null;
}

/** A bank account's entity: tagged, else guessed from its name (SMBC / 三井住友 → ADH_JP). */
export function bankEntity(b: { label?: string | null; entity?: string | null }): IssuingEntity {
  if (b.entity === 'ADH_JP' || b.entity === 'ADH_SG') return b.entity;
  return /smbc|三井住友|sumitomo/i.test(b.label ?? '') ? 'ADH_JP' : 'ADH_SG';
}
