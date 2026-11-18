// Enter moves to the next field (guru 2026-11-08: "do the old method — rather
// than pressing Tab to go down, press Enter to key in the details").
//
// Legacy accounting software walked a form with Enter: type, Enter, type,
// Enter… down the screen, Tab never needed. This brings that back across the
// portal ("make sure it's for all places like this"), in two layers:
//
// 1. SCOPED (`enterScopeProps` on a wrapper with `data-enter-scope`): the
//    document editor and the accounting dialogs. Enter ALWAYS moves on there,
//    even in a multi-line box (Shift+Enter for a newline) and even when the
//    field has its own Enter action (the customer-code box commits the code
//    AND moves on).
// 2. GLOBAL (`installGlobalEnterAdvance`, mounted once in the portal layout):
//    every other single-line box in the portal — masterfile forms, settings,
//    filters, dialogs. It steps aside when the field already handled Enter
//    (search boxes, chat, inline rename), inside a multi-line box, and on the
//    LAST field of a <form>, where Enter keeps submitting as it always did.
//
// Both layers leave an open dropdown (Autocomplete / Select) alone so Enter
// still means "pick this option", and Enter on a button still presses it.

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const SKIP_INPUT_TYPES = new Set(["hidden", "button", "submit", "reset", "checkbox", "radio", "file", "range", "color", "image"]);

export const ENTER_SCOPE_ATTR = "data-enter-scope";

function isTypingBox(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !SKIP_INPUT_TYPES.has((el.type || "text").toLowerCase());
  return false;
}

function isEnterable(el: HTMLElement): boolean {
  if (!isTypingBox(el)) return false;
  if (el.disabled || el.readOnly) return false;
  if (el.tabIndex < 0 && el.getAttribute("tabindex") === "-1") return false;
  if (el.closest("[data-enter-ignore]")) return false;
  // Hidden (display:none, collapsed tab, unmounted-looking) boxes don't count.
  if (el.getClientRects().length === 0) return false;
  return true;
}

/** The field that comes after `current` in document order inside `scope`. */
/** The first field a fresh form should land the cursor in (guru 2026-11-18:
 *  "when you add a new PV the cursor is at the first field — any document"). */
export function firstEnterField(scope: ParentNode): HTMLElement | null {
  return Array.from(scope.querySelectorAll<HTMLElement>("input, textarea")).find(isEnterable) || null;
}

export function nextEnterField(scope: ParentNode, current: Element): HTMLElement | null {
  const all = Array.from(scope.querySelectorAll<HTMLElement>("input, textarea")).filter(isEnterable);
  const idx = all.indexOf(current as HTMLElement);
  if (idx < 0) return null;
  return all[idx + 1] ?? null;
}

/** The field before `current` (↑ walks back up the form, guru 2026-11-18). */
export function prevEnterField(scope: ParentNode, current: Element): HTMLElement | null {
  const all = Array.from(scope.querySelectorAll<HTMLElement>("input, textarea")).filter(isEnterable);
  const idx = all.indexOf(current as HTMLElement);
  if (idx <= 0) return null;
  return all[idx - 1];
}

/** Land in a field: focus, select its text (where that is safe), scroll it in. */
function landIn(next: HTMLElement): void {
  next.focus();
  if (next instanceof HTMLInputElement) {
    const t = (next.type || "text").toLowerCase();
    // select() throws on date/number boxes in some browsers; those don't need it.
    if (!["date", "month", "time", "datetime-local", "week", "number"].includes(t)) {
      try {
        next.select();
      } catch {
        /* ignore */
      }
    }
  }
  // A box hidden behind a sticky header: bring it into view.
  try {
    next.scrollIntoView({ block: "nearest" });
  } catch {
    /* ignore */
  }
}

/** Walk one field up (-1) or down (+1) from `el` inside its form / dialog /
 *  editor scope. Returns false when there is no scope or no such field, so the
 *  caller can let the key keep its native meaning. */
export function walkField(el: HTMLElement, dir: 1 | -1): boolean {
  const scope = el.closest(`[${ENTER_SCOPE_ATTR}], [role="dialog"], form`) as HTMLElement | null;
  if (!scope) return false;
  const next = dir < 0 ? prevEnterField(scope, el) : nextEnterField(scope, el);
  if (!next) return false;
  landIn(next);
  return true;
}

/** True when Enter should be left alone: a dropdown is open under the box. */
function dropdownOpen(el: HTMLElement): boolean {
  if (el.getAttribute("aria-expanded") === "true") return true;
  if (el.getAttribute("aria-activedescendant")) return true;
  // MUI Autocomplete: the open listbox is rendered in a popper linked by aria-controls.
  const controls = el.getAttribute("aria-controls");
  if (controls && document.getElementById(controls)) return true;
  return false;
}

// Scoped layer: Enter / ↓ = next field, ↑ = previous field (guru 2026-11-18:
// "allow them to use arrow key up to go up the field"). The arrows step aside
// wherever they already mean something: an open dropdown, a multi-line box,
// a number spinner, or a grid / list that consumed the key first (row
// highlight in the Locate dialogs). Date boxes walk too — DateInput hands the
// arrows to walkField() before the picker can step the day.
export function enterAdvancesFocus(e: ReactKeyboardEvent<HTMLElement>): void {
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  const isEnter = e.key === "Enter";
  const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
  if (!isEnter && !dir) return;
  if (e.nativeEvent && (e.nativeEvent as KeyboardEvent).isComposing) return; // IME commit (Japanese UI)
  const el = e.target as HTMLElement | null;
  if (!el || !isTypingBox(el)) return;
  if (dropdownOpen(el)) return;
  if (dir) {
    if (e.isDefaultPrevented?.() || e.nativeEvent?.defaultPrevented) return;
    if (el instanceof HTMLTextAreaElement) return;
    if ((el as HTMLInputElement).type?.toLowerCase?.() === "number") return;
    if (el.closest("[data-arrows-ignore]")) return;
  }
  const scope = (el.closest(`[${ENTER_SCOPE_ATTR}]`) as HTMLElement | null) ?? (e.currentTarget as HTMLElement);
  const next = dir < 0 ? prevEnterField(scope, el) : nextEnterField(scope, el);
  // Stop the newline / implicit form submit even on the last field, so Enter
  // never does anything surprising on these forms.
  if (isEnter) e.preventDefault();
  if (!next) return;
  e.preventDefault();
  landIn(next);
}

/** Spread onto the wrapper: `<Box {...enterScopeProps}>`. */
export const enterScopeProps = {
  [ENTER_SCOPE_ATTR]: "" as const,
  onKeyDown: enterAdvancesFocus,
};

// ---------------------------------------------------------------------------
// Global layer
// ---------------------------------------------------------------------------

/** Where "the next field" is looked for when there is no explicit scope. */
function containerFor(el: HTMLElement): ParentNode {
  return (
    (el.closest(
      `[${ENTER_SCOPE_ATTR}], [role="dialog"], form, .MuiDrawer-paper, .MuiPopover-paper`,
    ) as HTMLElement | null) ?? document.body
  );
}

function globalKeydown(e: KeyboardEvent): void {
  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
  // A field that already acted on Enter (search → go, chat → send, rename →
  // save) keeps its behaviour; the scoped layer also lands here, already done.
  if (e.defaultPrevented) return;
  const el = e.target as HTMLElement | null;
  if (!el || !(el instanceof HTMLInputElement)) return; // multi-line boxes keep Enter = newline
  if (!isTypingBox(el) || el.disabled || el.readOnly) return;
  if ((el.type || "").toLowerCase() === "search") return;
  if (el.closest(`[${ENTER_SCOPE_ATTR}], [data-enter-ignore], [role="search"], [role="searchbox"]`)) return;
  if (el.getAttribute("role") === "searchbox") return;
  if (dropdownOpen(el)) return;
  const scope = containerFor(el);
  const next = nextEnterField(scope, el);
  if (!next) return; // last field: inside a <form> Enter still submits, elsewhere it does nothing
  e.preventDefault();
  landIn(next);
}

/** Mount once (portal layout). Returns the uninstaller. */
export function installGlobalEnterAdvance(): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("keydown", globalKeydown);
  return () => document.removeEventListener("keydown", globalKeydown);
}
