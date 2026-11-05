"use client";

// The mock-up's line icons, mapped onto the MUI set the rest of the portal
// uses, plus the pastel tone each one wears in a priority row.

import * as React from "react";
import type { SvgIconProps } from "@mui/material";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import PostAddOutlinedIcon from "@mui/icons-material/PostAddOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import CreditCardOutlinedIcon from "@mui/icons-material/CreditCardOutlined";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import ShoppingCartOutlinedIcon from "@mui/icons-material/ShoppingCartOutlined";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import EventOutlinedIcon from "@mui/icons-material/EventOutlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import WorkOutlineOutlinedIcon from "@mui/icons-material/WorkOutlineOutlined";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import type { IconKey } from "./roles";

export const ICONS: Record<IconKey, React.ComponentType<SvgIconProps>> = {
  invoice: ReceiptLongOutlinedIcon,
  invoicePlus: PostAddOutlinedIcon,
  people: GroupsOutlinedIcon,
  box: Inventory2OutlinedIcon,
  card: CreditCardOutlinedIcon,
  coins: PaidOutlinedIcon,
  cart: ShoppingCartOutlinedIcon,
  wallet: AccountBalanceWalletOutlinedIcon,
  payroll: PaymentsOutlinedIcon,
  calendar: EventOutlinedIcon,
  truck: LocalShippingOutlinedIcon,
  alert: WarningAmberOutlinedIcon,
  reconcile: FactCheckOutlinedIcon,
  briefcase: WorkOutlineOutlinedIcon,
  userPlus: PersonAddAltOutlinedIcon,
  check: CheckCircleOutlinedIcon,
  clock: ScheduleOutlinedIcon,
};

/** Icon colour per kind — the mock-up's red / teal / amber / indigo families. */
export const ICON_TONE: Partial<Record<IconKey, string>> = {
  invoice: "#E5293F",
  invoicePlus: "#E5293F",
  people: "#1BA39C",
  box: "#178F8A",
  card: "#F59E0B",
  cart: "#4B3F8F",
  payroll: "#1BA39C",
  truck: "#4B3F8F",
  alert: "#F59E0B",
  calendar: "#4B3F8F",
  reconcile: "#4B3F8F",
  check: "#1BA39C",
  clock: "#4B3F8F",
  coins: "#1BA39C",
  wallet: "#4B3F8F",
  briefcase: "#4B3F8F",
  userPlus: "#1BA39C",
};

export function RoleIcon({ name, ...props }: { name: IconKey } & SvgIconProps) {
  const Cmp = ICONS[name] ?? ReceiptLongOutlinedIcon;
  return <Cmp {...props} />;
}
