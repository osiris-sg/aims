// The brand typeface (Brand Kit Guidelines R01, "Brand Typeface": DM Sans),
// the same face the landing site wears. It replaced the mock-up's Plus
// Jakarta Sans on 2026-11-12 (guru: "is it using [the brand kit]? yes do
// that"). Variable font, so every weight the theme asks for (400–800) is
// there. next/font self-hosts it, so the portal makes no request to Google at
// runtime, and only orgs with enableRoleHome ever load the files.
import { DM_Sans } from "next/font/google";

export const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
});

export const DEMO_FONT = `${dmSans.style.fontFamily}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
