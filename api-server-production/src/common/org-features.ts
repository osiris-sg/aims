// Org-level feature flags live in OrganizationUIConfig.features (same JSON the
// portal admin panel toggles). Backend readers use this helper.

export const AUTO_POST_INGEST_FLAG = 'enableAutoPostIngest';

// LEAD CAPTURE OFF THE LINKED-DEVICE BRIDGE (CIEL, guru 2026-11-08). A number
// Meta will not connect to the Cloud API still takes enquiries — from an
// Instagram ad, which sends its own greeting. With this on, an unknown number
// writing to the bridge becomes a Lead, and its SECOND message (the name)
// releases the usual assign card to the notify number. Off by default: every
// other org's bridge traffic is staff chatter, not enquiries, and turning
// strangers into leads there would be noise.
export const BRIDGE_LEAD_CAPTURE_FLAG = 'enableBridgeLeadCapture';

// The exact intro the ad flow sends on the bridged line. Its appearance as an
// OUTBOUND message is what marks a conversation as an enquiry — without it,
// every stranger who ever writes to the company phone (a supplier, a wrong
// number) would become a lead. Held as text, not code: ad copy changes
// without a deploy. Falls back to BRIDGE_LEAD_INTRO_DEFAULT.
export const BRIDGE_LEAD_INTRO_KEY = 'bridgeLeadIntro';
export const BRIDGE_LEAD_INTRO_DEFAULT = 'Hi! Please let us know how we can help you.';

// The bridge's ONE automated exchange (guru 2026-11-08, from the real chat
// that worked): the ad's first contact (a notification_template) gets a
// name-ask; the reply names the lead, the confirmation goes out ({name} is
// substituted), and the lead is assigned straight to the named user.
export const BRIDGE_LEAD_ASK_NAME_KEY = 'bridgeLeadAskName';
export const BRIDGE_LEAD_ASK_NAME_DEFAULT = 'Hey, how can we address you? :)';
export const BRIDGE_LEAD_CONFIRM_KEY = 'bridgeLeadConfirm';
export const BRIDGE_LEAD_CONFIRM_DEFAULT =
  'Hello {name} :) We have arranged a designer to you, he will be contacting you within 24 hours so do expect a call or text.';
/** Name of the org user every bridge lead is auto-assigned to (e.g. "Mike"). Empty = broadcast to management instead. */
export const BRIDGE_LEAD_ASSIGNEE_KEY = 'bridgeLeadAssignee';
export const BRIDGE_LEAD_ASSIGNEE_DEFAULT = 'Mike';

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

/**
 * A feature entry that carries a VALUE rather than a switch.
 *
 * Most of this JSON is booleans, but bridge lead capture needs to know the
 * exact intro the Instagram ad sends, and ad copy changes without a deploy.
 */
export async function orgFeatureText(
  prisma: { organizationUIConfig: { findUnique: (args: any) => Promise<any> } },
  organizationId: string,
  key: string,
): Promise<string | null> {
  const ui = await prisma.organizationUIConfig.findUnique({
    where: { organizationId },
    select: { features: true },
  });
  const v = ((ui?.features as any) || {})[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

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
