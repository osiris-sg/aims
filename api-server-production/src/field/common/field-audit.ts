/**
 * Field writes land in the Activity Log through the global interceptor. The ported SiteClock audit
 * action (WORKER_CREATE, TEAM_MEMBERS_ADD, ...) and its before / after go in the row's result, so
 * the Field audit viewer can show the same history SiteClock kept (backend/src/lib/audit.ts).
 */
export function fieldAudit(req: any, action: string, extra: { entity?: string; entityId?: string | null; before?: unknown; after?: unknown } = {}) {
  if (!req) return;
  req.actionLogResult = { fieldAction: action, ...extra };
}
