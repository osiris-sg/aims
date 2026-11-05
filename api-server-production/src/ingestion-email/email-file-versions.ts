/**
 * Round BF (Sayaka): senders resend revised files under the SAME name ("198GX07112 BLCopyView (1).pdf" three times).
 * Pure helpers: which attachments are versions of one another (same name, or same bytes), which one is the latest,
 * and which are byte-identical; the file facts (sha256, pages) of a stored attachment, cached in memory per S3 key
 * (stored attachments never change). Display data only — nothing here files or links anything.
 */
import { createHash } from 'crypto';

/** "198GX07112 BLCopyView (1).pdf" and "198gx07112 blcopyview.PDF" are the same name: case, spaces and a trailing " (n)" copy mark don't count. */
export function versionKey(name: string | null | undefined): string {
  const n = String(name ?? '').normalize('NFKC').trim().toLowerCase();
  const m = /^(.*?)(\.[a-z0-9]{1,6})?$/.exec(n);
  const base = (m?.[1] ?? n).replace(/\s*\(\d{1,3}\)$/, '').replace(/[\s_]+/g, ' ').trim();
  return `${base}${m?.[2] ?? ''}`;
}

export type VersionInput = { id: string; name: string; date: Date | string | null; sha256?: string | null };
export type VersionMark = {
  /** Number of files in its version group (1 = no other version). */
  versions: number;
  /** The newest of its group (only meaningful when versions > 1). */
  latest: boolean;
  /** An older version: its own received time (ISO) — the badge "Older version (5/11 14:02)". */
  olderAt: string | null;
  /** Byte-identical to a newer (or the newest) file of the group: that file's id. */
  identicalTo: string | null;
};

const time = (d: Date | string | null) => (d ? new Date(d).getTime() || 0 : 0);
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/** Groups files by same name OR same content (union of both), newest first in each group. */
export function markVersions(files: VersionInput[]): Map<string, VersionMark> {
  const parent = new Map<string, string>(files.map((f) => [f.id, f.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const byName = new Map<string, string>();
  const bySha = new Map<string, string>();
  for (const f of files) {
    const k = versionKey(f.name);
    if (byName.has(k)) union(f.id, byName.get(k)!);
    else byName.set(k, f.id);
    if (f.sha256) {
      if (bySha.has(f.sha256)) union(f.id, bySha.get(f.sha256)!);
      else bySha.set(f.sha256, f.id);
    }
  }
  const groups = new Map<string, VersionInput[]>();
  for (const f of files) groups.set(find(f.id), [...(groups.get(find(f.id)) ?? []), f]);
  const out = new Map<string, VersionMark>();
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => time(b.date) - time(a.date) || a.id.localeCompare(b.id));
    sorted.forEach((f, i) => {
      const twin = f.sha256 ? sorted.find((o, j) => j < i && o.sha256 === f.sha256) : null;
      out.set(f.id, { versions: sorted.length, latest: i === 0, olderAt: i === 0 ? null : iso(f.date), identicalTo: twin?.id ?? null });
    });
  }
  return out;
}

/** pdf.js is ESM-only: a native import() (tsc would turn `import()` into require) — as trade-attach.ts. */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const esmImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

/** Pages of a PDF without rendering anything (pdf.js numPages); null when it can't be read. */
export async function pdfPages(buf: Buffer): Promise<number | null> {
  try {
    const pdfjs = await esmImport('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, isEvalSupported: false }).promise;
    const n = Number(doc.numPages);
    await doc.destroy?.();
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export type FileFacts = { sha256: string; pages: number | null; size: number };
const FACTS = new Map<string, FileFacts>();
const FACTS_MAX = 2000;

/** The cached facts of an S3 key (null = not read yet). */
export const cachedFacts = (key: string | null | undefined): FileFacts | null => (key ? FACTS.get(key) ?? null : null);

/** Facts of bytes already in hand (e.g. the triage reading the attachment's text); remembered under its S3 key. */
export async function rememberFacts(key: string, name: string, buf: Buffer, contentType?: string | null): Promise<FileFacts> {
  const have = FACTS.get(key);
  if (have) return have;
  const isPdf = /pdf/i.test(contentType ?? '') || /\.pdf$/i.test(name);
  const facts: FileFacts = { sha256: createHash('sha256').update(buf).digest('hex'), pages: isPdf ? await pdfPages(buf) : null, size: buf.length };
  if (FACTS.size >= FACTS_MAX) FACTS.delete(FACTS.keys().next().value as string);
  FACTS.set(key, facts);
  return facts;
}

/** Facts of a stored attachment: the cache, else one download. Null when the file can't be read. */
export async function attachmentFacts(download: (key: string) => Promise<Buffer>, a: { key: string; name: string; contentType?: string | null }): Promise<FileFacts | null> {
  const have = FACTS.get(a.key);
  if (have) return have;
  try {
    return await rememberFacts(a.key, a.name, await download(a.key), a.contentType);
  } catch {
    return null;
  }
}

/** Runs `fn` over `items` with at most `n` at a time (downloads for a thread's file list). */
export async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/** A name specific enough to look for across all the org's emails (a B/L / contract / CI-like token of 8+ chars with digits). */
export const distinctiveName = (name: string): boolean => /(?=[A-Z0-9-]*\d)[A-Z0-9-]{8,}/i.test(String(name ?? '').replace(/\.[a-z0-9]{1,6}$/i, ''));

/**
 * Round BF: a linked file has a NEWER version when an email received after it carries a file of the same name
 * (version key) with different bytes. Returns the newest such candidate, or null.
 */
export function newerVersionOf(
  linked: { name: string; date: Date | string | null; sha256: string | null },
  candidates: Array<{ emailId: string; index: number; name: string; date: Date | string | null; sha256: string | null }>,
) {
  const k = versionKey(linked.name);
  const after = time(linked.date);
  const hits = candidates
    .filter((c) => versionKey(c.name) === k && time(c.date) > after && (!c.sha256 || !linked.sha256 || c.sha256 !== linked.sha256))
    .sort((a, b) => time(b.date) - time(a.date));
  return hits[0] ?? null;
}
