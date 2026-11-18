// Module home pages (app/portal/components/ModuleHome). Pure helpers, tested by helpers/moduleHome.test.mjs.

/**
 * The page box. With a block under the tiles (Sales: the jobs calendar, enableJobsCalendar orgs) it is full
 * width: in the portal's flex column, mx: auto alone sizes it to its content, so the calendar's week view
 * (narrower content than the month grid) shrank the whole card (2026-11-18). Without one: as before.
 */
export function moduleHomeBoxSx(hasBlock: boolean): Record<string, unknown> {
  const base = { p: { xs: 2, md: 3 }, maxWidth: 1440, mx: "auto" };
  return hasBlock ? { ...base, width: "100%", boxSizing: "border-box" } : base;
}
