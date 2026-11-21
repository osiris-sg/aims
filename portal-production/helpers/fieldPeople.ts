// Field phase 1 (workers, teams, sites, invites): pure helpers for the pages. Labels follow SiteClock's office
// web (web/src/pages/Workers.tsx, Teams.tsx, Sites.tsx @62b7d9d) in AIMS wording.

export const TIER_LABEL: Record<string, string> = { WORKER: "Worker", SUPERVISOR: "Supervisor", COMPANY_ADMIN: "Admin" };

/** Per-worker rule choices; "" = the company rule. */
export const RULE_OPTIONS = {
  jobClocking: [
    { value: "", label: "Company rule" },
    { value: "OFF", label: "Clock in at the first job, out at the last" },
    { value: "ARRIVE", label: "Clock in at each job" },
    { value: "ARRIVE_LEAVE", label: "Clock in and out at each job" },
  ],
  offSiteClocking: [
    { value: "", label: "Company rule" },
    { value: "REVIEW", label: "Hold for review" },
    { value: "MARK", label: "Mark only" },
    { value: "BLOCK", label: "Must be inside the site" },
  ],
  selfiePolicy: [
    { value: "", label: "Company rule" },
    { value: "SMART", label: "Only when something needs checking" },
    { value: "ALWAYS", label: "Every clock in and out" },
  ],
  baseClocking: [
    { value: "", label: "Company rule" },
    { value: "ALLOWED", label: "May clock at a base" },
    { value: "NOT_ALLOWED", label: "May not clock at a base" },
  ],
} as const;

export interface FieldWorkerRow {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
  userId: string | null;
  tier: string;
  employeeNo: string | null;
  overrides: Record<string, any>;
  device: { bound: boolean; boundAt: string | null };
  photo: { hasPhoto: boolean; verifyRequested: boolean; update: { id: string; status: string } | null };
  sites: Array<{ siteId: string; name: string; isSupervisor: boolean }>;
  trades: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
}

/** The short badges a worker row shows for the rules set on them (SiteClock's Workers list badges). */
export function ruleBadges(o: Record<string, any>): string[] {
  const out: string[] = [];
  if (o.selfiePolicy === "ALWAYS") out.push("Selfie every punch");
  if (o.selfiePolicy === "SMART") out.push("Selfie when needed");
  if (o.offSiteClocking === "BLOCK") out.push("Inside the site only");
  if (o.offSiteClocking === "MARK") out.push("Off-site marked");
  if (o.jobClocking) out.push(`Job clocking ${o.jobClocking === "OFF" ? "off" : o.jobClocking === "ARRIVE" ? "arrive" : "arrive and leave"}`);
  if (o.baseClocking === "NOT_ALLOWED") out.push("No base");
  if (o.payFollowsCrew) out.push("Pay follows crew");
  if (o.attendanceExempt) out.push("No clock-in needed");
  if (o.payslipVisible) out.push("Payslip visible");
  if (o.sharedWithLinked) out.push("Shared");
  return out;
}

/** Search over name, employee no, phone, team and site names; hidden workers only when asked. */
export function filterWorkers(rows: FieldWorkerRow[], q: string, showHidden: boolean): FieldWorkerRow[] {
  const s = q.trim().toLowerCase();
  return rows.filter((w) => {
    if (!showHidden && !w.active) return false;
    if (!s) return true;
    const hay = [w.name, w.employeeNo, w.phone, ...w.teams.map((t) => t.name), ...w.sites.map((x) => x.name)].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(s);
  });
}

/** The PATCH body for the worker dialog: only what changed; "" back to the company rule. */
export function workerPatch(before: Record<string, any>, after: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(after)) {
    const b = before[k] ?? (typeof v === "boolean" ? false : "");
    const a = v ?? "";
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = v === null ? "" : v;
  }
  return out;
}

export const SITE_KIND_LABEL: Record<string, string> = { PERMANENT: "Site", BASE: "Base", JOB: "Job place" };

/** Number fields of the site form with SiteClock's ranges (sites.router siteSchema). */
export const SITE_LIMITS = {
  radiusM: { min: 20, max: 5000, def: 150 },
  maxAccuracyM: { min: 10, max: 500, def: 50 },
  autoCloseAfterH: { min: 1, max: 48, def: 14 },
} as const;

export function siteFormErrors(f: { name: string; lat: string | number; lng: string | number; radiusM: number; maxAccuracyM: number; autoCloseAfterH: number }): string | null {
  if (!String(f.name).trim()) return "Give the site a name";
  const lat = Number(f.lat);
  const lng = Number(f.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || String(f.lat).trim() === "") return "Pick the place from the search, or enter a latitude";
  if (!Number.isFinite(lng) || lng < -180 || lng > 180 || String(f.lng).trim() === "") return "Enter a longitude";
  for (const [k, r] of Object.entries(SITE_LIMITS)) {
    const v = Number((f as any)[k]);
    if (!Number.isInteger(v) || v < r.min || v > r.max) return `${k === "radiusM" ? "Radius" : k === "maxAccuracyM" ? "GPS accuracy" : "Auto-close"} must be ${r.min} to ${r.max}`;
  }
  return null;
}

/** An invite's state for the list. */
export function inviteState(i: { active: boolean; expiresAt: string | null; maxUses: number | null; uses: number }, now = new Date()): "Active" | "Off" | "Expired" | "Used up" {
  if (!i.active) return "Off";
  if (i.expiresAt && new Date(i.expiresAt) < now) return "Expired";
  if (i.maxUses != null && i.uses >= i.maxUses) return "Used up";
  return "Active";
}
