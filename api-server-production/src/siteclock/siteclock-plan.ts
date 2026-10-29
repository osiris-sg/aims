import { createHash } from 'crypto';

/**
 * Pure planning for the SiteClock link: what the SiteClock job for a delivery
 * run should look like right now, and which calls get it there. No I/O, so the
 * whole state machine is unit-tested (siteclock-plan.spec.ts).
 *
 * The job is the worker's SCHEDULE: AIMS owns it end to end. Time, place and
 * wording are read from the run at sync time; worker and duration are the
 * office's pick stored on the link. Status follows the run:
 *   scheduled → SCHEDULED, in_progress / delivered → IN_PROGRESS, completed → COMPLETED;
 *   cancelled, deleted, back to draft, no date, or no worker → the job is cancelled.
 */

// WCT is in Singapore and AIMS has no per-org time zone; SGT has no DST, so the
// offset is fixed. SiteClock refuses a time without an offset.
export const SITECLOCK_TZ = 'Asia/Singapore';
const SGT_OFFSET_MS = 8 * 3600_000;

export type PushedStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface PlanRun {
  id: string;
  organizationId: string;
  deliveryNumber: number;
  status: string; // DeliveryRunStatus
  isDraft: boolean;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  siteAddress: string | null;
  notes: string | null;
  customerId: string | null;
  customerName: string | null;
  projectName: string | null;
  items: { description: string; quantity: number }[];
}

export interface PlanLink {
  workerId: string | null;
  durationMin: number;
  externalRef: string;
  generation: number;
  siteclockJobId: string | null;
  siteRef: string | null;
  syncedHash: string | null;
  lastPushedStatus: string | null;
}

export interface JobFields {
  workerId: string;
  siteRef: string;
  startAt: string;
  endAt: string;
  title: string;
  notes: string | null;
}

export type Step =
  | { kind: 'regenerate'; externalRef: string; generation: number }
  | { kind: 'putSite'; siteRef: string; name: string; address: string }
  | { kind: 'create'; fields: JobFields; hash: string }
  | { kind: 'patch'; fields: JobFields; hash: string }
  | { kind: 'status'; status: 'IN_PROGRESS' | 'COMPLETED'; at: string }
  | { kind: 'cancel'; reason: string };

export interface Plan {
  target: 'none' | PushedStatus;
  steps: Step[];
  /** Set when the run can't become a job as it stands (shown on the run, not retried blindly). */
  problem?: string;
}

/** ISO 8601 in Singapore time with its offset: 2026-11-03T10:00:00+08:00. */
export function toSgtIso(d: Date): string {
  return new Date(d.getTime() + SGT_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '+08:00');
}

export function baseExternalRef(deliveryId: string) {
  return `aims-delivery:${deliveryId}`;
}

export function externalRefFor(deliveryId: string, generation: number) {
  return generation <= 1 ? baseExternalRef(deliveryId) : `${baseExternalRef(deliveryId)}:${generation}`;
}

export function normaliseAddress(a: string) {
  return a
    .toLowerCase()
    .replace(/[.,#;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable site reference: one SiteClock site per (org, customer, address). */
export function siteRefFor(organizationId: string, customerId: string | null, address: string) {
  const h = createHash('sha256')
    .update(`${organizationId}|${customerId ?? ''}|${normaliseAddress(address)}`)
    .digest('hex');
  return `aims-site:${h.slice(0, 32)}`;
}

const hashFields = (f: JobFields) =>
  createHash('sha256')
    .update(JSON.stringify([f.workerId, f.siteRef, f.startAt, f.endAt, f.title, f.notes]))
    .digest('hex')
    .slice(0, 32);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function jobTitle(run: PlanRun) {
  const who = run.customerName || run.projectName || 'Delivery';
  return clip(`#${run.deliveryNumber} ${who}`, 200);
}

export function jobNotes(run: PlanRun): string | null {
  const lines = run.items.filter((i) => i.description.trim()).map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.description.trim()}` : i.description.trim()));
  if (run.notes?.trim()) lines.push('', run.notes.trim());
  const text = lines.join('\n').trim();
  return text ? clip(text, 2000) : null;
}

export function siteName(run: PlanRun, address: string) {
  return clip(run.customerName || run.projectName || address, 120);
}

function targetOf(run: PlanRun | null, link: PlanLink): Plan['target'] {
  if (!run || run.status === 'cancelled' || run.isDraft || !run.scheduledFor || !link.workerId) return 'none';
  if (run.status === 'completed') return 'COMPLETED';
  if (run.status === 'in_progress' || run.status === 'delivered') return 'IN_PROGRESS';
  return 'SCHEDULED';
}

const RANK: Record<string, number> = { SCHEDULED: 1, IN_PROGRESS: 2, COMPLETED: 3 };

export function planSync(run: PlanRun | null, link: PlanLink, deliveryId: string): Plan {
  const target = targetOf(run, link);
  const last = (link.lastPushedStatus as PushedStatus | null) ?? null;
  const jobLive = last === 'SCHEDULED' || last === 'IN_PROGRESS';

  if (target === 'none') {
    if (!jobLive) return { target, steps: [] };
    const reason = !run ? 'Delivery deleted in AIMS' : run.status === 'cancelled' ? 'Delivery cancelled in AIMS' : !link.workerId ? 'Worker removed in AIMS' : 'Delivery unscheduled in AIMS';
    return { target, steps: [{ kind: 'cancel', reason }] };
  }
  // A finished job is final on both sides.
  if (last === 'COMPLETED') return { target, steps: [] };

  const r = run!;
  const address = (r.siteAddress || '').trim();
  if (!address) return { target, steps: [], problem: 'The delivery has no address, so SiteClock has nowhere to put the job' };

  const steps: Step[] = [];
  let fresh = last === null;
  // SiteClock cancels are final: a run that needs a job again gets a new one under a new ref.
  if (last === 'CANCELLED') {
    const generation = link.generation + 1;
    steps.push({ kind: 'regenerate', generation, externalRef: externalRefFor(deliveryId, generation) });
    fresh = true;
  }

  const siteRef = siteRefFor(r.organizationId, r.customerId, address);
  if (fresh || siteRef !== link.siteRef) steps.push({ kind: 'putSite', siteRef, name: siteName(r, address), address });

  const start = r.scheduledFor!;
  const fields: JobFields = {
    workerId: link.workerId!,
    siteRef,
    startAt: toSgtIso(start),
    endAt: toSgtIso(new Date(start.getTime() + Math.max(5, link.durationMin) * 60_000)),
    title: jobTitle(r),
    notes: jobNotes(r),
  };
  const hash = hashFields(fields);
  if (fresh) steps.push({ kind: 'create', fields, hash });
  // Who / when / where only change while the job is still just scheduled (AIMS
  // locks a run's schedule once a rider starts it anyway).
  else if (last === 'SCHEDULED' && hash !== link.syncedHash) steps.push({ kind: 'patch', fields, hash });

  const have = fresh ? RANK.SCHEDULED : RANK[last!];
  if (RANK[target] > have) {
    if (have < RANK.IN_PROGRESS) steps.push({ kind: 'status', status: 'IN_PROGRESS', at: toSgtIso(r.startedAt ?? new Date()) });
    if (target === 'COMPLETED') steps.push({ kind: 'status', status: 'COMPLETED', at: toSgtIso(r.completedAt ?? new Date()) });
  }
  return { target, steps };
}

/** Retry delay after the n-th consecutive failure: 1, 2, 5, 15, 30 min, then hourly. */
export function backoffMs(attempts: number) {
  const mins = [1, 2, 5, 15, 30, 60];
  return mins[Math.min(Math.max(attempts, 1), mins.length) - 1] * 60_000;
}
