"use client";

// A document reference rendered as a REAL link.
//
// Anywhere a document number appears on a line of another screen (a receipt's
// offset rows, a payment's document, a statement transaction…) the user must be
// able to reach that document the way they reach any link: middle-click,
// ⌘/Ctrl-click, or right-click → "Open Link in New Tab" (guru 2026-10-21).
// That only works with a genuine <a href>, never an onClick handler, so this
// component exists to keep every one of those cells consistent.
//
// `newTab` defaults to true because these links live INSIDE another record —
// usually one being edited — and navigating the tab away would lose the work.
// Pass newTab={false} where the link stands alone on a read-only screen.

import * as React from "react";
import { Link, Typography } from "@mui/material";
import { withActiveOrg } from "@/helpers/request";

export type DocumentRef = {
  id?: string | null;
  /** Document.type — INVOICE / BILL / QUOTATION… */
  type?: string | null;
  /** Document.documentTemplateId — the editor route needs it. */
  templateId?: string | null;
};

/** The editor URL for a document, or null when the row can't address one. */
export function documentHref(doc: DocumentRef | null | undefined): string | null {
  if (!doc?.id || !doc.type || !doc.templateId) return null;
  return withActiveOrg(`/portal/documents/${doc.type}/${doc.templateId}/${doc.id}`);
}

export default function DocumentRefLink({
  doc,
  label,
  newTab = true,
  sx,
}: {
  doc: DocumentRef | null | undefined;
  /** What to show — the reference/number. Falls back to an em dash. */
  label?: React.ReactNode;
  newTab?: boolean;
  sx?: any;
}) {
  const href = documentHref(doc);
  const text = label ?? "—";
  // No id/type/template (legacy rows, ad-hoc lines) → plain text, not a dead
  // link that looks clickable.
  if (!href) {
    return (
      <Typography component="span" variant="body2" sx={{ fontVariantNumeric: "tabular-nums", ...sx }}>
        {text}
      </Typography>
    );
  }
  return (
    <Link
      href={href}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      // Stop the row's own click handler: the anchor already navigates, and a
      // row handler would fire a second navigation in this tab.
      onClick={(e) => e.stopPropagation()}
      underline="hover"
      sx={{ fontVariantNumeric: "tabular-nums", color: "primary.main", fontWeight: 500, ...sx }}
    >
      {text}
    </Link>
  );
}
