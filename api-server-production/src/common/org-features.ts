// Org-level feature flags live in OrganizationUIConfig.features (same JSON the
// portal admin panel toggles). Backend readers use this helper.

export const AUTO_POST_INGEST_FLAG = 'enableAutoPostIngest';

// Uploading a supplier invoice to the chat agent files it as a PROJECT COST.
// That is the ID-firm workflow (CIEL), not something every org wants: an org
// that does not run project costing was being asked to confirm a cost it has
// no use for (guru 2026-10-04).
export const CHAT_UPLOAD_PROJECT_COST_FLAG = 'enableChatUploadProjectCost';

// OFFICE-SIGNED DELIVERY ORDERS (2026-11-05, guru). A DO raised in the office —
// no field run, no rider, no field app — can be shared for the customer to sign.
// The signature needs somewhere to live: field DOs put it on the run's DO_ACK
// proof rows, so an office DO gets ONE document-scoped proof row instead
// (public-document.service.ts). Flag-gated because it changes what a shared DO
// link offers: with it off, a DO with no run behind it stays unsignable exactly
// as before.
export const OFFICE_DO_SIGN_FLAG = 'enableOfficeDoSign';

// SUPPLIER CREDIT NOTES ON A PAYMENT VOUCHER (2026-11-06, guru). The voucher's
// offset grid lists supplier invoices only, so a supplier credit note can
// never be applied — the AP side has no equivalent of the AR Manual Offset.
// With this on, credit notes join the grid and allocate NEGATIVE: they reduce
// the cash paid, and on their own they settle bills with no cash at all.
// Flag-gated because it changes what a voucher may post (a credit line on the
// creditor control, and a voucher with no bank line).
export const AP_CREDIT_OFFSET_FLAG = 'enableApCreditOffset';

// CONTRA SET-OFF (2026-11-06, guru) — the same company is a customer AND a
// supplier ("we bill them and they bill us"), and the two ledgers are netted.
// Distinct from the Manual Offset, which never leaves the debtors control.
// A contra moves balance between the debtor and creditor controls, so it is
// flag-gated per org and the customer↔supplier pairing is confirmed by hand.
export const CONTRA_OFFSET_FLAG = 'enableContraOffset';

// SITECLOCK DELIVERIES (2026-11-06). A worker does the AIMS delivery flow
// (start + condition photos, items, sign-off, DO, returns) inside the SiteClock
// app, on the job AIMS put on their schedule. With it on, the job sync sends
// deliveryEnabled per job (the worker maps to an AIMS member with a field role)
// and the SiteClock worker delivery API answers; off = neither. Osiris admins
// only; needs the SiteClock link (enableSiteClockLink + an enabled connection).
export const SITECLOCK_DELIVERIES_FLAG = 'enableSiteClockDeliveries';

export async function isOrgFeatureEnabled(
  prisma: { organizationUIConfig: { findUnique: (args: any) => Promise<any> } },
  organizationId: string,
  key: string,
): Promise<boolean> {
  const ui = await prisma.organizationUIConfig.findUnique({
    where: { organizationId },
    select: { features: true },
  });
  return ((ui?.features as any) || {})[key] === true;
}
