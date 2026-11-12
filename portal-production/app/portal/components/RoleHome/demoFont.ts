// The brand typeface (Brand Kit Guidelines R01, "Brand Typeface": DM Sans),
// the same face the landing site wears. It replaced the mock-up's Plus
// Jakarta Sans on 2026-11-12 (guru: "is it using [the brand kit]? yes do
// that"). Variable font, so every weight the theme asks for (400–800) is
// there. next/font self-hosts it, so the portal makes no request to Google at
// runtime, and only orgs with enableRoleHome ever load the files.
//
// Legibility pass (guru 2026-11-13, "it's a bit hard to read the font"):
// • `axes: ["opsz"]` ships the optical-size axis (9–40) so the browser picks
//   the open, wide small-text cut for 10–13px table heads and captions
//   instead of the display cut (`font-optical-sizing: auto` is the default).
// • DM Sans has NO distinguishable zero — 0/O and 1/I/l are the same bars in
//   every stylistic set (checked glyph by glyph). Codes and document numbers
//   are therefore set SEMIBOLD via `[data-code]` (app/portal/layout.tsx) so
//   they at least stand out as identifiers; DM Mono was tried and rejected
//   (guru: "I want all the codes to be like this" = bold DM Sans).
import { DM_Sans } from "next/font/google";

export const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
});

export const DEMO_FONT = `${dmSans.style.fontFamily}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
