// WCT jobs calendar add (2026-11-04, enableWctOrders + enableJobsCalendar): quick jobs, notes, PTW and "Link to…".
// Pure helpers, tested by helpers/calendarAdd.test.mjs. The server rules live in
// api-server-production/src/deliveries/quick-jobs.ts.

export type PtwStatus = "NOT_NEEDED" | "REQUIRED" | "SUBMITTED" | "APPROVED";
export const PTW_OPTIONS: { value: PtwStatus; label: string }[] = [
  { value: "NOT_NEEDED", label: "Not needed" },
  { value: "REQUIRED", label: "Required" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "APPROVED", label: "Approved" },
];
export const ptwLabel = (s: string | null | undefined) => PTW_OPTIONS.find((o) => o.value === (s || "NOT_NEEDED"))?.label ?? String(s);

/** PTW badge colour: needs action (amber), sent (blue), done (green). */
export const PTW_COLOR: Record<Exclude<PtwStatus, "NOT_NEEDED">, string> = { REQUIRED: "#ef6c00", SUBMITTED: "#1565c0", APPROVED: "#2e7d32" };
export const ptwColor = (s: string | null | undefined) => (s && s in PTW_COLOR ? PTW_COLOR[s as keyof typeof PTW_COLOR] : "#757575");

export type NoteType = "LEAVE" | "PTW" | "BLOCKAGE" | "OTHER";
export const NOTE_TYPES: { value: NoteType; label: string; color: string }[] = [
  { value: "LEAVE", label: "Leave", color: "#8e24aa" },
  { value: "PTW", label: "PTW", color: "#ef6c00" },
  { value: "BLOCKAGE", label: "Blockage", color: "#c62828" },
  { value: "OTHER", label: "Other", color: "#546e7a" },
];
export const noteType = (t: string) => NOTE_TYPES.find((n) => n.value === t) ?? NOTE_TYPES[3];

export interface CalendarNote {
  id: string;
  title: string;
  type: string;
  staffId: string | null;
  staffName: string | null;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  remark: string | null;
}

const addDay = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "09:00–12:00 Road closed · Ali" (time only on a timed note, staff when set). */
export function noteTitle(n: Pick<CalendarNote, "title" | "allDay" | "startTime" | "endTime" | "staffName">): string {
  const time = !n.allDay && n.startTime && n.endTime ? `${n.startTime}–${n.endTime} ` : "";
  return `${time}${n.title}${n.staffName ? ` · ${n.staffName}` : ""}`;
}

/**
 * A note as a FullCalendar event: always an all-day bar (end exclusive, so +1 day), coloured by type, ordered
 * before the jobs of each day (displayOrder 0; jobs are 1).
 */
export function noteToCalendarInput(n: CalendarNote) {
  const color = noteType(n.type).color;
  return {
    id: `note:${n.id}`,
    title: noteTitle(n),
    start: n.startDate,
    end: addDay(n.endDate, 1),
    allDay: true,
    backgroundColor: color,
    borderColor: color,
    textColor: "#ffffff",
    classNames: ["aims-jc-event", "aims-jc-note"],
    displayOrder: 0,
    extendedProps: { note: n },
  };
}

/** "Sat, 9 Dec" … for the note card; one day or a range. */
export function noteWhen(n: Pick<CalendarNote, "startDate" | "endDate" | "allDay" | "startTime" | "endTime">): string {
  const fmt = (d: string) => new Intl.DateTimeFormat("en-SG", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00Z`));
  const days = n.startDate === n.endDate ? fmt(n.startDate) : `${fmt(n.startDate)} to ${fmt(n.endDate)}`;
  return n.allDay || !n.startTime || !n.endTime ? `${days} · All day` : `${days} · ${n.startTime} to ${n.endTime}`;
}

/** A Singapore date + time as an ISO instant ("2026-12-09", "10:00" → "2026-12-09T02:00:00.000Z"). */
export function sgtInstant(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const t = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** An ISO instant → its Singapore date and time ("yyyy-MM-dd", "HH:mm"). */
export function sgtParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}

/** What a click on the calendar gives: the day, and the time when a week / day slot was clicked. */
export function slotOf(dateStr: string, allDay: boolean): { date: string; time: string } {
  const date = dateStr.slice(0, 10);
  if (allDay) return { date, time: "09:00" };
  const m = /T(\d{2}):(\d{2})/.exec(dateStr);
  return { date, time: m ? `${m[1]}:${m[2]}` : "09:00" };
}

export interface QuickJobForm {
  customerId: string | null;
  siteAddress: string;
  date: string;
  time: string;
  /** "No specific time" (all-day job, 2026-11-10): the date only; time and duration are not sent. */
  allDay?: boolean;
  durationMin: number;
  workers: { id: string; name: string }[];
  remarks: string;
  ptwStatus: PtwStatus;
  ptwRemark: string;
}

/** The form → the API body, or a message saying what is missing. */
export function quickJobBody(f: QuickJobForm): { body?: Record<string, any>; error?: string } {
  if (!f.customerId) return { error: "Pick a customer" };
  const allDay = !!f.allDay;
  const scheduledFor = allDay ? (/^\d{4}-\d{2}-\d{2}$/.test(f.date) ? f.date : null) : sgtInstant(f.date, f.time);
  if (!scheduledFor) return { error: allDay ? "Pick a date" : "Pick a date and time" };
  return {
    body: {
      customerId: f.customerId,
      siteAddress: f.siteAddress.trim(),
      scheduledFor,
      ...(allDay ? { allDay: true } : { durationMin: f.durationMin }),
      workers: f.workers,
      remarks: f.remarks.trim(),
      ptwStatus: f.ptwStatus,
      ptwRemark: f.ptwStatus === "NOT_NEEDED" ? "" : f.ptwRemark.trim(),
    },
  };
}

export interface NoteForm {
  title: string;
  type: NoteType;
  staffId: string | null;
  staffName: string | null;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  remark: string;
}

export function noteBody(f: NoteForm): { body?: Record<string, any>; error?: string } {
  if (!f.title.trim()) return { error: "Give the note a title" };
  if (!f.startDate) return { error: "Pick a start date" };
  const endDate = f.endDate || f.startDate;
  if (endDate < f.startDate) return { error: "The end date is before the start date" };
  if (!f.allDay && (!f.startTime || !f.endTime || f.endTime <= f.startTime)) return { error: "Pick a start and end time (end after start)" };
  return {
    body: {
      title: f.title.trim(),
      type: f.type,
      staffId: f.staffId,
      staffName: f.staffName?.trim() || null,
      startDate: f.startDate,
      endDate,
      allDay: f.allDay,
      ...(f.allDay ? {} : { startTime: f.startTime, endTime: f.endTime }),
      remark: f.remark.trim(),
    },
  };
}

export type LinkKind = "quotation" | "order" | "invoice" | "do";
export const LINK_KINDS: { value: LinkKind; label: string; documentTypes?: string[] }[] = [
  { value: "quotation", label: "Quotation", documentTypes: ["QUOTATION"] },
  { value: "order", label: "Order" },
  { value: "invoice", label: "Invoice", documentTypes: ["INVOICE"] },
  { value: "do", label: "DO", documentTypes: ["DELIVERY_ORDER"] },
];
