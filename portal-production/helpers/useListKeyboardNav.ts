import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keyboard navigation for a "Locate …" picker: a search box over a list of
 * rows the user picks from (customers, salesmen, accounts, documents…).
 * Guru 2026-11-14: "allow to not use mouse — Enter and arrow keydown, for all
 * the components". So the user types to filter, moves the highlight with
 * ArrowUp / ArrowDown (Home / End jump to the ends), and presses Enter to
 * select — never needing the mouse.
 *
 * Usage:
 *   const { activeIndex, setActiveIndex, handleKeyDown, setRowRef } =
 *     useListKeyboardNav(rows, pick, { onClose });
 *   <TextField … onKeyDown={handleKeyDown} />
 *   rows.map((r, i) => (
 *     <TableRow ref={setRowRef(i)} selected={i === activeIndex}
 *               onMouseEnter={() => setActiveIndex(i)}
 *               onClick={() => pick(r)} … />
 *   ))
 *
 * Put onKeyDown on the search field (it holds focus) OR on a wrapping element.
 */
export function useListKeyboardNav<T>(
  items: T[],
  onPick: (item: T, index: number) => void,
  opts?: { enabled?: boolean; onClose?: () => void },
) {
  const [activeIndex, setActiveIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLElement | null>>([]);
  const enabled = opts?.enabled !== false;

  // A new/changed result set starts the highlight at the top (or clears it when
  // empty). Length is the signal — a re-ranked list of the same length keeps
  // the row the user is on rather than snapping back.
  useEffect(() => {
    setActiveIndex(items.length ? 0 : -1);
  }, [items.length]);

  // Keep the highlighted row visible as it moves past the scroll edge.
  useEffect(() => {
    const el = rowRefs.current[activeIndex];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (items.length ? Math.min(items.length - 1, (i < 0 ? -1 : i) + 1) : -1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (items.length ? Math.max(0, (i < 0 ? 0 : i) - 1) : -1));
          break;
        case "Home":
          if (items.length) {
            e.preventDefault();
            setActiveIndex(0);
          }
          break;
        case "End":
          if (items.length) {
            e.preventDefault();
            setActiveIndex(items.length - 1);
          }
          break;
        case "Enter": {
          const it = activeIndex >= 0 ? items[activeIndex] : undefined;
          if (it !== undefined) {
            e.preventDefault();
            onPick(it, activeIndex);
          }
          break;
        }
        case "Escape":
          opts?.onClose?.();
          break;
        default:
          break;
      }
    },
    [enabled, items, activeIndex, onPick, opts],
  );

  const setRowRef = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      rowRefs.current[i] = el;
    },
    [],
  );

  return { activeIndex, setActiveIndex, handleKeyDown, setRowRef };
}
