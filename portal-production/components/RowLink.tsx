"use client";
import React from "react";
import { withActiveOrg } from "@/helpers/request";

// A real link stretched over a clickable table row (guru 2026-11-28: "right click to open in new
// tab… I click in every time then back will need to find again"). The same device components/Table.tsx
// uses for its rowHref: an invisible <a> covering the row, so the browser offers its own context menu
// (open in new tab / window, copy link), and ⌘-click, Ctrl-click and middle-click open a tab; a plain
// click runs the row's own handler instead. Put <RowLink> inside the row's FIRST cell and spread
// rowLinkRowSx into the row's sx (it is the containing block, and it lifts buttons and inputs above the link).
export const rowLinkRowSx = {
  position: "relative",
  "& .MuiButtonBase-root, & .MuiInputBase-root, & a:not([data-row-link])": { position: "relative", zIndex: 1 },
} as const;

export default function RowLink({ href, onOpen, label = "Open record" }: { href: string | null | undefined; onOpen?: () => void; label?: string }) {
  if (!href) return null;
  // An admin "viewing as" an org keeps that org in sessionStorage, which a new tab does not inherit:
  // the link carries ?aorg= (helpers/request.ts re-seeds it on load), unless the caller already did.
  const target = href.includes("aorg=") ? href : withActiveOrg(href);
  return (
    <a
      data-row-link=""
      href={target}
      draggable={false}
      aria-label={label}
      onClick={(e: React.MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          // The browser opens the tab; the row's own onClick must not also navigate this one.
          e.stopPropagation();
          return;
        }
        if (!onOpen) return; // no handler: an ordinary link, the browser follows it
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      style={{ position: "absolute", inset: 0, zIndex: 0 }}
    />
  );
}
