/**
 * Round AY — the order process per customer (Clients → a customer → Process).
 * A customer profile's `skipSteps` lists the step codes that are not part of
 * this customer's process (Hoei ends at step 9). Those steps are marked N/A on
 * the customer's open orders / shipments with PROCESS_SKIP_REASON — hidden in
 * the step cards, skipped by progress, the current step, completion, tasks,
 * reminders, Monthly statuses, question cards and the WhatsApp assistant (all
 * of which already skip N/A steps). Done steps stay done; nothing is deleted.
 * Pure: no Prisma, no Nest.
 */
import { countsForProgress } from './shipments.rules';

export const PROCESS_SKIP_REASON = "Not in this customer's process";
/** Steps moved from the shipment to the order in round H — always N/A on the shipment. */
export const isMovedToOrder = (s: { skipReason?: string | null }) => !!s.skipReason?.startsWith('Moved to the order');
export const isProcessSkipped = (s: { notApplicable?: boolean | null; skipReason?: string | null }) => !!s.notApplicable && s.skipReason === PROCESS_SKIP_REASON;

export interface ProcessStep {
  scope: 'ORDER' | 'SHIPMENT';
  code: string;
  no: string;
  en: string;
  ja: string;
  /** Runs alongside the others and never blocks completion. */
  ongoing?: boolean;
}

/** ADH's order process in step order (the step templates' numbers and titles). JA names are proposed wording — ADH to confirm. */
export const PROCESS_STEPS: ProcessStep[] = [
  { scope: 'ORDER', code: 'CHECK_CONTRACT', no: '0', en: 'Check contract', ja: '契約内容の確認' },
  { scope: 'ORDER', code: 'PI_PAYMENT', no: '1', en: 'Set up PI payment', ja: 'PI（前払金）の支払い' },
  { scope: 'ORDER', code: 'INVOICE_1', no: '2', en: 'Issue and send Invoice #1', ja: '請求書①の発行・送付' },
  { scope: 'SHIPMENT', code: 'BL_DRAFT_APPROVAL', no: '3a', en: 'Approve B/L draft (Vedanta)', ja: 'B/Lドラフトの承認' },
  { scope: 'SHIPMENT', code: 'SHIPPING_DOCS', no: '3b', en: 'Receive shipping documents', ja: '船積書類の受領' },
  { scope: 'SHIPMENT', code: 'CUSTOMER_DOCS', no: '4', en: 'Create customer documents', ja: '顧客向け書類の作成' },
  { scope: 'SHIPMENT', code: 'SEND_DOCS_SCHEDULE', no: '5', en: 'Send documents & ask schedule', ja: '書類送付・納期確認' },
  { scope: 'SHIPMENT', code: 'CI_PAYMENT', no: '6', en: 'Set up CI payment', ja: 'CI（残金）の支払い' },
  { scope: 'SHIPMENT', code: 'CUSTOMS_TAX_ESTIMATE', no: '7', en: 'Customs documents & tax estimate', ja: '通関書類・輸入税見積' },
  { scope: 'SHIPMENT', code: 'TAX_FUNDS', no: '8', en: 'Prepare import-tax funds', ja: '輸入税の資金準備' },
  { scope: 'SHIPMENT', code: 'AN_INSTRUCTIONS', no: '9', en: 'Send arrival notice & shipping instructions', ja: '到着案内・出庫指示の送付' },
  { scope: 'SHIPMENT', code: 'IMPORT_PERMIT', no: '10', en: 'Store & send import permit', ja: '輸入許可書の保管・送付' },
  { scope: 'ORDER', code: 'INVOICE_2', no: '11', en: 'Issue Invoice #2 / the invoice', ja: '請求書②（最終請求書）の発行' },
  { scope: 'SHIPMENT', code: 'LOGISTICS_PAYMENT', no: '12', en: 'Pay transport & storage costs', ja: '運送費・保管料の支払い' },
  { scope: 'ORDER', code: 'XERO_HANDOFF', no: '13', en: 'Prepare data for Xero reconciliation', ja: 'Xero照合用データの準備' },
  { scope: 'SHIPMENT', code: 'DELIVERY_CHANGES', no: '14', en: 'Coordinate delivery changes', ja: '納品変更の調整', ongoing: true },
];
const BY_CODE = new Map(PROCESS_STEPS.map((s) => [s.code, s]));
export const processStep = (code: string) => BY_CODE.get(code);
export const stepNameJa = (code: string) => BY_CODE.get(code)?.ja ?? null;

const numOf = (no: string) => parseFloat(no.replace(/[a-z]$/i, (m) => (m.toLowerCase() === 'a' ? '.1' : '.2')));
/** The codes after step `no` ("9" → 10, 11, 12, 13, 14): a process that ends at step `no`. */
export const codesAfter = (no: string) => PROCESS_STEPS.filter((s) => numOf(s.no) > numOf(no)).map((s) => s.code);

/** Validate a skip list: known process codes, no duplicates, in process order. */
export function cleanSkipSteps(v: unknown, fail: (msg: string) => never): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) fail('skipSteps must be a list of step codes');
  const want = new Set<string>();
  for (const c of v as unknown[]) {
    if (typeof c !== 'string' || !BY_CODE.has(c)) fail(`Unknown step "${String(c)}"`);
    want.add(c as string);
  }
  if (want.has('CHECK_CONTRACT')) fail('Step 0 (check contract) is part of every process');
  return PROCESS_STEPS.filter((s) => want.has(s.code)).map((s) => s.code);
}

export interface ImpactStep {
  code: string;
  status: string;
  isOngoing: boolean;
  notApplicable: boolean;
  skipReason?: string | null;
  displayNo?: string | null;
  title?: string;
}
export interface ImpactRecord {
  kind: 'order' | 'shipment';
  id: string;
  ref: string;
  /** Shipments: the order id. */
  orderId?: string;
  status: string;
  steps: ImpactStep[];
}
export interface ProcessImpact {
  openOrders: number;
  openShipments: number;
  /** Not-done steps that become hidden / come back. */
  hidden: Array<{ ref: string; step: string }>;
  shown: Array<{ ref: string; step: string }>;
  /** Done steps that are no longer in the process: they stay done (and visible). */
  doneKept: Array<{ ref: string; step: string }>;
  /** Records that would complete because every remaining step is done. */
  completes: string[];
}

const label = (s: ImpactStep) => `${s.displayNo ?? processStep(s.code)?.no ?? ''} ${s.title ?? processStep(s.code)?.en ?? s.code}`.trim();

/**
 * What changing a customer's process does to its OPEN orders and shipments.
 * `naNext(kind)` = the step codes N/A under the new profile (process skips +
 * billing / supplier rules). Moved-to-the-order steps never change.
 */
export function processImpact(records: ImpactRecord[], naNext: (r: ImpactRecord) => Set<string>): ProcessImpact {
  const out: ProcessImpact = { openOrders: 0, openShipments: 0, hidden: [], shown: [], doneKept: [], completes: [] };
  const open = records.filter((r) => r.status === 'OPEN');
  const after = new Map<string, ImpactStep[]>();
  for (const r of open) {
    if (r.kind === 'order') out.openOrders++;
    else out.openShipments++;
    const na = naNext(r);
    const next = r.steps.map((s) => {
      if (isMovedToOrder(s)) return { ...s, notApplicable: true };
      const want = na.has(s.code);
      if (s.status === 'DONE') {
        if (want && !s.notApplicable) out.doneKept.push({ ref: r.ref, step: label(s) });
        return s;
      }
      if (want && !s.notApplicable) out.hidden.push({ ref: r.ref, step: label(s) });
      if (!want && s.notApplicable) out.shown.push({ ref: r.ref, step: label(s) });
      return { ...s, notApplicable: want };
    });
    after.set(r.id, next);
  }
  const allDone = (steps: ImpactStep[]) => steps.every((s) => !countsForProgress(s) || s.status === 'DONE');
  const shipDone = new Set(open.filter((r) => r.kind === 'shipment' && allDone(after.get(r.id)!)).map((r) => r.id));
  for (const r of open.filter((x) => x.kind === 'shipment' && shipDone.has(x.id))) out.completes.push(r.ref);
  for (const o of open.filter((x) => x.kind === 'order')) {
    const ships = records.filter((s) => s.kind === 'shipment' && s.orderId === o.id && s.status !== 'CANCELLED');
    const shipsDone = ships.length > 0 && ships.every((s) => s.status === 'COMPLETED' || shipDone.has(s.id));
    if (allDone(after.get(o.id)!) && shipsDone) out.completes.push(o.ref);
  }
  return out;
}
