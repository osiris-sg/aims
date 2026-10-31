/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AY part 3 — the shared cells of the Customers / Suppliers tables (name EN / JA, main contact, last delivery).

import React from "react";
import { Box, Typography } from "@mui/material";
import type { MainContact } from "../../_lib/api";
import { fmtDay } from "../../_lib/format";
import { ym } from "./ClientsBits";

export const NameCell = ({ short, name, ja }: { short: string; name: string; ja?: string | null }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant="body2" sx={{ fontWeight: 800 }}>{short}</Typography>
    <Typography variant="caption" color="text.secondary" component="div">{name}</Typography>
    {ja ? <Typography variant="caption" color="text.secondary" component="div">{ja}</Typography> : null}
  </Box>
);

export const ContactCell = ({ c }: { c: MainContact | null | undefined }) =>
  c ? (
    <Box>
      {c.name ? <Typography variant="body2">{c.name}</Typography> : null}
      {c.email ? <Typography variant="caption" color="text.secondary" component="div">{c.email}</Typography> : null}
    </Box>
  ) : (
    <>—</>
  );

export const lastDeliveryText = (d: { date?: string | null; month?: string | null; ref?: string } | null | undefined) => (d ? `${d.date ? fmtDay(d.date) : ym(d.month ?? null)} · ${d.ref ?? ""}` : "");
export const lastDeliveryKey = (d: { date?: string | null; month?: string | null } | null | undefined) => (d ? d.date?.slice(0, 10) ?? `${d.month}-99` : null);
