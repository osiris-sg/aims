import { isUnconfirmedDoc } from '../common/doc-status';

/**
 * Permanent delete of a CANCELLED run (OsirisAdmin only, 2026-10-30). Cancel is
 * the normal end of a run and keeps the row; this removes test / mistaken runs
 * that never committed anything. "Committed" means any of: a real DO number,
 * stock that moved (a unit was ever bound), field work (a delivered / started
 * line, a field report, a posted group message), an invoice, or a ledger post.
 * The facts are read from live rows by the service; this decides.
 */
export interface PurgeFacts {
  status: string;
  isDraft: boolean;
  items: Array<{
    inventoryId: string | null;
    deliveryStatus: string | null;
    deliveringAt: Date | null;
    deliveredAt: Date | null;
    completedAt: Date | null;
  }>;
  /** Documents the run's lines point at (DeliveryItem.documentId). */
  docs: Array<{ id: string; name: string | null; status: string | null }>;
  /** Invoices raised from any of those documents (config.sourceDocumentId). */
  invoices: number;
  /** POSTED journal entries sourced from any of those documents. */
  postedEntries: number;
  /** Field reports on the run, not counting the unwritten SCHEDULED service placeholder. */
  reports: number;
  /** Delivery group posts (a signed DO posted to the customer's WhatsApp group). */
  groupPosts: number;
}

/** "DO-PENDING-02" / "RDO-PENDING-01": the placeholder a scheduled run carries until its DO is confirmed. */
export const isPlaceholderDocName = (name: string | null | undefined) => !name || /^R?DO-PENDING-\d+$/i.test(name.trim());

/** Why the run can't be deleted permanently, or null when it can. */
export function purgeBlocker(f: PurgeFacts): string | null {
  if (f.status !== 'cancelled') return `Only a cancelled delivery can be deleted permanently (status: ${f.status}). Cancel it first.`;
  if (f.items.some((i) => i.inventoryId)) return 'A unit was bound to this run, so stock moved. It stays as a cancelled delivery.';
  if (f.items.some((i) => i.deliveringAt || i.deliveredAt || i.completedAt || (i.deliveryStatus && i.deliveryStatus !== 'not_delivered'))) {
    return 'Work was recorded on this run in the field. It stays as a cancelled delivery.';
  }
  if (f.reports) return 'This run has field reports attached. It stays as a cancelled delivery.';
  if (f.groupPosts) return 'This run was posted to a delivery group. It stays as a cancelled delivery.';
  const real = f.docs.find((d) => !isPlaceholderDocName(d.name) || !isUnconfirmedDoc(d.status));
  if (real) return `This run has Delivery Order ${real.name ?? real.id}, which is a real document. It stays as a cancelled delivery.`;
  if (f.invoices) return 'An invoice was raised from this run. It stays as a cancelled delivery.';
  if (f.postedEntries) return 'This run has a document that posted to the ledger. It stays as a cancelled delivery.';
  return null;
}
