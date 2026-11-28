// app_help: AIMEE's manual, looked up instead of carried (guru 2026-11-28: "your test cost me $3").
//
// The whole of app-knowledge.ts (~600,000 characters, about 80% of the prompt) rode on EVERY model
// call. A dozen calls cost $3, almost none of it for the answers. Now the prompt carries only a
// TOPIC INDEX (one short heading per entry) and AIMEE fetches the passages it needs with this
// tool. The knowledge file itself is unchanged and stays the single source: nothing is copied.
//
// Entries are the file's own lines ("NAME (context): what it does…"), under its "=== SECTION ==="
// headings. A long entry is cut into passages at sentence ends, each carrying its entry's heading,
// so one 37,000-character entry does not come back whole for a one-line question.

import { APP_KNOWLEDGE } from '../guide/app-knowledge';

export interface HelpPassage { section: string; heading: string; text: string; entry: number }

const PASSAGE = 1400; // characters per passage, cut at a sentence end
const STOP = new Set('the and for with that this from are was were not you your can how does what when where which who why will has have had its into out all any but one use used using get set per via also then than them they there here onto over under about after before more most some such each'.split(' '));

/** Words worth matching on: 3+ letters / digits, lower-cased, no filler, plural "s" dropped. */
export function helpTokens(text: unknown): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? '').toLowerCase().split(/[^a-z0-9/]+/)) {
    const w = raw.replace(/^\/+|\/+$/g, '');
    if (w.length < 3 || STOP.has(w)) continue;
    out.push(w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  }
  return Array.from(new Set(out));
}

/** The short name of an entry: its text up to the first ":" (or 110 characters). */
export function headingOf(entry: string): string {
  const t = entry.replace(/^[-•\s]+/, '');
  const colon = t.search(/:\s/);
  const head = colon > 0 && colon <= 150 ? t.slice(0, colon) : t.slice(0, 110);
  return head.replace(/\s+/g, ' ').trim().slice(0, 150);
}

function cut(text: string): string[] {
  if (text.length <= PASSAGE * 1.3) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > PASSAGE * 1.3) {
    // the last sentence end before the limit; a hard cut only when the text has none
    const win = rest.slice(0, PASSAGE);
    const at = Math.max(win.lastIndexOf('. '), win.lastIndexOf('; '), win.lastIndexOf('): '));
    const end = at > PASSAGE * 0.5 ? at + 1 : PASSAGE;
    parts.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function buildHelp(knowledge: string) {
  const passages: HelpPassage[] = [];
  const index: string[] = [];
  let section = 'GENERAL';
  let entry = 0;
  for (const line of knowledge.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const sec = t.match(/^===\s*(.+?)\s*===$/);
    if (sec) { section = sec[1]; index.push(`\n[${section}]`); continue; }
    entry++;
    const heading = headingOf(t);
    index.push(`- ${heading}`);
    for (const text of cut(t)) passages.push({ section, heading, text, entry });
  }
  const tokens = passages.map((p) => ({ body: new Set(helpTokens(p.text)), head: new Set(helpTokens(`${p.heading} ${p.section}`)) }));
  // How rare a word is across passages: a word in every passage ("invoice") counts for little.
  const df = new Map<string, number>();
  for (const t of tokens) for (const w of t.body) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w: string) => Math.log(1 + passages.length / (1 + (df.get(w) || 0)));

  function search(query: string, opts: { maxChars?: number } = {}) {
    const q = helpTokens(query);
    if (!q.length) return { passages: [] as HelpPassage[], words: q };
    const phrase = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const scored = passages
      .map((p, i) => {
        let s = 0;
        for (const w of q) {
          if (tokens[i].head.has(w)) s += 3 * idf(w);
          else if (tokens[i].body.has(w)) s += idf(w);
        }
        if (phrase.length >= 6 && p.text.toLowerCase().includes(phrase)) s += 6;
        return { p, i, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i);
    const max = Math.min(Math.max(opts.maxChars || 9000, 2000), 20000);
    const out: HelpPassage[] = [];
    let used = 0;
    for (const x of scored) {
      // Far weaker than the best match: noise.
      if (out.length >= 3 && x.s < scored[0].s * 0.35) break;
      if (used + x.p.text.length > max && out.length) break;
      out.push(x.p);
      used += x.p.text.length;
      if (out.length >= 12) break;
    }
    return { passages: out, words: q };
  }
  return { index: index.join('\n').trim(), passages, search };
}

const HELP = buildHelp(APP_KNOWLEDGE);

/** The topic index carried in AIMEE's prompt in place of the whole manual. */
export const APP_HELP_INDEX = HELP.index;

/** The tool: the manual passages that answer a question about how AIMS works. */
export function appHelp(args: { query?: string; maxChars?: number }) {
  const query = String(args?.query || '').trim();
  if (!query) return { error: 'Give the question, or the screen / feature / button it is about, in a few words.' };
  const r = HELP.search(query, { maxChars: args?.maxChars });
  if (!r.passages.length) {
    return { query, found: 0, note: 'Nothing in the manual matches these words. Search again with the words the topic index uses for it, or the screen name. Do not answer how AIMS works from memory.' };
  }
  return {
    query,
    found: r.passages.length,
    passages: r.passages.map((p) => ({ section: p.section, topic: p.heading, text: p.text })),
    note: 'These are passages of the AIMS manual. Answer from them. If the answer is not in them, search again with other words before saying the app cannot do it.',
  };
}
