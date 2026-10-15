/**
 * Bill To text as printed (2026-10-15). Every Bill To block prints the customer
 * NAME in bold and then this text, but 221 Biofuel documents (and 83 recurring
 * templates) store billTo with the name as its first line, and some repeat
 * their "Attn:" line (one-off migration scripts, Aug/Sep 2026). Drop a first
 * line equal to the printed name, and any line that repeats an earlier one;
 * comparison ignores case and spacing. Nothing else is removed or reordered,
 * so an address "Attn:" line and the separate Attention contact each print
 * once. Keep in step with the API's document-html/shared.ts billToText.
 */
export function billToText(text: unknown, customerName?: unknown): string {
  const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const name = norm(customerName);
  const out: string[] = [];
  const seen = new Set<string>();
  let first = true;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const key = norm(line);
    if (!key) {
      if (out.length) out.push(line);
      continue;
    }
    if (first) {
      first = false;
      if (name && key === name) continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join("\n").trim();
}
