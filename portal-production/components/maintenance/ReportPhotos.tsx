"use client";

import React, { useState } from "react";
import { Box, Dialog, DialogActions, DialogContent, Button, Link, Typography } from "@mui/material";

/**
 * Optional photos on a service report (2026-10-06), shown at the very END of
 * the report, after the signatures/conclusion. Renders NOTHING when a report
 * has no photos, so those reports look exactly as before.
 *
 *  - screen: thumbnails captioned Photo 1, 2…; tap to enlarge, with a link to
 *    the full-size image (office dashboard + field).
 *  - print: rows of three, each row kept whole across page breaks, the title
 *    travelling with the first row (field Print / Download PDF).
 */
const RESOURCE_URL = process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/";

export const photoSrc = (key: string) => (/^(https?:|data:|blob:)/.test(key) ? key : `${RESOURCE_URL}${key}`);

export default function ReportPhotos({
  photos,
  variant = "screen",
}: {
  photos?: string[] | null;
  variant?: "screen" | "print";
}) {
  const [open, setOpen] = useState<number | null>(null);
  const list = (photos ?? []).filter(Boolean);
  if (!list.length) return null;

  if (variant === "print") {
    const rows: string[][] = [];
    for (let i = 0; i < list.length; i += 3) rows.push(list.slice(i, i + 3));
    const keep: React.CSSProperties = { breakInside: "avoid", pageBreakInside: "avoid" };
    const row = (keys: string[], r: number) => (
      <div key={r} className="msr-photo-row" style={{ ...keep, display: "flex", gap: 8, marginBottom: 8 }}>
        {keys.map((k, j) => {
          const n = r * 3 + j + 1;
          return (
            <div key={k} style={{ width: "calc((100% - 16px) / 3)", textAlign: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoSrc(k)}
                alt={`Photo ${n}`}
                style={{ display: "block", width: "100%", height: 190, objectFit: "contain", border: "1px solid #ccc", background: "#fafafa" }}
              />
              <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>Photo {n}</div>
            </div>
          );
        })}
      </div>
    );
    return (
      // Not "msr-section": the office page prints .msr-section unbroken, and
      // twelve photos do not fit one page. Rows are kept whole instead.
      <Box sx={{ border: 1, borderColor: "divider", p: 2 }} className="msr-photos">
        <div style={keep}>
          <strong>Photos</strong>
          <div style={{ marginTop: 8 }}>{row(rows[0], 0)}</div>
        </div>
        {rows.slice(1).map((keys, i) => row(keys, i + 1))}
      </Box>
    );
  }

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Photos
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", md: "repeat(4, 1fr)" }, gap: 1.5 }}>
        {list.map((k, i) => (
          <Box key={k} sx={{ textAlign: "center" }}>
            <Box
              component="button"
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`Open photo ${i + 1}`}
              sx={{
                p: 0,
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                overflow: "hidden",
                width: "100%",
                aspectRatio: "4 / 3",
                cursor: "zoom-in",
                bgcolor: "action.hover",
                display: "block",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoSrc(k)} alt={`Photo ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </Box>
            <Typography variant="caption" color="text.secondary">
              Photo {i + 1}
            </Typography>
          </Box>
        ))}
      </Box>
      <Dialog open={open !== null} onClose={() => setOpen(null)} maxWidth="lg" fullWidth>
        {open !== null && (
          <>
            <DialogContent sx={{ p: 1, bgcolor: "background.default", textAlign: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoSrc(list[open])} alt={`Photo ${open + 1}`} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} />
            </DialogContent>
            <DialogActions>
              <Typography variant="body2" color="text.secondary" sx={{ mr: "auto", pl: 1 }}>
                Photo {open + 1} of {list.length}
              </Typography>
              <Button disabled={open === 0} onClick={() => setOpen((v) => (v ?? 0) - 1)}>
                Previous
              </Button>
              <Button disabled={open === list.length - 1} onClick={() => setOpen((v) => (v ?? 0) + 1)}>
                Next
              </Button>
              <Link href={photoSrc(list[open])} target="_blank" rel="noopener noreferrer" sx={{ px: 1 }}>
                Open full size
              </Link>
              <Button onClick={() => setOpen(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
