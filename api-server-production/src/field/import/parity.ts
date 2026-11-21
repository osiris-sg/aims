/**
 * Golden parity (FIELD_PLAN.md §5.3): recompute every closed day with the AIMS engine and compare with the numbers
 * SiteClock stored. Runs on an in-memory copy of the org's Field rows (the shadow import), so nothing is written
 * anywhere. Each entry is recomputed on its own copy; the weekly OT cap reads the other entries' stored OT, as
 * SiteClock did when it computed them.
 *
 * Expected, explainable differences (reported with a reason, not hidden):
 *   - rules or working hours changed after SiteClock computed the day (snapshot semantics: SiteClock never
 *     recomputes a closed day);
 *   - the entry was computed by an older SiteClock build (before "paid hours follow the crew", 13 Nov 2026).
 */
import { fakePrisma } from '../testing/fake-prisma';
import { FieldEngine } from '../engine/engine';

export const PARITY_FIELDS = ['grossMinutes', 'breakMinutes', 'regularMinutes', 'otMinutes', 'otMultiplier', 'lateMinutes', 'earlyMinutes', 'leftEarlyMinutes', 'needsReview', 'paidFromAt', 'paidToAt', 'workedFor'] as const;

export type ParityRows = Record<string, any[]>; // table name (fake model key) -> rows
export interface Mismatch {
  entryId: string;
  siteclockId: string | null;
  workerId: string;
  workDate: string;
  field: string;
  siteclock: unknown;
  aims: unknown;
}

const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v && typeof v === 'object' ? JSON.stringify(Object.entries(v as object).sort()) : v ?? null);

/** Load the rows into an in-memory database, recompute each closed entry, list every field that differs. */
export async function runParity(rows: ParityRows, opts: { from: string; to: string }) {
  const results: Mismatch[] = [];
  let checked = 0;
  const entries = (rows.fieldTimeEntry ?? []).filter((e) => e.clockOutAt && e.status !== 'OPEN' && e.workDate >= opts.from && e.workDate <= opts.to);
  for (const original of entries) {
    const db: any = fakePrisma();
    for (const [table, list] of Object.entries(rows)) {
      const model = db[table];
      if (!model) continue;
      model.rows = list.map((r) => ({ ...r }));
    }
    const engine = new FieldEngine(db);
    const out = await engine.computeEntry(db, original.id, original.status === 'AUTO_CLOSED' ? 'AUTO_CLOSED' : 'PENDING');
    checked++;
    for (const f of PARITY_FIELDS) {
      if (norm(original[f]) !== norm(out[f])) {
        results.push({ entryId: original.id, siteclockId: original.siteclockId ?? null, workerId: original.workerId, workDate: original.workDate, field: f, siteclock: original[f] ?? null, aims: out[f] ?? null });
      }
    }
  }
  const byField: Record<string, number> = {};
  for (const m of results) byField[m.field] = (byField[m.field] ?? 0) + 1;
  return { checked, entriesWithMismatch: new Set(results.map((m) => m.entryId)).size, byField, mismatches: results };
}
