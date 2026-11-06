// Round BL — the suggested questions in the AIMEE side panel: static per context (no model call until one is pressed).
// Keys of the "aimee.suggest" catalog; the step-specific ones come first, then "What do I do next?" etc.
// No runtime imports (node --test runs this file).

export interface SuggestCtx {
  orderId?: string | null;
  shipmentId?: string | null;
  step?: { code?: string | null } | null;
  email?: { id: string } | null;
  view?: string | null;
}

/** Step codes that have their own questions (aimee.suggest.<CODE>_<n>). */
export const STEP_SUGGESTIONS: Record<string, number> = {
  BL_DRAFT_APPROVAL: 2,
  SHIPPING_DOCS: 1,
  CUSTOMER_DOCS: 1,
  SEND_DOCS_SCHEDULE: 1,
  CI_PAYMENT: 1,
  CUSTOMS_TAX_ESTIMATE: 2,
  TAX_FUNDS: 2,
  AN_INSTRUCTIONS: 1,
  IMPORT_PERMIT: 1,
  INVOICE_1: 1,
  INVOICE_2: 1,
  PI_PAYMENT: 1,
  LOGISTICS_PAYMENT: 1,
};

/** The suggestion keys for what is in view, most specific first (at most 5). "showHow" sends its own prompt. */
export function suggestionKeys(ctx: SuggestCtx | null): string[] {
  if (ctx?.email?.id) return ["email_1", "email_2", "email_3"];
  const code = ctx?.step?.code ?? null;
  if (code || ctx?.orderId) {
    const own = code && STEP_SUGGESTIONS[code] ? Array.from({ length: STEP_SUGGESTIONS[code] }, (_, i) => `${code}_${i + 1}`) : [];
    const record = own.length ? [] : ["order_1"];
    return [...own, ...record, "next", "overdue", "showHow"].slice(0, 5);
  }
  return ["dash_1", "dash_2", "dash_3"];
}

/** The header line: "#18-1 · Step 7" (or the step name when it has no number), an email, the dashboard. */
export function contextLabel(
  ctx: { ref?: string | null; step?: { no?: string | null; title?: string | null } | null; email?: { subject?: string | null } | null; view?: string | null } | null,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  if (ctx?.email) return ctx.email.subject ? t("ctxEmail", { subject: ctx.email.subject.length > 40 ? `${ctx.email.subject.slice(0, 39)}…` : ctx.email.subject }) : t("ctxEmailNoSubject");
  if (ctx?.ref && ctx.step?.no) return t("ctxStep", { ref: ctx.ref, no: ctx.step.no });
  if (ctx?.ref && ctx.step?.title) return t("ctxStepName", { ref: ctx.ref, step: ctx.step.title });
  if (ctx?.ref) return ctx.ref;
  if (ctx?.view === "Dashboard") return t("ctxDashboard");
  return t("ctxGeneral");
}
