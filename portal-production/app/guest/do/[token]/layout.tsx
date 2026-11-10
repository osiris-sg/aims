import type { Viewport } from "next";

// A DO is a paper document: always black on white, whatever the phone's theme.
// "only light" also stops Chrome's automatic dark mode for web pages from
// inverting it (WCT 2026-11-10: the DO opened from SiteClock showed dark).
export const viewport: Viewport = {
  colorScheme: "only light",
};

export default function GuestDoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
