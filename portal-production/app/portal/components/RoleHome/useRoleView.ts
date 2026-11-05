"use client";

// Which role the home screen is drawn for, and that role's chosen quick
// actions. Both live in localStorage so a reload keeps them (the mock-up's
// behaviour), and both are broadcast on a window event so the top bar's chip
// and the screen stay in step without a shared provider.

import * as React from "react";
import { ROLES, ROLE_ORDER, type QuickActionId, type RoleId } from "./roles";

const ROLE_KEY = "aims-role-view";
const SHORTCUT_KEY = "aims-role-shortcuts";
export const ROLE_VIEW_EVENT = "aims-role-view-change";

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window / blocked storage — the screen still works, it just forgets */
  }
};

/** The stored role, for code that only needs to read it once (e.g. the nav). */
export function readRoleView(): RoleId {
  if (typeof window === "undefined") return "owner";
  const id = read<RoleId>(ROLE_KEY, "owner");
  return ROLE_ORDER.includes(id) ? id : "owner";
}

export function useRoleView() {
  // Start on the default every time so the server and the first client render
  // agree; the stored role is applied in the effect below.
  const [roleId, setRoleIdState] = React.useState<RoleId>("owner");
  const [shortcuts, setShortcutsState] = React.useState<Partial<Record<RoleId, QuickActionId[]>>>({});

  React.useEffect(() => {
    setRoleIdState(readRoleView());
    setShortcutsState(read(SHORTCUT_KEY, {}));
    const onChange = () => setRoleIdState(readRoleView());
    window.addEventListener(ROLE_VIEW_EVENT, onChange);
    return () => window.removeEventListener(ROLE_VIEW_EVENT, onChange);
  }, []);

  const setRoleId = React.useCallback((id: RoleId) => {
    setRoleIdState(id);
    write(ROLE_KEY, id);
    window.dispatchEvent(new CustomEvent(ROLE_VIEW_EVENT, { detail: { roleId: id } }));
  }, []);

  const role = ROLES[roleId];
  const activeShortcuts = shortcuts[roleId] ?? role.actionPool.slice(0, 3);

  const setShortcuts = React.useCallback(
    (list: QuickActionId[]) => {
      setShortcutsState((prev) => {
        const next = { ...prev, [roleId]: list };
        write(SHORTCUT_KEY, next);
        return next;
      });
    },
    [roleId],
  );

  return { roleId, setRoleId, role, activeShortcuts, setShortcuts };
}
