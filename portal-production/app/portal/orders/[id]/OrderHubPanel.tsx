"use client";

// WCT orders hub (enableWctOrders, 2026-11-13): the top of the order page.
// A 4-step tracker (Quotation -> DO -> Invoice -> Service report) with each
// step's documents, status and date, ONE primary button for the next step, and
// a Documents list of everything linked to the order. Every button reuses an
// existing screen or dialog (see hubActionTarget); the sections below the panel
// are unchanged.

import React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import moment from "moment";
import { HUB_ACTION_LABEL, hubNextStep, hubSteps, type HubActionKey, type HubStep } from "@/helpers/wctOrderHub";

const fmt = (d: string | null) => (d ? moment(d).format("DD/MM/YYYY") : "");

function StepBox({ step, n, onOpen }: { step: HubStep; n: number; onOpen: (href: string) => void }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 160,
        p: 1.5,
        borderRadius: 1.5,
        border: 1,
        borderColor: step.current ? "primary.main" : "divider",
        bgcolor: step.current ? "action.hover" : "transparent",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        {step.done ? (
          <CheckCircleIcon fontSize="small" color="success" />
        ) : (
          <Box sx={{ width: 20, height: 20, borderRadius: "50%", border: 1.5, borderColor: step.current ? "primary.main" : "text.disabled", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: step.current ? "primary.main" : "text.secondary" }}>
            {n}
          </Box>
        )}
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {step.title}
        </Typography>
        {step.done && step.date && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: "auto !important" }}>
            {fmt(step.date)}
          </Typography>
        )}
      </Stack>
      {step.docs.length ? (
        step.docs.map((d, i) => (
          <Typography key={i} variant="caption" component="div" sx={{ color: "text.secondary" }}>
            {/* WCT manual flow (2026-11-13): a service report opens its own page. */}
            {step.key === "report" && d.href ? (
              <Box
                component="span"
                role="link"
                onClick={() => onOpen(d.href!)}
                sx={{ color: "primary.main", fontWeight: 600, fontVariantNumeric: "tabular-nums", cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
              >
                {d.label}
              </Box>
            ) : (
              <Box component="span" sx={{ color: "text.primary", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {d.label}
              </Box>
            )}
            {d.status ? ` · ${d.status}` : ""}
          </Typography>
        ))
      ) : (
        <Typography variant="caption" color="text.disabled">
          {step.current ? "Next" : "Not yet"}
        </Typography>
      )}
    </Box>
  );
}

export default function OrderHubPanel({ order, serviceReportReady, onAction, doFirst = false, awaitingDo = false }: { order: any; serviceReportReady: boolean; onAction: (key: HubActionKey, pos?: { left: number; top: number }) => void; doFirst?: boolean; awaitingDo?: boolean }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const steps = hubSteps(order);
  // Open a file from the API: the signed quotation PDF (a signed URL back), the signed DO or a photos file (the bytes).
  const openFile = async (path: string) => {
    const tab = window.open("", "_blank");
    try {
      const token = await getToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const activeOrg = window.sessionStorage.getItem("aims-admin-active-org");
      if (activeOrg) headers["X-Active-Org-Id"] = activeOrg;
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}${path}`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Could not open the file (${res.status})`);
      }
      let url: string;
      if ((res.headers.get("content-type") || "").includes("application/json")) {
        const j = await res.json();
        url = (j?.data ?? j)?.url;
        if (!url) throw new Error("The file is not available");
      } else {
        url = URL.createObjectURL(await res.blob());
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
    } catch (e: any) {
      tab?.close();
      toast.error(e?.message || "Could not open the file");
    }
  };
  const next = hubNextStep({ status: order.status, invoices: order.invoices, serviceReportReady, doFirst, awaitingDo });
  const docs = [
    ...steps[0].docs.map((d) => ({ type: "Quotation", ...d })),
    ...steps[1].docs.map((d) => ({ type: "Delivery order", ...d })),
    ...steps[2].docs.map((d) => ({ type: "Invoice", ...d })),
    ...steps[3].docs.map((d) => ({ type: "Service report", ...d, status: `${d.status}${d.status !== "Draft" ? " · photos on the report" : ""}` })),
  ];
  const finished = order.status === "SERVICE_REPORT_SENT" || order.status === "CLOSED";

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }} data-tour="wct-order-hub">
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }} sx={{ mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ flex: 1 }}>
          {steps.map((s, i) => (
            <StepBox key={s.key} step={s} n={i + 1} onOpen={(href) => router.push(href)} />
          ))}
        </Stack>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ minWidth: 200 }}>
          {next ? (
            <>
              {next.secondary && (
                <Button variant="outlined" onClick={(e) => onAction(next.secondary!, { left: e.clientX, top: e.clientY })}>
                  {HUB_ACTION_LABEL[next.secondary]}
                </Button>
              )}
              <Button variant="contained" disableElevation onClick={(e) => onAction(next.primary, { left: e.clientX, top: e.clientY })} data-tour={next.primary === "add-job" ? "wct-order-add-job" : "wct-order-next-step"}>
                {next.label ?? HUB_ACTION_LABEL[next.primary]}
              </Button>
            </>
          ) : finished ? (
            <Chip color="success" icon={<CheckCircleIcon />} label="Completed" />
          ) : null}
        </Stack>
      </Stack>

      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        Documents
      </Typography>
      {docs.length ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Number</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>File</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {docs.map((d, i) => (
              <TableRow key={i} hover sx={{ cursor: d.href ? "pointer" : "default" }} onClick={() => d.href && router.push(d.href)}>
                <TableCell>{d.type}</TableCell>
                <TableCell sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{d.label}</TableCell>
                <TableCell>{d.status}</TableCell>
                <TableCell>
                  {d.file && (
                    <Button
                      size="small"
                      variant="text"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openFile(d.file!.path);
                      }}
                      sx={{ minWidth: 0, p: 0, textTransform: "none" }}
                    >
                      {d.file.label}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No documents yet.
        </Typography>
      )}
    </Paper>
  );
}
