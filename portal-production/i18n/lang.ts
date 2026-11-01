// Round AZ — the portal language (EN / 日本語) and its date / number formats. Pure: no React, no imports (node --test). The provider (UiLangProvider) sets the current
// language here so plain formatters (dates, numbers) can follow it without threading `lang` through every call;
// switching the language remounts the page, so everything re-renders with the new value.

export type UiLang = "en" | "ja";
export const UI_LANGS: readonly UiLang[] = ["en", "ja"];
export const isUiLang = (v: unknown): v is UiLang => v === "en" || v === "ja";

let current: UiLang = "en";
export const currentLang = (): UiLang => current;
export const setCurrentLang = (l: UiLang) => {
  current = l;
};

// Round AZ — dates and numbers in the portal language. English: "31 Oct 2026", "1,234.50"; Japanese: "2026/10/31",
// "¥1,234" for yen. Calendar dates (ETD / ETA, stored as UTC midnight) are read in UTC so they never shift a day.
// Pure: the language is the current one (or an explicit argument).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const valid = (d?: string | Date | null) => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return isNaN(x.getTime()) ? null : x;
};

/** A calendar day (UTC): "05 Oct 2026" / "2026/10/05". */
export function formatDay(d?: string | Date | null, lang: UiLang = currentLang()): string {
  const x = valid(d);
  if (!x) return "—";
  return lang === "ja" ? `${x.getUTCFullYear()}/${pad(x.getUTCMonth() + 1)}/${pad(x.getUTCDate())}` : `${pad(x.getUTCDate())} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}

/** A timestamp's day in local time. */
export function formatDate(d?: string | Date | null, lang: UiLang = currentLang()): string {
  const x = valid(d);
  if (!x) return "—";
  return lang === "ja" ? `${x.getFullYear()}/${pad(x.getMonth() + 1)}/${pad(x.getDate())}` : `${pad(x.getDate())} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}

export function formatDateTime(d?: string | Date | null, lang: UiLang = currentLang()): string {
  const x = valid(d);
  if (!x) return "—";
  return `${formatDate(x, lang)}${lang === "ja" ? " " : ", "}${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/** "2026-10" → "Oct 2026" / "2026年10月". */
export function formatMonth(m?: string | null, lang: UiLang = currentLang()): string {
  const r = /^(\d{4})-(\d{2})$/.exec(m || "");
  if (!r) return m || "—";
  return lang === "ja" ? `${r[1]}年${Number(r[2])}月` : `${MONTHS[Number(r[2]) - 1]} ${r[1]}`;
}

/** A short day without the year when it's this year: "5 Oct" / "10/5". */
export function formatShortDay(ymd?: string | null, thisYear?: string, lang: UiLang = currentLang()): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return "";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  const withYear = !!thisYear && y !== thisYear;
  return lang === "ja" ? `${withYear ? `${y}/` : ""}${Number(m)}/${Number(d)}` : `${Number(d)} ${MONTHS[Number(m) - 1]}${withYear ? ` ${y}` : ""}`;
}

/** Money: 2 decimals; yen in Japanese shows as ¥ with no decimals. */
export function formatMoney(v: number | string | null | undefined, currency?: string | null, lang: UiLang = currentLang()): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (currency === "JPY" && lang === "ja") return `¥${Math.round(n).toLocaleString("ja-JP")}`;
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
}
