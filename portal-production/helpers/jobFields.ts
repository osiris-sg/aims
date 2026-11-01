// Custom job fields (2026-11-01, flag enableJobFields). Pure helpers for the
// Settings → Job fields screen, the job form editor and the calendar badges;
// tested by helpers/jobFields.test.mjs. Mirrors
// api-server-production/src/deliveries/job-fields.ts.

export type JobFieldType = "boolean" | "text" | "date" | "file" | "url";

export interface JobFieldDisplay {
  showOnCalendar?: boolean;
  icon?: string | null;
  colourByValue?: Record<string, string> | null;
  colour?: string | null;
}

export interface JobFieldDef {
  id: string;
  fieldName: string;
  displayLabel: string;
  fieldType: JobFieldType | string;
  required?: boolean;
  sortOrder?: number | null;
  display?: JobFieldDisplay | null;
}

export interface FileValue {
  fileKey: string;
  fileName: string;
  mimeType?: string;
}

export const JOB_FIELD_TYPE_LABEL: Record<JobFieldType, string> = {
  boolean: "Yes / no",
  text: "Text",
  date: "Date",
  file: "File upload",
  url: "Link",
};

export const JOB_FIELD_TYPES = Object.keys(JOB_FIELD_TYPE_LABEL) as JobFieldType[];

export const ICON_LABEL: Record<string, string> = {
  permit: "Permit",
  verified: "Approved",
  warning: "Warning",
  lock: "Lock",
  key: "Key",
  build: "Tools",
  event: "Date",
  description: "Document",
  link: "Link",
  flag: "Flag",
  star: "Star",
  info: "Info",
  person: "Person",
  phone: "Phone",
  camera: "Camera",
  block: "Blocked",
};

export const COLOUR_CHOICES = ["#2e7d32", "#ef6c00", "#c62828", "#1565c0", "#6a1b9a", "#546e7a"];

/** The value as words (Yes / No / text / date / file name). */
export function jobFieldText(type: string, value: any): string {
  if (value === null || value === undefined || value === "") return "";
  if (type === "boolean") return value === true ? "Yes" : "No";
  if (type === "file") return String(value?.fileName || "File");
  return String(value);
}

/** Problem with a value as typed in the form (null = fine). Required fields are only checked on a real schedule. */
export function jobFieldProblem(f: JobFieldDef, value: any, opts: { checkRequired: boolean }): string | null {
  const empty = value === null || value === undefined || value === "";
  if (empty) return opts.checkRequired && f.required ? `${f.displayLabel} is required` : null;
  if (f.fieldType === "url" && !/^https?:\/\/\S+$/i.test(String(value))) return `${f.displayLabel}: a link starting with https://`;
  if (f.fieldType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${f.displayLabel}: pick a date`;
  return null;
}

/** Only the fields that changed, ready for the API ({ fieldId: value | null }). */
export function changedValues(before: Record<string, any>, after: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(after)) {
    const norm = v === "" || v === undefined ? null : v;
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(norm)) out[k] = norm;
  }
  return out;
}

/**
 * The settings form's display block: boolean fields get a colour for Yes and
 * (optionally) for No; the other types one colour when the field has a value.
 */
export function displayFromForm(type: string, form: { showOnCalendar: boolean; icon: string; yesColour?: string | null; noColour?: string | null; colour?: string | null }): JobFieldDisplay {
  if (!form.showOnCalendar) return { showOnCalendar: false, icon: form.icon || null };
  if (type === "boolean") {
    const m: Record<string, string> = {};
    if (form.yesColour) m.true = form.yesColour;
    if (form.noColour) m.false = form.noColour;
    return { showOnCalendar: true, icon: form.icon || null, colourByValue: m };
  }
  return { showOnCalendar: true, icon: form.icon || null, colour: form.colour || COLOUR_CHOICES[5] };
}

/** "On the calendar: green when yes, red when no" — the settings list's summary line. */
export function displaySummary(f: JobFieldDef): string {
  const d = f.display || {};
  if (!d.showOnCalendar) return "Not on the calendar";
  const name = (c: string) => ({ "#2e7d32": "green", "#ef6c00": "orange", "#c62828": "red", "#1565c0": "blue", "#6a1b9a": "purple", "#546e7a": "grey" } as Record<string, string>)[c.toLowerCase()] || c;
  if (f.fieldType === "boolean") {
    const parts: string[] = [];
    if (d.colourByValue?.true) parts.push(`${name(d.colourByValue.true)} when yes`);
    if (d.colourByValue?.false) parts.push(`${name(d.colourByValue.false)} when no`);
    return parts.length ? `On the calendar: ${parts.join(", ")}` : "On the calendar (no colour picked: not shown)";
  }
  return `On the calendar: ${name(d.colour || "#546e7a")} when filled in`;
}
