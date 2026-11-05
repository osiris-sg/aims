import type { ReactNode } from "react";
import type { ModuleKey } from "../_content/site";
import { BoxIcon, ChartIcon, ChatIcon, PeopleIcon, ReceiptIcon } from "./Icons";

/** One icon per module, shared by the nav, the home page and the sub-pages. */
export const MODULE_ICONS: Record<ModuleKey, ReactNode> = {
  inventory: <BoxIcon />,
  hr: <PeopleIcon />,
  crm: <ChatIcon size={20} strokeWidth={1.8} />,
  accounting: <ChartIcon />,
  claims: <ReceiptIcon />,
};
