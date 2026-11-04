/**
 * WCT Orders → Jobs (enableWctOrders, 2026-11-03): every job that belongs to an
 * order, across orders, with search / date / status / worker filters. Pure
 * helpers (the where clause, the status a row reads, the worker it shows); the
 * service is order-jobs.service.ts. Other orgs: this list does not exist.
 */
import { rangeInstants, checkRange } from '../dashboard/jobs-calendar';

/** The status filter values (and what each row reads). */
export const ORDER_JOB_STATES = ['draft', 'scheduled', 'in_progress', 'done', 'to_verify', 'rejected', 'completed', 'cancelled'] as const;
export type OrderJobState = (typeof ORDER_JOB_STATES)[number];

export interface OrderJobFilters {
  q?: string;
  from?: string; // yyyy-MM-dd (Singapore days), on scheduledFor
  to?: string;
  state?: string;
  worker?: string; // exact worker name (planned worker, rider or the SiteClock worker)
  /** WCT calendar add (2026-11-04): jobs with NO order yet ("Untagged"), cancelled ones left out. */
  untagged?: boolean;
}

/** The state a job reads in the list (mirrors the order page's jobStatusLabel). */
export function orderJobState(j: { status: string; isDraft?: boolean | null; verificationState?: string | null }): OrderJobState {
  if (j.isDraft && j.status === 'scheduled') return 'draft';
  if (j.status === 'completed' && j.verificationState === 'pending') return 'to_verify';
  if (j.status === 'completed' && j.verificationState === 'rejected') return 'rejected';
  if (j.status === 'delivered') return 'done';
  return j.status as OrderJobState;
}

function stateWhere(state: string): any {
  switch (state) {
    case 'draft':
      return { isDraft: true, status: 'scheduled' };
    case 'scheduled':
      return { isDraft: false, status: 'scheduled' };
    case 'in_progress':
      return { status: 'in_progress' };
    case 'done':
      return { status: 'delivered' };
    case 'to_verify':
      return { status: 'completed', verificationState: 'pending' };
    case 'rejected':
      return { status: 'completed', verificationState: 'rejected' };
    case 'completed':
      return { status: 'completed', OR: [{ verificationState: null }, { verificationState: { notIn: ['pending', 'rejected'] } }] };
    case 'cancelled':
      return { status: 'cancelled' };
    default:
      return null;
  }
}

/** A filter mistake (shown to the user), or null. */
export function checkOrderJobFilters(f: OrderJobFilters): string | null {
  if (f.state && !(ORDER_JOB_STATES as readonly string[]).includes(f.state)) return 'Unknown status';
  if (f.from || f.to) {
    const from = f.from || f.to!;
    const to = f.to || f.from!;
    const bad = checkRange(from, to);
    // A long range is fine for a list (the 62-day limit is the calendar's).
    if (bad && !/At most/.test(bad)) return bad;
  }
  return null;
}

/**
 * The where clause: this org's jobs that belong to an order (drafts included,
 * since WCT's draft jobs are real work), narrowed by the filters. `workerJobIds`
 * are the jobs whose SiteClock worker matches the worker filter.
 */
export function orderJobsWhere(organizationId: string, f: OrderJobFilters, workerJobIds: string[] = []): any {
  const and: any[] = [{ organizationId }, f.untagged ? { orderId: null, status: { not: 'cancelled' } } : { orderId: { not: null } }];
  const q = (f.q || '').trim();
  if (q) {
    const n = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
    and.push({
      OR: [
        ...(n != null && Number.isSafeInteger(n) ? [{ deliveryNumber: n }] : []),
        { order: { orderNumber: { contains: q, mode: 'insensitive' } } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { siteAddress: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (f.from || f.to) {
    const r = rangeInstants(f.from || f.to!, f.to || f.from!);
    and.push({ scheduledFor: { gte: r.gte, lt: r.lt } });
  }
  if (f.state) {
    const s = stateWhere(f.state);
    if (s) and.push(s);
  }
  const worker = (f.worker || '').trim();
  if (worker) {
    and.push({ OR: [{ plannedRiderName: worker }, { riderName: worker }, ...(workerJobIds.length ? [{ id: { in: workerJobIds } }] : [])] });
  }
  return { AND: and };
}

/** Who the job is for: the SiteClock worker, else the planned worker, else who started it. */
export function orderJobWorker(j: { plannedRiderName?: string | null; riderName?: string | null }, siteclockWorker?: string | null): string | null {
  return siteclockWorker || j.plannedRiderName || j.riderName || null;
}
