/**
 * Japanese-capable font for in-app trade documents (請求書, 出荷指示 …).
 *
 * Puppeteer on the server has no CJK fonts, so kanji/kana would print as
 * tofu boxes. Noto Sans JP (OFL, @fontsource/noto-sans-jp) is split into
 * ~120 unicode-range chunks per weight; we embed ONLY the chunks whose ranges
 * cover characters actually present in the document, as base64 data: URIs —
 * typically a few hundred KB instead of ~4 MB per weight. The same CSS works
 * in the live preview iframe and in the PDF.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';

export const DOC_FONT_FAMILY = 'Noto Sans JP';
/** CSS font stack: the embedded font first; OS Japanese fonts only as a last resort. */
export const DOC_FONT_STACK = `'${DOC_FONT_FAMILY}', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, sans-serif`;

type Chunk = { weight: number; file: string; rangeCss: string; ranges: Array<[number, number]> };

let chunks: Chunk[] | null = null;
const base64Cache = new Map<string, string>();

function pkgDir(): string {
  // "@fontsource/noto-sans-jp/400" resolves to 400.css through the package's exports map.
  return dirname(require.resolve('@fontsource/noto-sans-jp/400'));
}

function loadChunks(weights: number[]): Chunk[] {
  if (chunks) return chunks;
  const dir = pkgDir();
  const out: Chunk[] = [];
  for (const weight of weights) {
    const css = readFileSync(join(dir, `${weight}.css`), 'utf8');
    for (const block of css.split('@font-face').slice(1)) {
      const file = /url\(\.\/files\/([^)]+?\.woff2)\)/.exec(block)?.[1];
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
      if (!file || !range) continue;
      const ranges = range.split(',').map((r) => {
        const [a, b] = r.trim().replace(/^U\+/i, '').split('-');
        return [parseInt(a, 16), parseInt(b ?? a, 16)] as [number, number];
      });
      out.push({ weight, file, rangeCss: range, ranges });
    }
  }
  chunks = out;
  return out;
}

const b64 = (file: string) => {
  let v = base64Cache.get(file);
  if (!v) {
    v = readFileSync(join(pkgDir(), 'files', file)).toString('base64');
    base64Cache.set(file, v);
  }
  return v;
};

/**
 * @font-face rules (data: URIs) for exactly the Noto Sans JP chunks needed to
 * draw `text` in regular and bold. Empty string when the font package is
 * missing (the document then falls back to OS fonts).
 */
export function japaneseFontCss(text: string, weights: number[] = [400, 700]): string {
  let all: Chunk[];
  try {
    all = loadChunks([400, 700]);
  } catch {
    return '';
  }
  const cps = new Set<number>();
  for (const ch of text) cps.add(ch.codePointAt(0)!);
  const needed = all.filter((c) => weights.includes(c.weight) && c.ranges.some(([a, b]) => [...cps].some((cp) => cp >= a && cp <= b)));
  return needed
    .map(
      (c) =>
        `@font-face{font-family:'${DOC_FONT_FAMILY}';font-style:normal;font-weight:${c.weight};font-display:block;src:url(data:font/woff2;base64,${b64(c.file)}) format('woff2');unicode-range:${c.rangeCss};}`,
    )
    .join('\n');
}
