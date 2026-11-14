"use client";

// A module's MAIN PAGE (guru 2026-11-14: "once selected accounting, should go
// default screen … build main pages for all of those as well"): the page the
// role-home bar opens when a module is picked. A row of figures that matter
// for the module, then one tile per sub-page of the module as the org has it
// (the same list the bar shows), so the page is the module's front door.
// Sales = /portal/sales, Inventory = /portal/inventory/overview; Accounting
// opens the Trial Balance instead (an existing page).

import * as React from "react";
import Link from "next/link";
import { Box, ButtonBase, Stack, Typography, alpha, useTheme } from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import RequestQuoteOutlinedIcon from "@mui/icons-material/RequestQuoteOutlined";
import ShoppingCartOutlinedIcon from "@mui/icons-material/ShoppingCartOutlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import NoteAltOutlinedIcon from "@mui/icons-material/NoteAltOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import ShoppingBagOutlinedIcon from "@mui/icons-material/ShoppingBagOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import ViewListOutlinedIcon from "@mui/icons-material/ViewListOutlined";
import AssignmentReturnOutlinedIcon from "@mui/icons-material/AssignmentReturnOutlined";
import { resolveSubmenuRoute, submenuLabel, useNavLabels, useNavModules } from "@/components/TopNav/useNavModules";
import { withActiveOrg } from "@/helpers/request";

export type ModuleStat = { label: string; value: string | null; sub?: string; href?: string; tone?: "default" | "warn" | "accent" };

const TILE_ICON: Array<[RegExp, SvgIconComponent, string]> = [
  [/quotation/i, RequestQuoteOutlinedIcon, "#6C5CE7"],
  [/sales order/i, ShoppingCartOutlinedIcon, "#0E9F6E"],
  [/return/i, AssignmentReturnOutlinedIcon, "#D97706"],
  [/delivery/i, LocalShippingOutlinedIcon, "#2563EB"],
  [/invoice/i, ReceiptLongOutlinedIcon, "#0891B2"],
  [/note/i, NoteAltOutlinedIcon, "#9333EA"],
  [/product/i, Inventory2OutlinedIcon, "#0E9F6E"],
  [/purchase/i, ShoppingBagOutlinedIcon, "#2563EB"],
  [/adjust/i, TuneOutlinedIcon, "#D97706"],
  [/report/i, AssessmentOutlinedIcon, "#6C5CE7"],
  [/stock/i, ViewListOutlinedIcon, "#0891B2"],
];
const iconFor = (label: string): [SvgIconComponent, string] => {
  const hit = TILE_ICON.find(([re]) => re.test(label));
  return hit ? [hit[1], hit[2]] : [DescriptionOutlinedIcon, "#64748B"];
};

/** The module's sub-pages exactly as the org's menu lists them. */
export function useModuleScreens(code: string): Array<{ label: string; path: string }> {
  const { navModules } = useNavModules();
  const { subLabel } = useNavLabels();
  return React.useMemo(() => {
    const m = navModules.find((x: any) => x.moduleCode === code);
    if (!m) return [];
    return ((m.config as any)?.subMenus || []).map((s: any) => ({ label: subLabel(m, s, submenuLabel(s)), path: resolveSubmenuRoute(m, s) }));
  }, [navModules, code, subLabel]);
}

export default function ModuleHome({ code, title, stats, loading }: { code: string; title: string; stats: ModuleStat[]; loading?: boolean }) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const screens = useModuleScreens(code);
  const card = {
    borderRadius: "18px",
    bgcolor: dark ? alpha("#fff", 0.04) : "#fff",
    border: "1px solid",
    borderColor: dark ? alpha("#fff", 0.08) : "#E6E8F0",
  } as const;
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1440, mx: "auto" }} data-testid={`module-home-${code}`}>
      <Typography sx={{ fontSize: 22, fontWeight: 700, mb: 2 }}>{title}</Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", lg: `repeat(${Math.min(stats.length, 6)}, 1fr)` }, gap: 1.5, mb: 3 }}>
        {stats.map((s) => {
          const body = (
            <Box sx={{ ...card, p: 2, height: "100%", ...(s.href ? { "&:hover": { borderColor: "primary.main" } } : {}) }}>
              <Typography sx={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "text.secondary" }}>{s.label}</Typography>
              <Typography sx={{ fontSize: 24, fontWeight: 700, mt: 0.5, color: s.tone === "warn" ? "warning.main" : s.tone === "accent" ? "primary.main" : "text.primary", fontVariantNumeric: "tabular-nums" }}>
                {loading && s.value === null ? "—" : s.value ?? "—"}
              </Typography>
              {s.sub && <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.25 }}>{s.sub}</Typography>}
            </Box>
          );
          return s.href ? (
            <Link key={s.label} href={withActiveOrg(s.href)} style={{ textDecoration: "none", color: "inherit" }} data-testid="module-home-stat">
              {body}
            </Link>
          ) : (
            <Box key={s.label} data-testid="module-home-stat">{body}</Box>
          );
        })}
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", md: "repeat(4, 1fr)", lg: "repeat(5, 1fr)" }, gap: 1.5 }}>
        {screens.map((sc) => {
          const [Icon, bg] = iconFor(sc.label);
          return (
            <ButtonBase
              key={sc.path}
              component={Link}
              href={withActiveOrg(sc.path)}
              data-testid="module-home-tile"
              sx={{ ...card, p: 2.5, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1.5, textAlign: "left", "&:hover": { borderColor: "primary.main", "& .tile-ic": { transform: "scale(1.08)" } }, "& .tile-ic": { transition: "transform .15s" } }}
            >
              <Box className="tile-ic" sx={{ width: 44, height: 44, borderRadius: "14px", bgcolor: bg, display: "grid", placeItems: "center" }}>
                <Icon sx={{ color: "#fff", fontSize: 22 }} />
              </Box>
              <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{sc.label}</Typography>
            </ButtonBase>
          );
        })}
      </Box>
      {screens.length === 0 && !loading && (
        <Stack alignItems="center" sx={{ py: 6, color: "text.secondary" }}><Typography>No pages in this module.</Typography></Stack>
      )}
    </Box>
  );
}
