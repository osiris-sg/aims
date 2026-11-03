"use client";

// Round AB — ONE question card in the list (owner: every question as its own card, numbered). Top to bottom: the
// number badge + the question (prominent); the subject in full (round AD, owner: it WRAPS, never clamped or cut with
// "…"); "Vedanta · 22 Oct 14:31"; the stored one-line summary of the email, muted and wrapping (display text only — it never
// drives an action); "Answer" (→ the round AA Choose-shipment dialog: nothing applies until Confirm) and "Show full
// email" (→ the thread pop-up). Styled like the Operations dashboard's cards (outlined, same padding, small grey
// labels, accent button). EN / JA from the API. No em dashes.
// Round BB (owner) — one concrete best guess: the headline ("Is this the B/L of #26-1?"), the evidence with the
// matching bit highlighted (a conflict in the error colour, the file as a small chip), "Yes: <what Yes does>", then
// [Yes] (AIMS's guess; up to 2 alternatives as small buttons under it), [Other…] (the step-by-step dialog, as Answer
// was) and [Not sure → ask Elroy/Take] (a note, then the card goes to the admins). A card handed to the admins shows
// "Asked Elroy/Take" and no answer buttons to everyone else; an admin sees who asked and the normal buttons. A card
// with no guess shows only Other… and Not sure. In a batch the card carries a checkbox ("Yes to the ticked ones").

import React, { useState } from "react";
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import type { CardChoice, CardEvidence, InboxAnswer, InboxLang, InboxThread, InboxViewer } from "../../_lib/api";
import { cardHeadline, cardSummary, cardWhoLine, choiceAction, evidenceFile, evidenceParts, fullSubject } from "../../_lib/inbox-cards";
import { useInboxLabels } from "./useInboxLabels";
import { ChooseShipmentDialog, type ChooseStart } from "./ChooseShipmentDialog";

export interface QuestionCardProps {
  t: InboxThread;
  lang: InboxLang;
  /** 1-based place in the list — the small circular badge. */
  n: number;
  busy?: boolean;
  onAnswer: (t: InboxThread, a: InboxAnswer) => void;
  onCreateOrder: (t: InboxThread) => void;
  onOpenThread: (t: InboxThread) => void;
  /** Round BB: who is looking (admin = may answer cards handed to the admins). */
  viewer?: InboxViewer | null;
  /** Round BB: in a batch, the "Yes to the ticked ones" checkbox. */
  pick?: { checked: boolean; onChange: (checked: boolean) => void } | null;
  /** Round BB: tighter padding (cards inside a batch). */
  compact?: boolean;
}

/** One evidence line: the mark highlighted (theme-aware), a conflict in the error colour, the file as a small chip. */
function EvidenceLine({ e }: { e: CardEvidence }) {
  const file = evidenceFile(e);
  return (
    <Box component="li" sx={{ color: e.conflict ? "error.main" : "text.primary", "&::marker": { color: e.conflict ? "error.main" : "text.secondary" } }} data-tour="question-evidence" data-conflict={e.conflict ? "1" : undefined}>
      <Typography component="span" variant="body2" sx={{ wordBreak: "break-word", overflowWrap: "anywhere", color: "inherit", fontWeight: e.conflict ? 600 : undefined }}>
        {evidenceParts(e.text, e.mark).map((p, i) =>
          p.mark ? (
            <Box
              key={i}
              component="mark"
              sx={{
                color: "inherit",
                fontWeight: 700,
                borderRadius: 0.5,
                px: 0.25,
                bgcolor: (th) => alpha(e.conflict ? th.palette.error.main : th.palette.warning.main, th.palette.mode === "dark" ? 0.3 : 0.22),
              }}
            >
              {p.text}
            </Box>
          ) : (
            <React.Fragment key={i}>{p.text}</React.Fragment>
          ),
        )}
      </Typography>
      {file && <Chip size="small" variant="outlined" icon={<AttachFileIcon sx={{ fontSize: 13 }} />} label={file} sx={{ ml: 0.75, height: 20, maxWidth: "100%", "& .MuiChip-label": { px: 0.75, fontSize: 12 } }} />}
    </Box>
  );
}

export function QuestionCard({ t, lang, n, busy, onAnswer, onCreateOrder, onOpenThread, viewer, pick, compact }: QuestionCardProps) {
  const q = t.question;
  // null = closed; {} = the dialog as Answer opened it; { start } = straight to a new shipment for that order.
  const [choose, setChoose] = useState<{ start?: ChooseStart } | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const newest = t.messages[0];
  const labels = useInboxLabels();
  if (!q || !newest) return null;
  const subject = fullSubject(t.subject ?? newest.subject, lang);
  const summary = cardSummary(newest);
  const evidence = q.evidence ?? [];
  const guess = q.guess ?? null;
  const alternatives = (q.alternatives ?? []).slice(0, 2);
  const admin = !!viewer?.admin;
  const asked = q.asked ?? null;
  const waitingOnAdmins = !!asked && !admin;
  const run = (c: CardChoice) => {
    const a = choiceAction(c);
    if (a.do === "answer") onAnswer(t, a.answer);
    else if (a.do === "new_shipment") setChoose({ start: { newShipmentFor: a.orderId } });
    else if (a.do === "create_order") onCreateOrder(t);
    else setChoose({});
  };
  const sendAsk = () => {
    const note = (ask ?? "").trim();
    setAsk(null);
    onAnswer(t, { kind: "ask_admin", note: note || null });
  };
  return (
    <Paper variant="outlined" sx={{ p: compact ? { xs: 1.25, md: 1.5 } : { xs: 1.5, md: 2 } }} data-tour="question-card" data-kind={q.kind}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        {pick && (
          <Checkbox size="small" checked={pick.checked} onChange={(e) => pick.onChange(e.target.checked)} inputProps={{ "aria-label": labels.batchPick }} sx={{ p: 0.25, mt: 0.25 }} data-tour="question-batch-pick" />
        )}
        <Box
          sx={{ mt: 0.25, width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, bgcolor: "primary.lighter", color: "primary.main", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
          data-tour="question-number"
          aria-label={`${n}`}
        >
          {n}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {asked && admin && (
            <Alert severity="info" sx={{ mb: 1, py: 0, "& .MuiAlert-message": { wordBreak: "break-word" } }} data-tour="question-asked-banner">
              {labels.askedBy(asked.by, asked.note)}
            </Alert>
          )}
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3, wordBreak: "break-word" }} data-tour="question-title">
            {cardHeadline(q)}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.75, fontWeight: 600, wordBreak: "break-word", overflowWrap: "anywhere" }} lang={/[぀-ヿ一-鿿]/.test(subject) ? "ja" : undefined} data-tour="question-subject">
            {subject}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.25 }} title={newest.from} data-tour="question-from">
            {cardWhoLine(newest, lang)}
          </Typography>
          {evidence.length > 0 ? (
            <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.5, display: "flex", flexDirection: "column", gap: 0.25 }} data-tour="question-evidence-list">
              {evidence.slice(0, 4).map((e, i) => (
                <EvidenceLine key={i} e={e} />
              ))}
            </Box>
          ) : (
            summary && (
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, wordBreak: "break-word", overflowWrap: "anywhere" }} data-tour="question-summary">
                {summary}
              </Typography>
            )
          )}
          {q.yesLine && guess && !waitingOnAdmins && (
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75, wordBreak: "break-word" }} data-tour="question-yes-line">
              <Box component="span" sx={{ fontWeight: 700, mr: 0.5 }}>
                {labels.yesPrefix}
              </Box>
              {q.yesLine}
            </Typography>
          )}
          {waitingOnAdmins && (
            <Box sx={{ mt: 1 }} data-tour="question-asked">
              <Chip size="small" color="info" variant="outlined" label={labels.askedChip} />
              {asked?.note && (
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5, wordBreak: "break-word" }}>
                  {asked.note}
                </Typography>
              )}
            </Box>
          )}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
            {!waitingOnAdmins && guess && (
              <Button size="small" variant="contained" disabled={busy} onClick={() => run(guess)} sx={{ textTransform: "none" }} title={guess.label} data-tour="question-yes">
                {labels.yes}
              </Button>
            )}
            {!waitingOnAdmins && (
              <Button size="small" variant={guess ? "outlined" : "contained"} disabled={busy} onClick={() => setChoose({})} sx={{ textTransform: "none" }} data-tour="question-other">
                {labels.other}
              </Button>
            )}
            {!waitingOnAdmins && (
              <Button size="small" variant="outlined" color="inherit" disabled={busy} onClick={() => setAsk("")} sx={{ textTransform: "none" }} data-tour="question-ask-admin">
                {labels.askAdmin}
              </Button>
            )}
            <Button size="small" variant="outlined" color="inherit" onClick={() => onOpenThread(t)} sx={{ textTransform: "none" }} data-tour="question-show-full">
              {labels.showFull}
            </Button>
          </Stack>
          {!waitingOnAdmins && guess && alternatives.length > 0 && (
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }} data-tour="question-alternatives">
              {alternatives.map((c, i) => (
                <Chip key={i} size="small" variant="outlined" clickable disabled={busy} label={c.label} onClick={() => run(c)} sx={{ maxWidth: "100%", height: "auto", minHeight: 24, "& .MuiChip-label": { whiteSpace: "normal", wordBreak: "break-word", py: 0.25 } }} data-tour="question-alternative" />
              ))}
            </Stack>
          )}
        </Box>
      </Stack>
      <ChooseShipmentDialog open={!!choose} start={choose?.start ?? null} t={t} lang={lang} busy={busy} onClose={() => setChoose(null)} onAnswer={onAnswer} onCreateOrder={onCreateOrder} />
      <Dialog open={ask !== null} onClose={() => setAsk(null)} fullWidth maxWidth="xs" data-tour="question-ask-admin-dialog">
        <DialogTitle sx={{ pb: 1 }}>{labels.askAdminTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
            {labels.askAdminHelp}
          </Typography>
          <TextField autoFocus fullWidth multiline minRows={2} size="small" label={labels.askAdminNote} value={ask ?? ""} onChange={(e) => setAsk(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsk(null)} sx={{ textTransform: "none" }}>
            {labels.cancel}
          </Button>
          <Button variant="contained" disabled={busy} onClick={sendAsk} sx={{ textTransform: "none" }} data-tour="question-ask-admin-send">
            {labels.send}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
