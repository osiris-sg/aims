// Top bar tabs that overflow (WCT round 12, 2026-11-19): users did not know the
// module tabs scroll. NavTabsScroller shows a left / right arrow (over a soft
// fade) only on the side where more tabs are hidden. Pure maths, so it is tested.

/** Which sides have hidden tabs. 1px of slack absorbs sub-pixel widths. */
export function overflowSides(scrollLeft: number, clientWidth: number, scrollWidth: number): { left: boolean; right: boolean } {
  if (!(scrollWidth > clientWidth + 1)) return { left: false, right: false };
  return { left: scrollLeft > 1, right: scrollLeft + clientWidth < scrollWidth - 1 };
}

/** How far one arrow press scrolls: most of the visible width, keeping a tab of context. */
export function scrollStep(clientWidth: number): number {
  return Math.max(120, Math.round(clientWidth * 0.7));
}
