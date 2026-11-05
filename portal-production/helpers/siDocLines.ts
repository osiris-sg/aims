// Round BF — 出庫・納入依頼書: a product's document name as printed lines (Clients › Products preview).

/** Round BF: the 出庫・納入依頼書 lines — JA, then its "(EN)" line, …, then the size (mirrors the API's productDocLines). */
export function docLines(d: { docNameJa: string; docNameEn: string; docSize: string }): string[] {
  const split = (v: string) => v.split(/\r?\n|\s*\/\s*/).map((l) => l.trim()).filter(Boolean);
  const ja = split(d.docNameJa);
  const en = split(d.docNameEn);
  if (!ja.length && !en.length) return [];
  const out: string[] = [];
  for (let i = 0; i < Math.max(ja.length, en.length); i++) {
    if (ja[i]) out.push(ja[i]);
    if (en[i]) out.push(/^\(.*\)$/.test(en[i]) ? en[i] : `(${en[i]})`);
  }
  if (d.docSize.trim()) out.push(d.docSize.trim());
  return out;
}
