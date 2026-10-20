"use client";

// "Show test orders" (round N): test orders (#27 / #28 / #29 — click-through data) are hidden from the Orders,
// Shipments and Documents lists by default. The switch is remembered per browser (a convenience only).

import React, { useEffect, useState } from "react";
import { FormControlLabel, Switch } from "@mui/material";

const KEY = "aims-trade-show-test-orders";

export function useShowTestOrders(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(window.localStorage.getItem(KEY) === "1");
    } catch {
      /* storage blocked: default off */
    }
  }, []);
  const set = (v: boolean) => {
    setOn(v);
    try {
      window.localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  return [on, set];
}

export default function ShowTestToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <FormControlLabel
      sx={{ ml: "auto", mr: 0, "& .MuiFormControlLabel-label": { fontSize: 13 } }}
      control={<Switch size="small" checked={value} onChange={(e) => onChange(e.target.checked)} />}
      label="Show test orders"
      data-tour="show-test-orders"
    />
  );
}
