// Line-grid number boxes (Quantity, Unit Price, Sale Price) for EVERY org.
// guru 2026-11-25: a long unit price was clipped to "3532" because the Unit Price
// column was a fixed 112px while the box (100px) plus the price-history icon
// (28px) did not fit, so flex squeezed the box to ~54px. Rule now: the box grows
// with the digits typed and the column grows with the widest box in it, so the
// whole number is always visible; digits sit right-aligned, tabular, and the
// full value is the hover title as a belt-and-braces.
export const DIGIT_PX = 9; // one digit at the grid's 14px font, tabular nums
export const BOX_CHROME_PX = 30; // input padding + border
export const CELL_PADDING_PX = 16; // 8px each side (body cells, see the Table sx)
export const ICON_PX = 32; // a 24px icon button + the 4px gap before it

// Character caps (guru 2026-11-25: "fix to certain number of characters" — a
// 30-digit price spilled the Amount over the Actions column). Money: 16 chars
// = 999,999,999,999.99 or 1.3434-style; quantity: 12 chars.
export const MAX_MONEY_CHARS = 16;
export const MAX_QTY_CHARS = 12;
/** True when the typed text is still within the cap (type="number" ignores maxLength, so the box checks in onChange). */
export const withinCharCap = (raw: string, maxChars: number): boolean => raw.length <= maxChars;

export const numberBoxWidthPx = (value: unknown, minPx: number, maxChars = MAX_MONEY_CHARS): number => {
  const chars = Math.min(maxChars, String(value ?? "").length);
  return Math.max(minPx, BOX_CHROME_PX + chars * DIGIT_PX);
};

/** Read-only number column (Amount): wide enough for its widest text, never under the base. */
export const numberTextColumnWidth = (values: string[], basePx: number): string => {
  const widest = values.reduce<number>((w, v) => Math.max(w, v.length), 0);
  return `${Math.max(basePx, widest * DIGIT_PX + CELL_PADDING_PX + 4)}px`;
};

/** Column width: the widest box in the column plus its icons and cell padding, never under the base. */
export const numberColumnWidth = (values: unknown[], minBoxPx: number, basePx: number, iconsPx = 0, maxChars = MAX_MONEY_CHARS + 3): string => {
  const widest = values.reduce<number>((w, v) => Math.max(w, numberBoxWidthPx(v, minBoxPx, maxChars)), minBoxPx);
  return `${Math.max(basePx, widest + CELL_PADDING_PX + iconsPx)}px`;
};

/** Right-aligned, tabular digits for every number box in the grid. */
export const numberBoxInputProps = { style: { textAlign: "right" as const, fontVariantNumeric: "tabular-nums" } };

/** Hover title: the full number with thousands separators (money gets 2dp). */
export const numberBoxTitle = (value: unknown, money = false): string => {
  const n = Number(value);
  if (value === "" || value == null || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-SG", money ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 6 });
};

/** Money box at rest: at least 2dp (500 → "500.00"), more when the user typed more (1.3434 stays); blank stays blank. guru 2026-11-25 */
export const moneyBoxDisplay = (value: unknown): string => {
  if (value === "" || value == null) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const typed = String(value).split(".")[1]?.length ?? 0;
  return n.toFixed(Math.min(10, Math.max(2, typed)));
};

// Product Code column (guru 2026-11-25: "the product code goes beyond the row"):
// the column widens for the longest code on the document, up to CODE_MAX_CHARS,
// beyond which the code wraps inside its cell (overflowWrap: anywhere). The old
// minWidth 120px on the code text pushed it past a narrower cell into Description.
export const CODE_CHAR_PX = 8;
export const CODE_MAX_CHARS = 22;
export const codeColumnWidth = (codes: unknown[], base: string): string => {
  const widest = codes.reduce<number>((w, c) => Math.max(w, String(c ?? "").length), 0);
  if (widest <= 12) return base;
  return `${Math.min(widest, CODE_MAX_CHARS) * CODE_CHAR_PX + CELL_PADDING_PX}px`;
};
