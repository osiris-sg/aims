"use client";

// The sender filter's preview (what it kept / would drop, from-domain + subject
// 60 only — never bodies or addresses). Round P: lives in Org Settings →
// Shipping → Email filter (it left the Inbox, which now shows only
// Unprocessed / Processed mail).

import React, { useState } from "react";
import { Alert, Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useShipmentsApi, type FilterPreview } from "../_lib/api";
import { fmtDateTime } from "../_lib/format";
import { toast } from "../_lib/toast";
import { Button } from "@mui/material";

/** Round Q: the accept rate (moved from the Inbox) and the emails hidden as obvious non-shipment mail, with Unhide. */
export function EmailFilterExtras() {
  const api = useShipmentsApi();
  const stats = useQuery({ queryKey: ["trade-inbox", "stats"], queryFn: () => api.inboxStats(30), staleTime: 60_000 });
  const hidden = useQuery({ queryKey: ["trade-inbox", "hidden"], queryFn: () => api.inboxHidden(), staleTime: 30_000 });
  const t = useTranslations("inbox.filter");
  const [busy, setBusy] = useState<string | null>(null);
  const unhide = async (id: string) => {
    setBusy(id);
    try {
      await api.inboxUnhide(id);
      toast.success(t("backInInbox"));
      await hidden.refetch();
    } catch (e) {
      toast.error((e as Error)?.message || t("couldNotUnhide"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Box sx={{ mt: 3 }}>
      {stats.data && (stats.data.reviewed > 0 || stats.data.AUTO > 0) && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} data-tour="inbox-accept-rate">
          {t("stats", { days: stats.data.days, pct: stats.data.acceptedAsIsPct ?? "—", auto: stats.data.AUTO, changed: stats.data.CHANGED, rejected: stats.data.REJECTED })}
        </Typography>
      )}
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t("hidden", { n: hidden.data?.length ?? 0 })}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
        {t("hiddenHelp")}
      </Typography>
      {hidden.isLoading ? (
        <CircularProgress size={18} />
      ) : !hidden.data?.length ? (
        <Typography variant="body2" color="text.secondary">
          {t("nothingHidden")}
        </Typography>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small" data-tour="settings-hidden-emails">
            <TableHead>
              <TableRow>
                <TableCell>{t("date")}</TableCell>
                <TableCell>{t("fromDomain")}</TableCell>
                <TableCell>{t("subject")}</TableCell>
                <TableCell>{t("why")}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {hidden.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.date)}</TableCell>
                  <TableCell>{r.fromDomain}</TableCell>
                  <TableCell sx={{ maxWidth: 380 }}>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                      {r.subject || t("noSubject")}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {r.reason ?? "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" disabled={busy === r.id} onClick={() => void unhide(r.id)}>
                      {t("unhide")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
}

export default /** What the sender filter kept / would drop (SHADOW): from-domain + subject (60) only — never bodies or addresses. */
function FilterPreviewPanel() {
  const api = useShipmentsApi();
  const t = useTranslations("inbox.filter");
  const [show, setShow] = useState<"DROP" | "KEEP" | "ALL">("DROP");
  const q = useQuery({ queryKey: ["trade-inbox", "filter-preview"], queryFn: () => api.inboxFilterPreview(30), staleTime: 60_000 });
  const d: FilterPreview | undefined = q.data;
  const items = (d?.items ?? []).filter((r) => show === "ALL" || r.filterVerdict === show);
  const falseDrops = (d?.items ?? []).filter((r) => r.falseDrop).length;
  if (q.isError) return <Alert severity="error">{(q.error as Error)?.message || t("couldNotLoad")}</Alert>;
  if (q.isLoading) return <CircularProgress />;
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t.rich("intro", { days: d?.days ?? 30, kept: d?.kept ?? 0, dropped: d?.dropped ?? 0, b: (c) => <b>{c}</b> })}
        {falseDrops ? ` · ${t("falseDrops", { n: falseDrops })}` : ""}{t("period")}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        {(["DROP", "KEEP", "ALL"] as const).map((k) => (
          <Chip key={k} label={k === "DROP" ? t("wouldDrop") : k === "KEEP" ? t("kept") : t("all")} color={show === k ? "primary" : "default"} variant={show === k ? "filled" : "outlined"} onClick={() => setShow(k)} />
        ))}
      </Stack>
      {!items.length ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {d && d.kept + d.dropped === 0 ? t("noneJudged") : t("nothingHere")}
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small" data-tour="settings-filter-preview">
            <TableHead>
              <TableRow>
                <TableCell>{t("date")}</TableCell>
                <TableCell>{t("fromDomain")}</TableCell>
                <TableCell>{t("subject")}</TableCell>
                <TableCell>{t("filterCol")}</TableCell>
                <TableCell>{t("why")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.date)}</TableCell>
                  <TableCell>{r.fromDomain}</TableCell>
                  <TableCell sx={{ maxWidth: 380 }}>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                      {r.subject || t("noSubject")}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Chip size="small" variant="outlined" color={r.filterVerdict === "KEEP" ? "success" : "default"} label={r.filterVerdict === "KEEP" ? t("kept") : t("wouldDrop")} />
                    {r.falseDrop && <Chip size="small" color="error" variant="outlined" label={t("falseDrop")} title={t("triageSaid", { v: r.verdict })} sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {r.reason ?? "—"}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
}
