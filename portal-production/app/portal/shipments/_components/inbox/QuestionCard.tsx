"use client";

// Round W — the QUESTION CARD of an unprocessed thread (owner: "friendly question cards instead of chips").
// A plain-language question as the title, one line "What AIMS found", the latest email's first lines (expand
// for the full email), then big answer options — each a record with its summary and why — plus "New deal →
// Create order", "Not about a shipment" / "Not a deal" and "Ask later". One tap = done. EN / JA from the API.

import React, { useState } from "react";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import type { InboxAnswer, InboxLang, InboxQuestionOption, InboxThread } from "../../_lib/api";
import { L } from "../../_lib/inbox-cards";
import { fromParts, whenShort } from "../../_lib/inbox-threads";
import { EmailDialog } from "./EmailDialog";

export interface QuestionCardProps {
  t: InboxThread;
  lang: InboxLang;
  busy?: boolean;
  onAnswer: (t: InboxThread, a: InboxAnswer) => void;
  onCreateOrder: (t: InboxThread) => void;
  onOpenThread: (t: InboxThread) => void;
  /** "Question 1 of 4" in queue mode. */
  position?: string | null;
}

function OptionCard({ o, lang, busy, onPick }: { o: InboxQuestionOption; lang: InboxLang; busy?: boolean; onPick: () => void }) {
  return (
    <Paper
      variant="outlined"
      role="button"
      tabIndex={0}
      onClick={() => !busy && onPick()}
      onKeyDown={(e) => e.key === "Enter" && !busy && onPick()}
      sx={{ p: 1.5, cursor: busy ? "default" : "pointer", borderColor: o.suggested ? "primary.main" : "divider", borderWidth: o.suggested ? 2 : 1, "&:hover": { bgcolor: "action.hover" }, minWidth: 0 }}
      data-tour="question-option"
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.25 }}>
        {o.summary}
      </Typography>
      {o.why && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {o.why}
        </Typography>
      )}
      {o.suggested && <Chip size="small" color="primary" label={lang === "ja" ? "AIMSの候補" : "AIMS’s pick"} sx={{ mt: 0.75, height: 20 }} />}
    </Paper>
  );
}

export function QuestionCard({ t, lang, busy, onAnswer, onCreateOrder, onOpenThread, position }: QuestionCardProps) {
  const q = t.question;
  const [full, setFull] = useState(false);
  const newest = t.messages[0];
  const from = fromParts(newest?.from);
  const labels = L[lang];
  if (!q || !newest) return null;
  const earlier = t.earlier ?? 0;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }} data-tour="question-card" data-kind={q.kind}>
      <Stack spacing={1.25}>
        <Box>
          {position && (
            <Typography variant="caption" color="text.secondary">
              {position}
            </Typography>
          )}
          <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.3 }} data-tour="question-title">
            {q.title}
          </Typography>
          {q.found && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-tour="question-found">
              {q.found}
            </Typography>
          )}
        </Box>

        {/* The latest email: who, when, the first lines; "Show the full email" opens it in a pop-up. */}
        <Box sx={{ borderLeft: "3px solid", borderColor: "divider", pl: 1.5 }} data-tour="question-email">
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap title={newest.from}>
              {from.name}
            </Typography>
            {newest.company && <Chip size="small" variant="outlined" label={newest.company} sx={{ height: 20 }} />}
            <Typography variant="caption" color="text.secondary">
              {whenShort(newest.date)}
            </Typography>
            {newest.attachments.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
                <AttachFileIcon sx={{ fontSize: 14 }} /> {newest.attachments.map((a) => a.name).join(", ")}
              </Typography>
            )}
          </Stack>
          <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.25 }} noWrap title={newest.subject ?? ""}>
            {newest.subject || "(no subject)"}
          </Typography>
          {newest.preview && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {newest.preview}
            </Typography>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
            <Button size="small" onClick={() => setFull(true)} sx={{ textTransform: "none", px: 0.5 }} data-tour="question-show-full">
              {labels.showFull}
            </Button>
            {earlier > 0 && (
              <Button size="small" onClick={() => onOpenThread(t)} sx={{ textTransform: "none", px: 0.5 }} data-tour="question-earlier">
                {labels.earlier(earlier)}
              </Button>
            )}
          </Stack>
          <EmailDialog message={newest} lang={lang} open={full} onClose={() => setFull(false)} />
        </Box>

        {q.kind === "NEW_DEAL" && q.details.length > 0 && (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap data-tour="question-details">
            {q.details.map((d) => (
              <Chip key={d} size="small" variant="outlined" label={d} />
            ))}
          </Stack>
        )}

        {q.options.length > 0 && (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: q.options.length > 1 ? "1fr 1fr" : "1fr" }, gap: 1 }} data-tour="question-options">
            {q.options.map((o) => (
              <OptionCard key={o.id} o={o} lang={lang} busy={busy} onPick={() => onAnswer(t, { kind: "record", orderId: o.orderId, shipmentId: o.shipmentId })} />
            ))}
          </Box>
        )}

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap data-tour="question-extras">
          {q.extras.createOrder && (
            <Button variant={q.kind === "NEW_DEAL" ? "contained" : "outlined"} disabled={busy} onClick={() => onCreateOrder(t)} sx={{ textTransform: "none" }} data-tour="question-create-order">
              {q.kind === "NEW_DEAL" ? labels.createOrderShort : labels.createOrder}
            </Button>
          )}
          {q.extras.notDeal && (
            <Button variant="outlined" color="inherit" disabled={busy} onClick={() => onAnswer(t, { kind: "not_deal" })} sx={{ textTransform: "none" }} data-tour="question-not-deal">
              {labels.notDeal}
            </Button>
          )}
          {q.extras.notShipment && (
            <Button variant="outlined" color="inherit" disabled={busy} onClick={() => onAnswer(t, { kind: "not_shipment" })} sx={{ textTransform: "none" }} data-tour="question-not-shipment">
              {labels.notShipment}
            </Button>
          )}
          {q.extras.askLater && (
            <Button variant="text" color="inherit" disabled={busy} onClick={() => onAnswer(t, { kind: "later" })} sx={{ textTransform: "none" }} data-tour="question-ask-later">
              {labels.askLater}
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
