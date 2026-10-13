"use client";

import React, { useEffect, useState } from "react";
import { Box, Button, Chip, CircularProgress, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { request, withActiveOrg } from "@/helpers/request";
import type { PanelEvent } from "./useOperatorChat";

interface Preview {
  id: string;
  number: string;
  type: string;
  status: string;
  customer: string | null;
  total: number | null;
  currency: string | null;
  editorPath: string;
  pdfUrl: string | null;
  error?: string;
}

interface Props {
  event: PanelEvent;
  onClose: () => void;
}

const money = (n: number | null, cur: string | null) =>
  n == null ? "" : `${cur || "SGD"} ${Number(n).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const statusColor = (s: string): "default" | "success" | "warning" | "info" =>
  /confirmed|paid|posted|approved/i.test(s) ? "success" : /pending|partial/i.test(s) ? "warning" : /draft|unconfirmed/i.test(s) ? "info" : "default";

/** The chat home's right-hand pane: a document being worked on, a dashboard
 *  screen the assistant opened, or a table it drew. */
export default function SidePanel({ event, onClose }: Props) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  // An embedded page can take a while on first load; show that instead of a
  // blank column (guru 2026-10-14: a silent panel reads as "nothing happens").
  const [frameLoading, setFrameLoading] = useState(false);

  const load = async (fresh: boolean) => {
    if (event.type !== "document") return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await request({ path: `/operator/web/documents/${event.documentId}/preview${fresh ? "?fresh=1" : ""}`, method: "GET" }, {}, token!);
      setPreview((res?.data ?? res) as Preview);
    } catch (e: any) {
      setPreview({ error: e?.message || "Could not load the document." } as Preview);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPreview(null);
    setFrameKey((k) => k + 1);
    setFrameLoading(event.type === "screen");
    if (event.type === "document") load(!!event.fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  const embedUrl = (path: string) => withActiveOrg(`${path}${path.includes("?") ? "&" : "?"}embed=1`);

  const header = (title: React.ReactNode, actions?: React.ReactNode) => (
    <Stack direction="row" alignItems="center" gap={1} sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", minHeight: 48 }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>{title}</Box>
      {actions}
      <Tooltip title="Close panel">
        <IconButton size="small" onClick={onClose} aria-label="Close panel">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );

  if (event.type === "screen") {
    const title = event.title || event.path.replace(/^\/portal\/?/, "").split("/").filter(Boolean).map((s) => s.replace(/-/g, " ")).join(" › ") || "Dashboard";
    return (
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {header(
          <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.9rem", textTransform: "capitalize" }}>{title}</Typography>,
          <>
            <Tooltip title="Reload">
              <IconButton size="small" onClick={() => { setFrameLoading(true); setFrameKey((k) => k + 1); }} aria-label="Reload"><RefreshIcon fontSize="small" /></IconButton>
            </Tooltip>
            <Tooltip title="Open full page">
              <IconButton size="small" onClick={() => router.push(event.path)} aria-label="Open full page"><OpenInNewIcon fontSize="small" /></IconButton>
            </Tooltip>
          </>,
        )}
        <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
          {frameLoading && (
            <Stack alignItems="center" justifyContent="center" sx={{ position: "absolute", inset: 0, zIndex: 1, bgcolor: "background.default" }}>
              <CircularProgress size={28} />
              <Typography sx={{ mt: 1, fontSize: "0.8rem", color: "text.secondary" }}>Opening {title}…</Typography>
            </Stack>
          )}
          <Box
            component="iframe"
            key={frameKey}
            src={embedUrl(event.path)}
            title={title}
            onLoad={() => setFrameLoading(false)}
            sx={{ border: 0, width: "100%", height: "100%", bgcolor: "background.default" }}
          />
        </Box>
      </Box>
    );
  }

  if (event.type === "view") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {header(<Typography noWrap sx={{ fontWeight: 600, fontSize: "0.9rem" }}>{event.title}</Typography>)}
        <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
          {!!event.stats?.length && (
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 1.5, mb: 2 }}>
              {event.stats.map((s) => (
                <Box key={s.label} sx={{ p: 1.5, borderRadius: 2.5, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
                  <Typography sx={{ fontSize: "0.7rem", color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</Typography>
                  <Typography sx={{ fontSize: "1.25rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.value}</Typography>
                </Box>
              ))}
            </Box>
          )}
          {!!event.columns?.length && (
            <Box sx={{ overflowX: "auto", border: "1px solid", borderColor: "divider", borderRadius: 2.5 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {event.columns.map((c) => (
                      <TableCell key={c} sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>{c}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(event.rows || []).map((r, i) => (
                    <TableRow key={i} hover>
                      {r.map((v, j) => (
                        <TableCell key={j} sx={{ whiteSpace: "nowrap", textAlign: typeof v === "number" || /^-?[\d,]+\.\d{2}$/.test(String(v ?? "")) ? "right" : "left", fontVariantNumeric: "tabular-nums" }}>
                          {v == null ? "" : typeof v === "number" ? v.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {!event.rows?.length && (
                    <TableRow>
                      <TableCell colSpan={event.columns.length} sx={{ color: "text.secondary" }}>Nothing to show.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          )}
          {event.note && <Typography sx={{ mt: 1.5, fontSize: "0.8rem", color: "text.secondary" }}>{event.note}</Typography>}
        </Box>
      </Box>
    );
  }

  // document
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {header(
        preview && !preview.error ? (
          <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 700, fontSize: "0.9rem" }}>
                {preview.type} {preview.number}
              </Typography>
              <Typography noWrap sx={{ fontSize: "0.75rem", color: "text.secondary" }}>
                {[preview.customer, money(preview.total, preview.currency)].filter(Boolean).join(" · ")}
              </Typography>
            </Box>
            <Chip size="small" label={(preview.status || "").replace(/_/g, " ")} color={statusColor(preview.status || "")} sx={{ textTransform: "capitalize", flexShrink: 0 }} />
          </Stack>
        ) : (
          <Typography sx={{ fontWeight: 600, fontSize: "0.9rem" }}>Document</Typography>
        ),
        preview && !preview.error ? (
          <>
            {/* The full editor, full page. Editing inside a 400px column was
                tried and dropped (guru 2026-10-14): change it by chat, or open it. */}
            <Button
              size="small"
              variant="outlined"
              startIcon={<EditOutlinedIcon />}
              onClick={() => router.push(preview.editorPath)}
              data-tour="chat-panel-open-editor"
              sx={{ textTransform: "none", whiteSpace: "nowrap", backgroundImage: "none" }}
            >
              Open in editor
            </Button>
            <Tooltip title="Refresh preview">
              <IconButton size="small" onClick={() => load(true)} aria-label="Refresh preview"><RefreshIcon fontSize="small" /></IconButton>
            </Tooltip>
          </>
        ) : undefined,
      )}
      <Box sx={{ flex: 1, minHeight: 0, position: "relative", bgcolor: "var(--surface-container-low)" }}>
        {loading && (
          <Stack alignItems="center" justifyContent="center" sx={{ position: "absolute", inset: 0, zIndex: 1 }}>
            <CircularProgress size={28} />
            <Typography sx={{ mt: 1, fontSize: "0.8rem", color: "text.secondary" }}>Rendering the document…</Typography>
          </Stack>
        )}
        {preview?.error && (
          <Typography sx={{ p: 2, color: "error.main", fontSize: "0.85rem" }}>{preview.error}</Typography>
        )}
        {preview && !preview.error && preview.pdfUrl && (
          <Box component="iframe" key={`p${frameKey}`} src={`${preview.pdfUrl}#toolbar=0&view=FitH`} title="Preview" sx={{ width: "100%", height: "100%", border: 0 }} />
        )}
        {preview && !preview.error && !preview.pdfUrl && !loading && (
          <Stack alignItems="center" justifyContent="center" sx={{ height: "100%", p: 3, textAlign: "center" }}>
            <Typography sx={{ fontSize: "0.85rem", color: "text.secondary" }}>No preview for this document type yet.</Typography>
            <Button size="small" sx={{ mt: 1, textTransform: "none" }} onClick={() => router.push(preview.editorPath)}>Open in editor</Button>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
