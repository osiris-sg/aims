"use client";

// Round BB — "See all emails" › "Not about a shipment": the mail AIMS left out of the inbox (calendar replies,
// newsletters, auto-replies, and mail the sender filter dropped), from GET /email-inbox/hidden. Date, from domain,
// subject, why; "Actually it is" brings one back (→ Unprocessed, so AIMS reads it again). Rows open nothing (there
// is no record), so the button is the row's only control. Same list as Settings → Shipping → Email filter › Hidden.

import React, { useState } from "react";
import { Alert, Button, CircularProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useShipmentsApi } from "../../_lib/api";
import { fmtDateTime } from "../../_lib/format";
import { toast } from "../../_lib/toast";

export function HiddenEmailsList({ onChanged }: { onChanged?: () => Promise<unknown> | void }) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const hidden = useQuery({ queryKey: ["trade-inbox", "hidden"], queryFn: () => api.inboxHidden(), staleTime: 30_000 });
  const t = useTranslations("inbox.emailsAll");
  const tf = useTranslations("inbox.filter");
  const [busy, setBusy] = useState<string | null>(null);
  const unhide = async (id: string) => {
    setBusy(id);
    try {
      await api.inboxUnhide(id);
      toast.success(t("backInInbox"));
      await Promise.all([qc.invalidateQueries({ queryKey: ["trade-inbox"] }), onChanged?.()]);
    } catch (e) {
      toast.error((e as Error)?.message || t("couldNotUnhide"));
    } finally {
      setBusy(null);
    }
  };
  if (hidden.isError) return <Alert severity="error">{(hidden.error as Error)?.message || t("couldNotLoad")}</Alert>;
  if (hidden.isLoading) return <CircularProgress />;
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("notShipmentHelp")}
      </Typography>
      {!hidden.data?.length ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {t("nothingHidden")}
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small" data-tour="emails-not-shipment">
            <TableHead>
              <TableRow>
                <TableCell>{tf("date")}</TableCell>
                <TableCell>{tf("fromDomain")}</TableCell>
                <TableCell>{tf("subject")}</TableCell>
                <TableCell>{tf("why")}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {hidden.data.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.date)}</TableCell>
                  <TableCell sx={{ wordBreak: "break-word" }}>{r.fromDomain}</TableCell>
                  <TableCell sx={{ maxWidth: 380 }}>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                      {r.subject || tf("noSubject")}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {r.reason ?? "-"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy === r.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void unhide(r.id);
                      }}
                      sx={{ textTransform: "none", whiteSpace: "nowrap" }}
                      data-tour="emails-actually-shipment"
                    >
                      {t("actuallyIs")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </>
  );
}
