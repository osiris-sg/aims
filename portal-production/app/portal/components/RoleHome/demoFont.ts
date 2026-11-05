// The mock-up's typeface (ui-roles-demo frontend/src/App.css): Plus Jakarta
// Sans 400–700. next/font self-hosts it, so the portal makes no request to
// Google at runtime. Only the role-home bar references it, so only orgs with
// enableRoleHome ever load the files.
import { Plus_Jakarta_Sans } from "next/font/google";

export const jakarta = Plus_Jakarta_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const DEMO_FONT = `${jakarta.style.fontFamily}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
