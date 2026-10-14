"use client";

// In-app document viewer: a PDF rendered with pdf.js onto canvases (or an
// image), each page fitted to the panel WIDTH and stacked vertically — scroll
// to move between pages. A small bar shows "Page 1 of 3", zoom − / fit width /
// + and a plain Download link; nothing else (no print, rotate, annotation or
// thumbnail sidebar, unlike the browser's PDF viewer). Click a page for a
// full-screen view of it. Other file types show their icon and Download.
//
// Source: a stored trade file (fetched through the API, so no cross-origin
// fetch of the signed URL), a local File (picked, not uploaded yet) or a Blob.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, CircularProgress, Dialog, IconButton, Link, Stack, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import CloseIcon from "@mui/icons-material/Close";
import { useShipmentsApi } from "../_lib/api";

export type DocSource = { fileId: string } | { file: File } | { blob: Blob };

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
export const isPdfName = (name: string, mime?: string | null) => mime === "application/pdf" || extOf(name) === "pdf";
export const isImageName = (name: string, mime?: string | null) => /^image\//.test(mime ?? "") || ["png", "jpg", "jpeg", "webp"].includes(extOf(name));

/**
 * pdf.js 4.4.168, vendored as its prebuilt files in /public/pdfjs (LICENSE
 * beside them) and loaded at runtime in the browser only through
 * public/pdfjs/loader.mjs — bundlers (Turbopack in dev) can't compile its
 * worker import, and it never runs on the server.
 */
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: Uint8Array }) => { promise: Promise<PdfDoc> } };
let pdfjsPromise: Promise<PdfJs> | null = null;
export function loadPdfjs(): Promise<PdfJs> {
  const w = window as unknown as { __aimsPdfjs?: PdfJs };
  if (w.__aimsPdfjs) return Promise.resolve(w.__aimsPdfjs);
  if (!pdfjsPromise) {
    // A module <script> (public/pdfjs/loader.mjs) puts pdf.js on window — the bundler never sees it.
    pdfjsPromise = new Promise<PdfJs>((resolve, reject) => {
      const done = () => (w.__aimsPdfjs ? resolve(w.__aimsPdfjs) : reject(new Error("Could not load the PDF viewer")));
      window.addEventListener("aims-pdfjs-ready", done, { once: true });
      const el = document.createElement("script");
      el.type = "module";
      el.src = "/pdfjs/loader.mjs";
      el.onerror = () => reject(new Error("Could not load the PDF viewer"));
      document.head.appendChild(el);
    });
    pdfjsPromise.catch(() => (pdfjsPromise = null));
  }
  return pdfjsPromise;
}

/** The source's bytes as a Blob (stored files come through the API). */
function useSourceBlob(src: DocSource | null) {
  const api = useShipmentsApi();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = !src ? "" : "fileId" in src ? `id:${src.fileId}` : "file" in src ? `file:${src.file.name}:${src.file.size}:${src.file.lastModified}` : "blob";
  useEffect(() => {
    let live = true;
    setError(null);
    if (!src) return setBlob(null);
    if ("file" in src) return setBlob(src.file);
    if ("blob" in src) return setBlob(src.blob);
    setBlob(null);
    api
      .fileContent(src.fileId)
      .then((b) => live && setBlob(b))
      .catch((e: Error) => live && setError(e?.message || "Could not open the file"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api]);
  return { blob, error };
}

/** Render one PDF page onto a canvas at a CSS width (sharp on high-DPI screens). */
async function drawPage(doc: PdfDoc, n: number, canvas: HTMLCanvasElement, cssWidth: number) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
}

function triggerDownload(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export default function DocPages({
  src,
  fileName,
  mimeType,
  height = "100%",
}: {
  src: DocSource | null;
  fileName: string;
  mimeType?: string | null;
  /** Height of the scrolling page area (the bar sits above it). */
  height?: number | string;
}) {
  const kind = isPdfName(fileName, mimeType) ? "pdf" : isImageName(fileName, mimeType) ? "image" : "other";
  const { blob, error } = useSourceBlob(kind === "other" ? null : src);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1); // 1 = fit width
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [full, setFull] = useState<number | null>(null); // page shown full-screen (images: 1)
  const canvases = useRef<Array<HTMLCanvasElement | null>>([]);
  const imageUrl = useMemo(() => (kind === "image" && blob ? URL.createObjectURL(blob) : null), [kind, blob]);
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);

  // Panel width (pages fit it; re-render when it changes).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(0, el.clientWidth - 24)));
    ro.observe(el);
    setWidth(Math.max(0, el.clientWidth - 24));
    return () => ro.disconnect();
  }, []);

  // Open the PDF.
  useEffect(() => {
    if (kind !== "pdf" || !blob) return;
    let live = true;
    let opened: PdfDoc | null = null;
    setDoc(null);
    setPages(0);
    setRenderError(null);
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const d = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        opened = d;
        if (!live) return void d.destroy();
        setDoc(d);
        setPages(d.numPages);
        setCurrent(1);
      } catch (e) {
        if (live) setRenderError((e as Error)?.message || "Could not read the PDF");
      }
    })();
    return () => {
      live = false;
      void opened?.destroy();
    };
  }, [kind, blob]);

  // Draw every page at the current width × zoom (debounced while resizing).
  const pageWidth = Math.max(120, Math.round(width * zoom));
  useEffect(() => {
    if (!doc || !width) return;
    let live = true;
    const t = setTimeout(async () => {
      for (let n = 1; n <= doc.numPages && live; n++) {
        const c = canvases.current[n - 1];
        if (c) await drawPage(doc, n, c, pageWidth).catch(() => undefined);
      }
    }, 80);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [doc, width, pageWidth]);

  // "Page n of N": the page nearest the top of the panel.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop + 40;
    let n = 1;
    canvases.current.forEach((c, i) => {
      if (c && c.parentElement && c.parentElement.offsetTop <= top) n = i + 1;
    });
    setCurrent(n);
  }, []);

  const step = (dir: 1 | -1) => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.findIndex((x) => x >= z - 1e-6) + dir))]);
  const download = blob ? () => triggerDownload(blob, fileName) : null;
  const problem = error ?? renderError;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height, minHeight: 0 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1, py: 0.25, minHeight: 34, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {kind === "pdf" ? (pages ? `Page ${current} of ${pages}` : "") : kind === "image" ? "Image" : ""}
        </Typography>
        {kind !== "other" && (
          <>
            <Tooltip title="Zoom out">
              <span>
                <IconButton size="small" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => step(-1)}>
                  <RemoveIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Fit width">
              <IconButton size="small" aria-label="Fit width" onClick={() => setZoom(1)} color={zoom === 1 ? "primary" : "default"}>
                <FitScreenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Zoom in">
              <span>
                <IconButton size="small" aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => step(1)}>
                  <AddIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
        {download && (
          <Link component="button" type="button" variant="caption" underline="hover" onClick={download} sx={{ ml: 1 }}>
            Download
          </Link>
        )}
      </Stack>

      <Box ref={scroller} onScroll={onScroll} sx={{ flex: 1, minHeight: 0, overflow: "auto", bgcolor: "action.hover", p: 1.5 }}>
        {kind === "other" ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
            No preview for this file type — download it to open it.
          </Typography>
        ) : problem ? (
          <Alert severity="error">{problem}</Alert>
        ) : kind === "image" ? (
          imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={fileName} onClick={() => setFull(1)} style={{ display: "block", width: pageWidth, margin: "0 auto", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.25)", cursor: "zoom-in" }} />
          ) : (
            <Spinner />
          )
        ) : !pages ? (
          <Spinner />
        ) : (
          <Stack spacing={1.5} alignItems={zoom > 1 ? "flex-start" : "center"}>
            {Array.from({ length: pages }, (_, i) => (
              <Box key={i} onClick={() => setFull(i + 1)} sx={{ bgcolor: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.25)", cursor: "zoom-in", lineHeight: 0 }} title={`Page ${i + 1} — click for full screen`}>
                <canvas ref={(c) => void (canvases.current[i] = c)} aria-label={`Page ${i + 1}`} />
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      <FullPage open={full !== null} onClose={() => setFull(null)} doc={doc} page={full ?? 1} pages={pages} imageUrl={imageUrl} fileName={fileName} onPage={setFull} />
    </Box>
  );
}

function Spinner() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
      <CircularProgress size={24} />
    </Box>
  );
}

/** One page full-screen, fitted to the screen width; ← / → between pages. */
function FullPage({
  open,
  onClose,
  doc,
  page,
  pages,
  imageUrl,
  fileName,
  onPage,
}: {
  open: boolean;
  onClose: () => void;
  doc: PdfDoc | null;
  page: number;
  pages: number;
  imageUrl: string | null;
  fileName: string;
  onPage: (n: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!open || !doc) return;
    const t = setTimeout(() => {
      if (canvas.current) void drawPage(doc, page, canvas.current, Math.min(window.innerWidth - 48, 1600)).catch(() => undefined);
    }, 30);
    return () => clearTimeout(t);
  }, [open, doc, page]);
  useEffect(() => {
    if (!open || !doc) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && page < pages) onPage(page + 1);
      if (e.key === "ArrowLeft" && page > 1) onPage(page - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, doc, page, pages, onPage]);
  return (
    <Dialog open={open} onClose={onClose} fullScreen PaperProps={{ sx: { bgcolor: "rgba(20,20,20,.96)" } }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, color: "#fff" }}>
        <Typography variant="body2" sx={{ flex: 1 }} noWrap>
          {fileName}
          {doc ? ` · Page ${page} of ${pages}` : ""}
        </Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ color: "#fff" }}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <Box onClick={onClose} sx={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", p: 3, pt: 0 }}>
        {doc ? (
          <Box onClick={(e) => e.stopPropagation()} sx={{ bgcolor: "#fff", lineHeight: 0 }}>
            <canvas ref={canvas} />
          </Box>
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={fileName} onClick={(e) => e.stopPropagation()} style={{ maxWidth: "100%", background: "#fff" }} />
        ) : null}
      </Box>
    </Dialog>
  );
}

/** First page of a local PDF / image as a small preview (the upload dialog). */
export function FirstPagePreview({ file, width }: { file: File; width: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let opened: PdfDoc | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const d = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        opened = d;
        if (live && ref.current) await drawPage(d, 1, ref.current, width);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      void opened?.destroy();
    };
  }, [file, width]);
  if (failed) return null;
  return <canvas ref={ref} style={{ display: "block" }} />;
}
