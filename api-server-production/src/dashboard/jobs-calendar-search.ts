/**
 * Jobs calendar search (WCT group, enableGroupCalendar, 2026-11-23): every job and note of the companies the
 * calendar shows, any date. One query per company: customer, site, subject (its quotation's), remarks, job no.,
 * QO / Order / DO / Invoice nos. (the order's links), team / crew and job fields (the job's custom values), the
 * assigned SiteClock worker. Results: upcoming first (nearest first), then past (most recent first), 20 at most.
 */
import { withSingapore } from '../common/sg-address';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { jobStyleValues } from '../deliveries/job-style';
import { CALENDAR_TZ } from './jobs-calendar';
import { addDays, lastOccurrence, occurrences } from './recurrence';

/**
 * Repeating jobs / notes (2026-11-25): a series' template is found like any job / note and shown on its next
 * occurrence from today (else its last), with the occurrence id the calendar draws ("<id>~<yyyyMMdd>").
 */
export function seriesHitDate(rrule: string, anchor: string, exdates: string[], today: string): string | null {
  try {
    const next = occurrences(rrule, anchor, today < anchor ? anchor : today, addDays(today < anchor ? anchor : today, 800), exdates)[0];
    return next ?? lastOccurrence(rrule, anchor);
  } catch {
    return null;
  }
}

export const SEARCH_LIMIT = 20;
const PER_ORG = 200;

export interface CalendarSearchHit {
  kind: 'job' | 'note';
  /** The calendar's own id: "aims:<job id>" for a job (what the side panel opens), the note's id for a note. */
  id: string;
  orgId: string;
  orgName: string;
  /** yyyy-MM-dd in Singapore. */
  date: string;
  /** "10am", "2:30pm"; null = all day. */
  time: string | null;
  /** ISO instant used for the order (jobs: scheduledFor; notes: their first day). */
  at: string;
  customer: string | null;
  address: string | null;
  /** ❌ cancelled, ⭕ postponed, ✅ done, 📌 sticker, 🟫 COD (as on the calendar). */
  icons: string;
  /** Jobs: "#12 · ORD… "; notes: the note's title. */
  label: string;
}

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hm = (d: Date) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};
export const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

/** Upcoming first (nearest first), then past (most recent first). `today` = yyyy-MM-dd in Singapore. */
export function orderHits(hits: CalendarSearchHit[], today: string): CalendarSearchHit[] {
  const up = hits.filter((h) => h.date >= today).sort((a, b) => a.at.localeCompare(b.at));
  const past = hits.filter((h) => h.date < today).sort((a, b) => b.at.localeCompare(a.at));
  return [...up, ...past];
}

export function jobIcons(r: { status: string }, meta: { postponed?: boolean; sticker?: boolean; cod?: boolean } | undefined): string {
  const out: string[] = [];
  if (r.status === 'completed') out.push('✅');
  if (r.status === 'cancelled') out.push('❌');
  else if (meta?.postponed) out.push('⭕');
  if (meta?.sticker) out.push('📌');
  if (meta?.cod) out.push('🟫');
  return out.join(' ');
}

/** One company's matching jobs and notes. */
export async function searchOrg(prisma: any, org: { id: string; name: string }, q: string): Promise<CalendarSearchHit[]> {
  const like = likeOf(q);
  const num = /^#?\d{1,7}$/.test(q) ? Number(q.replace('#', '')) : null;
  const jobs: any[] = await runAsOrg(org.id, () =>
    prisma.$queryRaw`
      SELECT d.id::text AS id, d."deliveryNumber" AS no, d."scheduledFor" AS at, d."scheduledAllDay" AS "allDay", d.status::text AS status,
             d."siteAddress" AS address, c.name AS customer, o."orderNumber" AS "orderNumber"
      FROM "Delivery" d
      LEFT JOIN "Customer" c ON c.id = d."customerId"
      LEFT JOIN "Order" o ON o.id = d."orderId"
      LEFT JOIN "Document" q ON q.id = COALESCE(o."sourceQuotationId", d."sourceQuotationId")
      LEFT JOIN "DeliverySiteClockJob" sc ON sc."deliveryId" = d.id::text
      LEFT JOIN LATERAL (SELECT string_agg(v.value::text, ' ') AS txt FROM "CustomFieldValue" v WHERE v."entityId" = d.id::text) f ON true
      LEFT JOIN LATERAL (SELECT string_agg(doc.name, ' ') AS names FROM "DeliveryItem" di JOIN "Document" doc ON doc.id = di."documentId" WHERE di."deliveryId" = d.id) dos ON true
      WHERE d."organizationId" = ${org.id} AND d."scheduledFor" IS NOT NULL
        AND (d."isDraft" = false OR EXISTS (SELECT 1 FROM "CalendarSeries" cs WHERE cs."organizationId" = ${org.id} AND cs."templateId" = d.id::text))
        AND (
          ${num}::int = d."deliveryNumber"
          OR concat_ws(' ', c.name, d."siteAddress", d.notes, o."orderNumber", o."linkedDocuments"::text, q.name,
                       q.config ->> 'subject', q.config #>> '{documentInfo,subject}', dos.names, f.txt, sc."workerName") ILIKE ${like} ESCAPE '\\'
        )
      ORDER BY d."scheduledFor" DESC
      LIMIT ${PER_ORG}`,
  );
  const meta = await jobStyleValues(prisma, org.id, jobs.map((j) => j.id));
  let series: any[] = [];
  try {
    series = (await runAsOrg(org.id, async () => ((prisma as any).calendarSeries ? (prisma as any).calendarSeries.findMany({ where: { organizationId: org.id } }) : []))) ?? [];
  } catch {
    series = [];
  }
  const seriesOf = new Map((series ?? []).map((x: any) => [String(x.templateId), x]));
  const today = ymd(new Date());
  const notes: any[] = await runAsOrg(org.id, () =>
    prisma.$queryRaw`
      SELECT n.id, n.title, n."staffName" AS staff, n."startDate" AS start, n."endDate" AS "end", n."allDay" AS "allDay", n."startTime" AS "startTime"
      FROM "CalendarNote" n
      WHERE n."organizationId" = ${org.id}
        AND concat_ws(' ', n.title, n."staffName", n.remark) ILIKE ${like} ESCAPE '\\'
      ORDER BY n."startDate" DESC
      LIMIT ${PER_ORG}`,
  );
  return [
    ...jobs.map((j) => {
      let at = new Date(j.at);
      const sr = seriesOf.get(String(j.id));
      let id = `aims:${j.id}`;
      if (sr) {
        const day = seriesHitDate(sr.rrule, ymd(at), sr.exdates ?? [], today);
        if (day) {
          at = new Date(`${day}T${j.allDay ? '00:00' : new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)}:00+08:00`);
          id = `aims:${j.id}~${day.replace(/-/g, '')}`;
        }
      }
      return {
        kind: 'job' as const,
        id,
        orgId: org.id,
        orgName: org.name,
        date: ymd(at),
        time: j.allDay ? null : hm(at),
        at: at.toISOString(),
        // Shop name (2026-11-24) first, else the customer.
        customer: meta.get(j.id)?.shopName || j.customer || null,
        address: j.address ? withSingapore(j.address) : null,
        icons: jobIcons(j, meta.get(j.id)),
        // Job title (2026-11-24) first; the style values (f.txt) already make it searchable.
        label: [meta.get(j.id)?.jobTitle, sr ? 'Repeats' : `#${j.no}`, j.orderNumber].filter(Boolean).join(' · '),
      };
    }),
    ...notes.map((n) => {
      const sr = seriesOf.get(String(n.id));
      const day = sr ? seriesHitDate(sr.rrule, String(n.start), sr.exdates ?? [], today) : null;
      const start = day ?? String(n.start);
      return {
        kind: 'note' as const,
        id: day ? `${n.id}~${day.replace(/-/g, '')}` : String(n.id),
        orgId: org.id,
        orgName: org.name,
        date: start,
        time: !n.allDay && n.startTime ? String(n.startTime) : null,
        at: new Date(`${start}T${!n.allDay && n.startTime ? n.startTime : '00:00'}:00+08:00`).toISOString(),
        customer: null,
        address: null,
        icons: '',
        label: [n.title, n.staff, sr ? 'Repeats' : null].filter(Boolean).join(' · '),
      };
    }),
  ];
}
