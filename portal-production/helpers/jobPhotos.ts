// Job photos from SiteClock (WCT 2026-11-02): pure helpers for the delivery and
// order pages. Tested by helpers/jobPhotos.test.mjs.

export interface JobPhoto {
  id: string;
  deliveryId: string;
  tag: string;
  tagLabel: string;
  note: string | null;
  takenAt: string | null;
  uploadedAt: string;
  workerName: string | null;
  source: "siteclock";
  url: string;
  thumbUrl: string;
  downloadUrl: string;
  urlExpiresAt: string;
}

export interface OrderJobGroup {
  deliveryId: string;
  deliveryNumber: number;
  scheduledFor: string | null;
  status: string;
  doNumber: string | null;
  photos: JobPhoto[];
}

/** Chip colour per tag: the DO evidence stands out. */
/** What a photo can be set to in the viewer (UNSORTED = sent by SiteClock with no type, 2026-11-11). */
export const PHOTO_TAG_OPTIONS: { value: string; label: string }[] = [
  { value: "UNSORTED", label: "Not sorted" },
  { value: "SIGNED_DO", label: "Signed DO" },
  { value: "STAMPED_DO", label: "Stamped DO" },
  { value: "SERVICE_REPORT", label: "Service report" },
  { value: "SITE", label: "Site" },
  { value: "OTHER", label: "Other" },
];

export const TAG_COLOR: Record<string, "success" | "info" | "default" | "warning"> = {
  UNSORTED: "warning",
  SIGNED_DO: "success",
  STAMPED_DO: "success",
  SERVICE_REPORT: "info",
  SITE: "default",
  OTHER: "default",
};

const sgTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });

/** "Ali · 2 Nov, 14:30" (taken time, else when it arrived). */
export function photoCaption(p: Pick<JobPhoto, "workerName" | "takenAt" | "uploadedAt">): string {
  const when = p.takenAt || p.uploadedAt;
  return [p.workerName || "SiteClock", when ? sgTime(when) : null].filter(Boolean).join(" · ");
}

/** The order page's group heading: "Job #11 · DO202611009 · 4 Nov". */
export function jobHeading(j: Pick<OrderJobGroup, "deliveryNumber" | "doNumber" | "scheduledFor">): string {
  const day = j.scheduledFor ? new Date(j.scheduledFor).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Singapore" }) : null;
  return [`Job #${j.deliveryNumber}`, j.doNumber, day].filter(Boolean).join(" · ");
}

/** The presigned URLs are about to lapse (they last 15 minutes): fetch the list again before opening one. */
export const urlsStale = (photos: Pick<JobPhoto, "urlExpiresAt">[], now = Date.now()) =>
  photos.some((p) => new Date(p.urlExpiresAt).getTime() - now < 60_000);

/** "SiteClock · Ali" caption for a verification photo that came from SiteClock, else null. */
export function siteclockEvidenceCaption(key: string, siteclockPhotos?: Array<{ key: string; workerName: string | null }> | null): string | null {
  const p = (siteclockPhotos ?? []).find((x) => x.key === key);
  return p ? `SiteClock${p.workerName ? ` · ${p.workerName}` : ""}` : null;
}
