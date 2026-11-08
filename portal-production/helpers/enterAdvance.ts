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
export function nextEnterField(scope: ParentNode, current: Element): HTMLElement | null {
  const all = Array.from(scope.querySelectorAll<HTMLElement>("input, textarea")).filter(isEnterable);
  const idx = all.indexOf(current as HTMLElement);
  if (idx < 0) return null;
  return all[idx + 1] ?? null;
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

export function enterAdvancesFocus(e: ReactKeyboardEvent<HTMLElement>): void {
  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.nativeEvent && (e.nativeEvent as KeyboardEvent).isComposing) return; // IME commit (Japanese UI)
  const el = e.target as HTMLElement | null;
  if (!el || !isTypingBox(el)) return;
  if (dropdownOpen(el)) return;
  const scope = (el.closest(`[${ENTER_SCOPE_ATTR}]`) as HTMLElement | null) ?? (e.currentTarget as HTMLElement);
  const next = nextEnterField(scope, el);
  // Stop the newline / implicit form submit even on the last field, so Enter
  // never does anything surprising on these forms.
  e.preventDefault();
  if (!next) return;
  next.focus();
  if (typeof (next as HTMLInputElement).select === "function") {
    const t = (next as HTMLInputElement).type?.toLowerCase?.() || "text";
    // select() throws on date/number boxes in some browsers; those don't need it.
    if (!["date", "month", "time", "datetime-local", "week", "number"].includes(t)) {
      try {
        (next as HTMLInputElement).select();
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
  next.focus();
  if (next instanceof HTMLInputElement) {
    const t = (next.type || "text").toLowerCase();
    if (!["date", "month", "time", "datetime-local", "week", "number"].includes(t)) {
      try {
        next.select();
      } catch {
        /* ignore */
      }
    }
  }
  try {
    next.scrollIntoView({ block: "nearest" });
  } catch {
    /* ignore */
  }
}

/** Mount once (portal layout). Returns the uninstaller. */
export function installGlobalEnterAdvance(): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("keydown", globalKeydown);
  return () => document.removeEventListener("keydown", globalKeydown);
}
