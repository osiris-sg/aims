// Round BX (Sayaka, ETA tracking): switching shipment from the sticky bar keeps her where she was — the same card
// (the tracking card, step 7's tax card …) at the same height on screen. Cards that can be "a place" carry
// data-keep-place="<key>" (step cards: "step:<code>", the tracking card: "port"); the switch captures the first one
// showing under the sticky bar and puts the same card of the next shipment back at that height once it renders.

export type Place = { key: string; offset: number; openStepId: string | null; openCode: string | null };

const BAR = '[data-tour="shipment-sticky-bar"]';

/** Pure: which of the visible boxes is "the place" — the first one starting under the bar, else the one the bar cuts. */
export function pickPlace(boxes: Array<{ key: string; top: number; bottom: number }>, barBottom: number, viewport: number): { key: string; offset: number } | null {
  const visible = boxes.filter((b) => b.bottom > barBottom + 8 && b.top < viewport);
  if (!visible.length) return null;
  const below = visible.filter((b) => b.top >= barBottom - 1).sort((a, b) => a.top - b.top)[0];
  if (below && below.top < viewport * 0.6) return { key: below.key, offset: below.top };
  // A tall card the bar cuts (deep inside it): the innermost one = the last in document order.
  const cut = visible.filter((b) => b.top < barBottom - 1);
  const pick = cut[cut.length - 1] ?? below;
  return pick ? { key: pick.key, offset: pick.top } : null;
}

export function capturePlace(openStepId: string | null, openCode: string | null): Place | null {
  if (typeof document === "undefined") return null;
  const bar = document.querySelector(BAR);
  const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
  const boxes = Array.from(document.querySelectorAll<HTMLElement>("[data-keep-place]")).map((el) => {
    const r = el.getBoundingClientRect();
    return { key: el.dataset.keepPlace ?? "", top: r.top, bottom: r.bottom };
  });
  const p = pickPlace(boxes, barBottom, window.innerHeight);
  return p ? { ...p, openStepId, openCode } : { key: "", offset: 0, openStepId, openCode };
}

/** Scroll so the place's card sits where it was; false when that card isn't on the page (yet). */
export function restorePlace(p: Place): boolean {
  if (!p.key || typeof document === "undefined") return false;
  const el = document.querySelector<HTMLElement>(`[data-keep-place="${CSS.escape(p.key)}"]`);
  if (!el) return false;
  window.scrollTo({ top: Math.max(0, window.scrollY + el.getBoundingClientRect().top - p.offset), behavior: "auto" });
  return true;
}

/** Prev / next in the list (no wrap). */
export function neighbours<T extends { id: string }>(list: T[], id: string | undefined): { prev: T | null; next: T | null; index: number } {
  const i = id ? list.findIndex((x) => x.id === id) : -1;
  return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null, index: i };
}
