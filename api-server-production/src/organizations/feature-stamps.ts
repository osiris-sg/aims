/**
 * Round AZ — flags that remember the day they were switched on. enableStepDueDates: due dates before that day are
 * shown without the overdue badge and aren't tasks (no backlog flood), so the save that turns the flag on stamps
 * features.stepDueDatesSince (Tokyo day). A save that leaves the flag on keeps the stamp; off → on stamps a new day.
 * Pure: no Prisma, no Nest.
 */
import { tradeToday } from '../shipments/shipments.rules';

export function withFeatureStamps(prev: unknown, next: unknown, now: Date = new Date()): unknown {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return next;
  const p = (prev && typeof prev === 'object' ? prev : {}) as Record<string, unknown>;
  const n = { ...(next as Record<string, unknown>) };
  if (n.enableStepDueDates === true) {
    if (p.enableStepDueDates !== true) n.stepDueDatesSince = tradeToday(now);
    else if (n.stepDueDatesSince === undefined && p.stepDueDatesSince !== undefined) n.stepDueDatesSince = p.stepDueDatesSince;
  } else if (n.stepDueDatesSince === undefined && p.stepDueDatesSince !== undefined) n.stepDueDatesSince = p.stepDueDatesSince;
  return n;
}
