import type { Viewport } from "next";
import FieldShell from "./components/FieldShell";
import { FIELD_THEME_BOOTSTRAP } from "./context/FieldThemeContext";

// Draw edge to edge on notched / gesture-nav phones; the app bar and the
// bottom nav pad themselves with env(safe-area-inset-*). Field segment only.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Paints the rider's chosen theme (Light / Dark / Follow phone) before
          anything else renders, so the app never opens in the wrong colours.
          Plain inline script on purpose: it must run before hydration. */}
      <script dangerouslySetInnerHTML={{ __html: FIELD_THEME_BOOTSTRAP }} />
      <FieldShell>{children}</FieldShell>
    </>
  );
}
