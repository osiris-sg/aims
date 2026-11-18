/**
 * After a code box fills its row (an account code fills Description), the
 * cursor should land on the row's next EMPTY box — Remarks, then Amount —
 * not back on the first field (guru 2026-11-18). Read-only and disabled
 * boxes are skipped; a money box showing 0.00 counts as empty.
 */
export function focusNextEmptyInRow(from: HTMLElement | null | undefined): void {
  const row = from?.closest("tr");
  if (!row) return;
  const inputs = Array.from(row.querySelectorAll<HTMLInputElement>("input:not([disabled]):not([readonly])"));
  const at = inputs.indexOf(from as HTMLInputElement);
  const after = inputs.slice(at + 1);
  const next = after.find((el) => /^[\s0.,]*$/.test(el.value)) ?? after[0];
  if (!next) return;
  next.focus();
  if (typeof next.select === "function") next.select();
}
