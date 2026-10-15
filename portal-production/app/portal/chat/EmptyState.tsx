"use client";

// What AIMEE shows before anything is said: a greeting, prompts that fit this user's role, and
// the modules they can reach, as cards. Everything here is derived from the
// same module + permission rules the navigation uses, so a role only sees
// what it can actually do.

import React from "react";
import { Box, Chip, Stack, Typography } from "@mui/material";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import AccountBalanceOutlinedIcon from "@mui/icons-material/AccountBalanceOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import WorkOutlineIcon from "@mui/icons-material/WorkOutline";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import { useUser } from "@clerk/nextjs";
import { useNavModules } from "@/components/TopNav/useNavModules";
import AimeeFace from "./AimeeFace";

const ICONS: Record<string, React.ElementType> = {
  SALES: ReceiptLongOutlinedIcon,
  INVOICES: ReceiptLongOutlinedIcon,
  DOCUMENTS: ReceiptLongOutlinedIcon,
  ACCOUNTING: AccountBalanceOutlinedIcon,
  INVENTORY: Inventory2OutlinedIcon,
  ASSETS: Inventory2OutlinedIcon,
  PROJECTS: WorkOutlineIcon,
  DELIVERIES: LocalShippingOutlinedIcon,
  ORDERS: LocalShippingOutlinedIcon,
  CRM: ForumOutlinedIcon,
  USER_MANAGEMENT: PeopleOutlineIcon,
  REPORTS: BarChartOutlinedIcon,
  ANALYTICS: BarChartOutlinedIcon,
  MAINTENANCE: BuildOutlinedIcon,
  SERVICE_REPORTS: BuildOutlinedIcon,
  SETTINGS: SettingsOutlinedIcon,
};

const BLURB: Record<string, string> = {
  SALES: "Quotations, invoices, delivery orders, credit notes",
  ACCOUNTING: "Bills, payments, bank rec, GST, reports",
  INVENTORY: "Stock, purchases, adjustments",
  PROJECTS: "Projects, costs, schedules",
  DELIVERIES: "Deliveries and sign-offs",
  CRM: "Leads, WhatsApp, marketing",
  USER_MANAGEMENT: "Users and roles",
  REPORTS: "Sales and finance reports",
  MAINTENANCE: "Service reports and maintenance dates",
  ORDERS: "Sales orders",
};

interface Props {
  onPrompt: (text: string) => void;
  onOpenScreen: (path: string, title: string) => void;
}

export default function EmptyState({ onPrompt, onOpenScreen }: Props) {
  const { user } = useUser();
  const { navModules, hasPermission, userRoles, isAdminUser } = useNavModules();
  const first = user?.firstName || "";
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const roleNames = userRoles.map((r: any) => String(r?.name || ""));
  const has = (code: string) => navModules.some((m: any) => m.moduleCode === code);
  const can = (res: string, act: string) => isAdminUser || hasPermission(res, act);

  // Prompts, most useful first for this role. Capped at six.
  const prompts: string[] = [];
  if (roleNames.some((n) => /designer/i.test(n))) prompts.push("What's my commission this month?", "My appointments this week");
  if (has("SALES") && can("documents", "create-basic")) prompts.push("Create a quotation for a customer", "Raise an invoice from the last quotation");
  if (has("ACCOUNTING")) prompts.push("Which invoices are overdue?", "Show aged receivables");
  if (has("PROJECTS")) prompts.push("What's outstanding on my projects?");
  if (has("DELIVERIES")) prompts.push("What deliveries are scheduled tomorrow?");
  if (has("INVENTORY")) prompts.push("Check stock for an item");
  prompts.push("Show me the last 5 documents", "How do I record a payment?");
  const picks = Array.from(new Set(prompts)).slice(0, 6);

  const cards = navModules
    .filter((m: any) => m.config?.route && m.config.route !== "/portal")
    .slice(0, 8);

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: { xs: 3, md: 5 }, maxWidth: 860, mx: "auto", width: "100%" }}>
      <Stack alignItems="center" sx={{ textAlign: "center", mb: 3 }}>
        <Box sx={{ mb: 1.5 }}>
          <AimeeFace size={104} mood="idle" wake hover />
        </Box>
        <Typography sx={{ fontSize: { xs: "1.35rem", md: "1.6rem" }, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {greet}{first ? `, ${first}` : ""}. I'm AIMEE.
        </Typography>
        <Typography sx={{ color: "text.secondary", mt: 0.5, fontSize: "0.95rem" }}>
          Ask me a question, have me draft a document, or run a report. Anything final waits for your OK.
        </Typography>
      </Stack>

      <Stack direction="row" flexWrap="wrap" justifyContent="center" gap={1} sx={{ mb: 4 }} data-tour="chat-prompts">
        {picks.map((p) => (
          <Chip
            key={p}
            label={p}
            onClick={() => onPrompt(p)}
            variant="outlined"
            sx={{ borderRadius: 999, fontSize: "0.8rem", height: 32, "&:hover": { bgcolor: "action.hover" } }}
          />
        ))}
      </Stack>

      {!!cards.length && (
        <>
          <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "text.secondary", mb: 1 }}>
            Your workspace
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.25 }}>
            {cards.map((m: any) => {
              const Icon = ICONS[m.moduleCode] || GridViewOutlinedIcon;
              const label = m.displayName || m.moduleCode;
              return (
                <Box
                  key={m.moduleCode}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenScreen(m.config.route, label)}
                  onKeyDown={(e) => e.key === "Enter" && onOpenScreen(m.config.route, label)}
                  sx={{
                    p: 1.75,
                    borderRadius: 3,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.paper",
                    cursor: "pointer",
                    transition: "border-color .15s, transform .15s",
                    "&:hover": { borderColor: "text.secondary", transform: "translateY(-1px)" },
                    "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
                  }}
                >
                  <Icon sx={{ fontSize: 20, color: "text.secondary", mb: 0.75 }} />
                  <Typography sx={{ fontWeight: 700, fontSize: "0.9rem" }}>{label}</Typography>
                  <Typography sx={{ fontSize: "0.78rem", color: "text.secondary", mt: 0.25 }}>
                    {BLURB[m.moduleCode] || ((m.config?.subMenus || []).map((s: any) => (typeof s === "string" ? s : s?.label)).filter(Boolean).slice(0, 4).join(", ") || "Open")}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </>
      )}
    </Box>
  );
}
