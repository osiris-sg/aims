"use client";

// Enter moves to the next field, portal-wide (guru 2026-11-08: "make sure
// it's for all places like this"). Mounted once by the portal layout; the
// rules live in helpers/enterAdvance.ts.

import { useEffect } from "react";
import { installGlobalEnterAdvance } from "@/helpers/enterAdvance";

export default function EnterAdvanceHost() {
  useEffect(() => installGlobalEnterAdvance(), []);
  return null;
}
