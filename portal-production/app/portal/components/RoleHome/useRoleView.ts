"use client";

// Which role the home screen is drawn for, and that role's chosen quick
// actions. Both live in localStorage so a reload keeps them (the mock-up's
// behaviour), and both are broadcast on a window event so the top bar's chip
// and the screen stay in step without a shared provider.

import * as React from "react";
import { useAuth } from "@clerk/nextjs";
import { ROLES, ROLE_ORDER, type QuickActionId, type RoleId } from "./roles";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { request } from "@/helpers/request";
import { primaryRoleName, roleHomeViewFor } from "@/helpers/multiRole";

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

/** The stored role, for code that only needs to read it once (e.g. the nav). With no stored
 *  (hand-picked) view: `fallback` ("owner" everywhere except multi-role orgs, see below). */
export function readRoleView(fallback: RoleId = "owner"): RoleId {
  if (typeof window === "undefined") return fallback;
  const id = read<RoleId | null>(ROLE_KEY, null);
  return id && ROLE_ORDER.includes(id) ? id : fallback;
}

/**
 * Multi-role orgs (enableMultiRole): the view that fits the person's PRIMARY role, used when
 * they never picked one by hand. Other orgs: "owner", with no extra request (as before).
 */
function usePrimaryRoleView(): RoleId {
  const { isMultiRoleEnabled } = useOrganizationFeatures();
  const { getToken } = useAuth();
  const [view, setView] = React.useState<RoleId>("owner");
  React.useEffect(() => {
    if (!isMultiRoleEnabled) {
      setView("owner");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: "/users/me/roles", method: "GET" }, {}, token);
        const roles = (res?.data ?? res ?? []) as Array<{ name?: string; isPrimary?: boolean }>;
        if (!cancelled) setView(roleHomeViewFor(primaryRoleName(Array.isArray(roles) ? roles : [])));
      } catch {
        /* stays on the Business Owner view */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMultiRoleEnabled, getToken]);
  return view;
}

export function useRoleView() {
  // Start on the default every time so the server and the first client render
  // agree; the stored role is applied in the effect below.
  const [roleId, setRoleIdState] = React.useState<RoleId>("owner");
  const [shortcuts, setShortcutsState] = React.useState<Partial<Record<RoleId, QuickActionId[]>>>({});

  // A view picked by hand (stored) wins; otherwise multi-role orgs open on the primary role's view.
  const fallback = usePrimaryRoleView();

  React.useEffect(() => {
    setRoleIdState(readRoleView(fallback));
    setShortcutsState(read(SHORTCUT_KEY, {}));
    const onChange = () => setRoleIdState(readRoleView(fallback));
    window.addEventListener(ROLE_VIEW_EVENT, onChange);
    return () => window.removeEventListener(ROLE_VIEW_EVENT, onChange);
  }, [fallback]);

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
