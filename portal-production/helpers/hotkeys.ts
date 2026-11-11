// Keyboard hotkeys (guru 2026-11-09: "make F2 the hotkey to click the search
// button; add a setting in the org settings for hotkeys and list out common
// things").
//
// Legacy accounting software drove every screen from the function keys. AIMS
// now has a per-org hotkey map: Settings → Hotkeys lists the common actions
// below with their default keys; an admin can rebind or switch any of them
// off, and the map applies to everyone in the organisation.
//
// How a key finds its target: controls declare `data-hotkey="<action id>"`.
// When the key is pressed the dispatcher clicks the visible, enabled control
// with that id — inside the topmost open dialog if one is open, else on the
// page. "lookup" is special: it looks for the magnifier INSIDE the field the
// cursor is in (the code box's search adornment), so F2 opens the right
// Locate dialog for the box being keyed. When no control carries the id,
// a `aims:hotkey` window event is dispatched so a component can react
// (the editor opens its Locate dialog that way — the item lives in a menu).

export type HotkeyAction = {
  id: string;
  label: string;
  description: string;
  defaultKey: string | null;
};

// NOTE: there is no "help" action any more. It pressed the ✦ AIMS Guide
// bubble, which was retired from every org on 2026-11-11, leaving F1 bound to a
// control that is no longer mounted — the dispatcher swallowed the key and
// nothing happened. F1 is free; bind it to AIMEE if she should answer it.
export const HOTKEY_ACTIONS: HotkeyAction[] = [
  {
    id: "lookup",
    label: "Look up",
    description: "Open the search for the code box the cursor is in: customer, supplier, account or salesman. Same as clicking its magnifier.",
    defaultKey: "F2",
  },
  {
    id: "locate",
    label: "Locate document",
    description: "In the document editor, open Locate to jump to another document of the same kind.",
    defaultKey: "F3",
  },
  {
    id: "new",
    label: "New",
    // Only the AR / AP homes carry data-hotkey="new" today; do not promise the
    // editor here until its New control has the anchor too.
    description: "The screen's New or Add button. A new Official Receipt on the Accounts Receivable home, a new Payment Voucher on Accounts Payable.",
    defaultKey: "F4",
  },
  {
    id: "preview",
    label: "Preview / Edit",
    description: "Switch the document editor between editing and the printed preview.",
    defaultKey: "F6",
  },
  {
    id: "confirm",
    label: "Confirm",
    description: "Confirm the open document (invoice, delivery order, quotation).",
    defaultKey: "F7",
  },
  {
    id: "addLine",
    label: "Add line",
    description: "Add a line or item to the open document, journal voucher, supplier invoice or bank transaction.",
    defaultKey: "F8",
  },
  {
    id: "save",
    label: "Save",
    description: "Save the open document or dialog.",
    defaultKey: "F9",
  },
  {
    id: "saveSubmit",
    label: "Save and submit",
    description: "On a supplier invoice, save and submit in one go.",
    defaultKey: "Shift+F9",
  },
];

/** Keys that are always on and cannot be rebound — shown on the settings page for completeness. */
export const FIXED_KEYS: Array<{ key: string; what: string }> = [
  { key: "Enter", what: "Next field. Tab works too." },
  { key: "Shift+Enter", what: "New line inside a multi-line box." },
  { key: "Esc", what: "Close the open dialog or list." },
];

export type HotkeyMap = Record<string, string | null>;

export function defaultHotkeyMap(): HotkeyMap {
  const m: HotkeyMap = {};
  for (const a of HOTKEY_ACTIONS) m[a.id] = a.defaultKey;
  return m;
}

/** Defaults overlaid with the org's saved choices (null = switched off). */
export function resolveHotkeyMap(saved: HotkeyMap | null | undefined): HotkeyMap {
  const m = defaultHotkeyMap();
  if (saved && typeof saved === "object") {
    for (const a of HOTKEY_ACTIONS) {
      if (Object.prototype.hasOwnProperty.call(saved, a.id)) {
        const v = saved[a.id];
        m[a.id] = typeof v === "string" && v ? normalizeCombo(v) : null;
      }
    }
  }
  return m;
}

const MOD_ORDER = ["Ctrl", "Alt", "Shift", "Cmd"];

/** Canonical spelling: modifiers in a fixed order, key capitalised ("Shift+F9", "Ctrl+Shift+S"). */
export function normalizeCombo(combo: string): string {
  const parts = combo
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const mods = new Set<string>();
  let key = "";
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === "ctrl" || low === "control") mods.add("Ctrl");
    else if (low === "alt" || low === "option") mods.add("Alt");
    else if (low === "shift") mods.add("Shift");
    else if (low === "cmd" || low === "meta" || low === "command") mods.add("Cmd");
    else key = p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].filter(Boolean).join("+");
}

/** The combo a keydown represents, or null for a bare modifier press. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const k = e.key;
  if (!k || k === "Control" || k === "Alt" || k === "Shift" || k === "Meta" || k === "Dead" || k === "Unidentified") return null;
  let key: string;
  if (/^F\d{1,2}$/.test(k)) key = k;
  else if (k.length === 1) key = k.toUpperCase();
  else key = k; // Enter, Escape, Tab, Insert, Delete, Home, End, PageUp…
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Cmd"].filter(Boolean) as string[];
  return [...mods, key].join("+");
}

/**
 * Only combos that cannot collide with typing are allowed: any F-key (with or
 * without modifiers), or Ctrl / Alt / Cmd plus a letter, digit or named key.
 * Plain letters, Shift+letter, Enter, Tab and Escape are refused.
 */
export function comboProblem(combo: string): string | null {
  const parts = combo.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (/^F\d{1,2}$/.test(key)) {
    if (key === "F5" || key === "F11" || key === "F12") return `${key} belongs to the browser (refresh / full screen / developer tools)`;
    return null;
  }
  if (!mods.some((m) => m === "Ctrl" || m === "Alt" || m === "Cmd")) return "Use an F-key, or Ctrl / Alt / Cmd together with a key. Plain keys would fire while typing";
  if (["Enter", "Tab", "Escape", "Backspace", "Delete"].includes(key) && mods.length === 0) return "That key already has a job";
  return null;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export const HOTKEY_EVENT = "aims:hotkey";

function visibleEnabled(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return false;
  return el.getClientRects().length > 0;
}

/** The control to click for an action: inside the topmost open dialog when one is open, else on the page. */
export function hotkeyTarget(actionId: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll(`[data-hotkey="${actionId}"]`)).filter(visibleEnabled);
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((d) => d.getClientRects().length > 0);
  if (dialogs.length) {
    const top = dialogs[dialogs.length - 1];
    return all.find((el) => top.contains(el)) ?? null; // never click behind a modal
  }
  return all[0] ?? null;
}

/** For "lookup": the magnifier inside the field the cursor is in. */
function lookupTarget(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  const root = active?.closest(".MuiInputBase-root, .MuiFormControl-root, [data-hotkey-group]");
  const inField = root?.querySelector('[data-hotkey="lookup"]');
  if (inField && visibleEnabled(inField)) return inField;
  return hotkeyTarget("lookup");
}

export function runHotkeyAction(actionId: string): boolean {
  const target = actionId === "lookup" ? lookupTarget() : hotkeyTarget(actionId);
  if (target) {
    target.click();
    return true;
  }
  window.dispatchEvent(new CustomEvent(HOTKEY_EVENT, { detail: { action: actionId } }));
  return false;
}

/**
 * Install the keydown listener. `getMap` is read on every key press so a
 * saved change applies without a reload. Returns the uninstaller.
 */
export function installHotkeys(getMap: () => HotkeyMap): () => void {
  if (typeof document === "undefined") return () => {};
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing || e.repeat) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const map = getMap();
    const action = HOTKEY_ACTIONS.find((a) => map[a.id] && map[a.id] === combo);
    if (!action) return;
    // The key is ours whether or not a control is on screen — otherwise F3
    // would sometimes open the browser's find bar and sometimes Locate.
    e.preventDefault();
    e.stopPropagation();
    runHotkeyAction(action.id);
  };
  // Capture phase: before any field-level handler, so an F-key pressed inside
  // a text box reaches the dispatcher.
  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}
