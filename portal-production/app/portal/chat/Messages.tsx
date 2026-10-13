"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Box, Button, Chip, Stack, Typography, alpha } from "@mui/material";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { marked } from "marked";
import type { ChatItem, PendingAction } from "./useOperatorChat";

marked.setOptions({ breaks: true, gfm: true });

/** Markdown → safe HTML. The text is our own assistant's, but it can quote
 *  user input, so scripts and inline handlers are stripped all the same. */
function render(md: string): string {
  const html = marked.parse(md || "", { async: false }) as string;
  if (typeof window === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || (a.name === "href" && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  });
  return doc.body.innerHTML;
}

// Older transcript lines carry only the file url; the document id sits in
// the S3 key (`<uuid>_<timestamp>.pdf`).
const docIdOf = (m: ChatItem): string | undefined =>
  m.documentId || /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[^/?]*\.pdf/i.exec(m.url || "")?.[1];

const timeOf = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("en-SG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export const MARKDOWN_SX = {
  "& p": { m: 0, mb: 1 },
  "& p:last-child": { mb: 0 },
  "& ul, & ol": { m: 0, mb: 1, pl: 2.5 },
  "& li": { mb: 0.25 },
  "& code": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.85em", px: 0.5, borderRadius: 0.5, bgcolor: "action.hover" },
  "& pre": { p: 1.25, borderRadius: 1.5, overflowX: "auto", bgcolor: "action.hover" },
  "& table": { borderCollapse: "collapse", my: 1, fontSize: "0.8125rem" },
  "& th, & td": { border: "1px solid", borderColor: "divider", px: 1, py: 0.5, textAlign: "left" },
  "& th": { fontWeight: 600, bgcolor: "action.hover" },
  "& a": { color: "primary.main" },
  "& h1, & h2, & h3, & h4": { fontSize: "1rem", fontWeight: 700, mt: 1, mb: 0.5 },
  "& strong": { fontWeight: 700 },
} as const;

interface Props {
  items: ChatItem[];
  pending: PendingAction[];
  status: string | null;
  sending: boolean;
  channel: "web" | "whatsapp" | "telegram";
  onTap: (data: string) => void;
  onOpenDocument: (documentId: string) => void;
}

export default function Messages({ items, pending, status, sending, channel, onTap, onOpenDocument }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  // Keep the newest line in view: a new message, a status change, the
  // Confirm card appearing, or a long reply still streaming in.
  useEffect(() => {
    const t = setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 30);
    return () => clearTimeout(t);
  }, [items.length, status, pending.length, sending]);

  // A Confirm/Cancel pair is live only while its action is still held. Once
  // the user has answered (or it expired) the buttons go quiet, so an old card
  // can't be tapped twice by accident.
  const livePending = useMemo(() => new Set(pending.map((p) => p.id).filter(Boolean)), [pending]);
  const lastButtonsIdx = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "buttons" || items[i].kind === "list") return i;
    return -1;
  }, [items]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, px: { xs: 2, md: 3 }, py: 2 }}>
      {items.map((m, idx) => {
        const mine = m.role === "user";
        const confirmId = m.buttons?.find((b) => b.data.startsWith("confirm:"))?.data.slice(8);
        const isConfirmCard = !!confirmId;
        const live = isConfirmCard ? livePending.has(confirmId!) : idx === lastButtonsIdx && !sending;
        return (
          <Stack key={m.id} direction="row" justifyContent={mine ? "flex-end" : "flex-start"} alignItems="flex-end" gap={1}>
            <Box
              sx={{
                maxWidth: { xs: "92%", md: "78%" },
                minWidth: 0,
                px: 1.75,
                py: 1.25,
                borderRadius: 3,
                borderTopRightRadius: mine ? 6 : 24,
                borderTopLeftRadius: mine ? 24 : 6,
                fontSize: "0.9rem",
                lineHeight: 1.55,
                wordBreak: "break-word",
                ...(mine
                  ? { bgcolor: "primary.main", color: "primary.contrastText", backgroundImage: "none" }
                  : { bgcolor: "background.paper", border: "1px solid", borderColor: "divider", color: "text.primary" }),
              }}
            >
              {m.kind === "document" && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PictureAsPdfOutlinedIcon />}
                  endIcon={<OpenInNewIcon sx={{ fontSize: "0.9rem !important" }} />}
                  // An AIMS document opens in the side panel; any other file
                  // (an uploaded invoice) is a plain link in a new tab.
                  {...(docIdOf(m)
                    ? { onClick: () => onOpenDocument(docIdOf(m)!) }
                    : { component: "a", href: m.url, target: "_blank", rel: "noopener noreferrer" })}
                  title={docIdOf(m) ? "Show in the side panel" : "Open the file"}
                  sx={{ mb: m.text ? 1 : 0, textTransform: "none", maxWidth: "100%", justifyContent: "flex-start" }}
                >
                  <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.filename || "Document"}
                  </Box>
                </Button>
              )}
              {m.text && (
                mine ? (
                  <Typography sx={{ whiteSpace: "pre-wrap", fontSize: "inherit", lineHeight: "inherit" }}>{m.text}</Typography>
                ) : (
                  <Box sx={MARKDOWN_SX} dangerouslySetInnerHTML={{ __html: render(m.text) }} />
                )
              )}
              {(m.kind === "buttons" || m.kind === "list") && !!m.buttons?.length && (
                <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1.25 }}>
                  {m.buttons.map((b) => {
                    const isConfirm = b.data.startsWith("confirm:");
                    const isCancel = b.data.startsWith("cancel");
                    return (
                      <Button
                        key={b.data}
                        size="small"
                        disabled={!live}
                        onClick={() => onTap(b.data)}
                        variant={isConfirm ? "contained" : "outlined"}
                        color={isConfirm ? "success" : isCancel ? "inherit" : "primary"}
                        startIcon={isConfirm ? <CheckRoundedIcon /> : isCancel ? <CloseRoundedIcon /> : undefined}
                        title={b.description}
                        sx={{ textTransform: "none", borderRadius: 999, backgroundImage: "none" }}
                      >
                        {b.label.replace(/^[✅❌]\s*/, "")}
                      </Button>
                    );
                  })}
                </Stack>
              )}
              <Stack direction="row" alignItems="center" justifyContent="flex-end" gap={0.5} sx={{ mt: 0.5, opacity: 0.6 }}>
                {m.via === "whatsapp" && channel === "whatsapp" && <WhatsAppIcon sx={{ fontSize: "0.8rem" }} titleAccess="Sent on WhatsApp" />}
                <Typography sx={{ fontSize: "0.65rem" }}>{timeOf(m.at)}</Typography>
              </Stack>
            </Box>
          </Stack>
        );
      })}

      {(status || sending) && (
        <Stack direction="row" alignItems="center" gap={1} sx={{ pl: 0.5 }}>
          <Box sx={{ display: "flex", gap: 0.5, "& span": { width: 6, height: 6, borderRadius: "50%", bgcolor: "text.secondary", animation: "aimsDot 1.2s infinite" }, "& span:nth-of-type(2)": { animationDelay: "0.2s" }, "& span:nth-of-type(3)": { animationDelay: "0.4s" }, "@keyframes aimsDot": { "0%, 80%, 100%": { opacity: 0.25 }, "40%": { opacity: 1 } } }}>
            <span /><span /><span />
          </Box>
          <Typography sx={{ fontSize: "0.8rem", color: "text.secondary" }}>{status || "Working…"}</Typography>
        </Stack>
      )}
      {!!pending.length && !sending && (
        <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ pl: 0.5 }}>
          {pending.map((p) => (
            <Chip
              key={p.id || p.summary}
              size="small"
              label={`Waiting for your confirmation: ${p.summary.split("\n")[0].slice(0, 70)}`}
              sx={{ bgcolor: (t) => alpha(t.palette.warning.main, 0.15), color: "text.primary", maxWidth: "100%" }}
            />
          ))}
        </Stack>
      )}
      <div ref={endRef} />
    </Box>
  );
}
