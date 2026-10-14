// Loads the vendored pdf.js (4.4.168) for the in-app document viewer
// (app/portal/shipments/_components/DocPages.tsx) outside the bundler.
import * as pdfjs from "./pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", import.meta.url).toString();
window.__aimsPdfjs = pdfjs;
window.dispatchEvent(new Event("aims-pdfjs-ready"));
