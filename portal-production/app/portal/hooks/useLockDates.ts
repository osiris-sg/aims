"use client";

// Lock dates (Accounting Setup → Financial Settings → Lock Dates, guru 2026-11-20,
// Xero's two dates): `lockedThroughDate` binds everyone, `staffLockedThroughDate`
// binds users without accounting:update. The server refuses the write either
// way (api-server src/common/period-lock.ts); this hook lets a screen show the
// record as locked up front instead of toasting on every keystroke.
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { useUserPermissions } from "./useUserPermissions";

export type LockDates = { all: string | null; staff: string | null };

/** YYYY-MM-DD of an ISO or dd/mm/yyyy value; null when unreadable. */
export function lockDay(value: unknown): string | null {
  if (!value) return null;
  const v = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

export const lockDayLabel = (day: string): string => {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
};

/** Document types a lock date covers: the ones that carry money into the ledger. */
export const isPeriodLockedDocType = (type: string | null | undefined): boolean => {
  const t = String(type || "").toUpperCase();
  if (!t) return false;
  if (["TI", "TI2", "OR", "PV", "JV", "CN", "DN", "SIN", "SPR"].includes(t)) return true;
  return /INVOICE|NOTE|RECEIPT|VOUCHER|BILL|OFFSET|MONEY|CONTRA/.test(t);
};

export function useLockDates() {
  const { organization, isOsirisAdmin } = useOrganization();
  const { getToken } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const orgId = organization?.id;
  const [dates, setDates] = useState<LockDates>({ all: null, staff: null });

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res: any = await request({ path: "/accounting/settings", method: "GET", quiet: true }, {}, token || undefined);
        const s = res?.data ?? res;
        if (!cancelled) setDates({ all: lockDay(s?.lockedThroughDate), staff: lockDay(s?.staffLockedThroughDate) });
      } catch {
        /* no accounting access: nothing is shown as locked; the server still refuses */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, getToken]);

  // The platform admin (admin@osiris.sg, viewing any org) is an adviser everywhere, as on the server.
  const adviser = isOsirisAdmin || (!permissionsLoading && hasPermission("accounting", "update"));

  /** The lock date that binds THIS user: the later of the two that apply. */
  const effectiveLockDay = useMemo(() => {
    const candidates = [dates.all, adviser ? null : dates.staff].filter((d): d is string => !!d);
    return candidates.length ? candidates.sort()[candidates.length - 1] : null;
  }, [dates, adviser]);

  const isLockedDay = (value: unknown): boolean => {
    if (!effectiveLockDay) return false;
    const day = lockDay(value);
    return !!day && day <= effectiveLockDay;
  };

  return { dates, adviser, effectiveLockDay, isLockedDay };
}
