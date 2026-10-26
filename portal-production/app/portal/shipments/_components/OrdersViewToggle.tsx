"use client";

// Round AM — "List | Monthly" on the Orders page and on a client's Orders tab: the view lives in the URL (?view=monthly,
// other query params kept) and is remembered per user (browser storage, keyed by the signed-in user) for the next visit.

import React, { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import ViewListIcon from "@mui/icons-material/ViewList";
import CalendarViewMonthIcon from "@mui/icons-material/CalendarViewMonth";
import { uiLangOf } from "../_lib/inbox-cards";

export type OrdersView = "list" | "monthly";
const storageKey = (userId: string | null | undefined) => `aims-orders-view:${userId ?? "anon"}`;

export function useOrdersView(): [OrdersView, (v: OrdersView) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useUser();
  const fromUrl = params?.get("view");
  const [stored, setStored] = useState<OrdersView | null>(null);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(storageKey(user?.id));
      setStored(v === "monthly" || v === "list" ? v : null);
    } catch {
      setStored(null);
    }
  }, [user?.id]);
  const view: OrdersView = fromUrl === "monthly" || fromUrl === "list" ? fromUrl : (stored ?? "list");
  const setView = useCallback(
    (v: OrdersView) => {
      try {
        window.localStorage.setItem(storageKey(user?.id), v);
      } catch {
        /* private window: the URL still carries it */
      }
      setStored(v);
      const p = new URLSearchParams(params?.toString() ?? "");
      p.set("view", v);
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [params, pathname, router, user?.id],
  );
  return [view, setView];
}

export default function OrdersViewToggle({ view, onChange }: { view: OrdersView; onChange: (v: OrdersView) => void }) {
  const [ja, setJa] = useState(false);
  useEffect(() => setJa(uiLangOf(typeof navigator !== "undefined" ? navigator.language : null) === "ja"), []);
  return (
    <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && onChange(v)} data-tour="orders-view-toggle" sx={{ "& .MuiToggleButton-root": { textTransform: "none", px: 1.5, py: 0.5, gap: 0.75 } }}>
      <ToggleButton value="list" aria-label="List view">
        <ViewListIcon fontSize="small" />
        {ja ? "リスト" : "List"}
      </ToggleButton>
      <ToggleButton value="monthly" aria-label="Monthly view">
        <CalendarViewMonthIcon fontSize="small" />
        {ja ? "月次" : "Monthly"}
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
