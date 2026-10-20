import type { Viewport } from "next";
import FieldShell from "./components/FieldShell";

// Draw edge to edge on notched / gesture-nav phones; the app bar and the
// bottom nav pad themselves with env(safe-area-inset-*). Field segment only.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return <FieldShell>{children}</FieldShell>;
}
