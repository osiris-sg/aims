"use client";
// Round BJ: the CI amount's versions (PROVISIONAL → FINAL / revised) under the field, and the latest version's amount
// when it isn't the stored one — "CI revised: 704,245.90 → 711,226.23 · Use this" (never applied without the click).
import React from "react";
import { Box, Link as MuiLink, Tooltip, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import type { CiProposal, CiVersion } from "../_lib/api";
import { fmtDay, fmtMoney } from "../_lib/format";

export default function CiVersionsNote({ versions, proposal, currency, onUse, busy }: { versions?: CiVersion[]; proposal?: CiProposal | null; currency?: string | null; onUse?: (amount: number) => void; busy?: boolean }) {
  const t = useTranslations("shipments.ciVersions");
  const list = versions ?? [];
  if (!proposal && list.length < 2) return null;
  return (
    <Box component="span" sx={{ display: "block" }} data-tour="ci-versions">
      {proposal && (
        <Box component="span" sx={{ display: "block", color: "warning.main", fontWeight: 600 }} data-tour="ci-proposal">
          {proposal.from === null ? t("latestIs", { to: fmtMoney(proposal.to, currency ?? "USD") }) : t("revised", { from: fmtMoney(proposal.from, currency ?? "USD"), to: fmtMoney(proposal.to, currency ?? "USD") })}
          {onUse && (
            <>
              {" · "}
              <MuiLink component="button" type="button" variant="caption" disabled={busy} onClick={() => onUse(proposal.to)} sx={{ verticalAlign: "baseline", fontWeight: 700 }}>
                {t("useThis")}
              </MuiLink>
            </>
          )}
        </Box>
      )}
      {list.length > 0 && (
        <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("history")}{" "}
          {list.map((v, i) => (
            <React.Fragment key={v.fileId}>
              {i > 0 ? " → " : null}
              <Tooltip title={`${v.fileName}${v.ciNumber ? ` · ${v.ciNumber}` : ""}${v.lme != null ? ` · LME ${v.lme}` : ""}`}>
                <Box component="span" sx={{ fontWeight: i === list.length - 1 ? 700 : 400, textDecoration: i === list.length - 1 ? "none" : "line-through" }}>
                  {v.status === "PROVISIONAL" ? t("provisional") : v.status === "FINAL" ? t("final") : t("version")} {v.ciDate ? fmtDay(v.ciDate) : ""} {v.amount != null ? fmtMoney(v.amount, currency ?? "USD") : ""}
                </Box>
              </Tooltip>
            </React.Fragment>
          ))}
        </Typography>
      )}
    </Box>
  );
}
