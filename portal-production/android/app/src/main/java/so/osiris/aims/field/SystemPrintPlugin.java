package so.osiris.aims.field;

import android.content.ContentValues;
import android.content.Intent;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.print.PageRange;
import android.print.PdfPrintCallbacks;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import androidx.core.content.FileProvider;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * SystemPrint — render a document to PDF, then print or save THAT PDF.
 *
 * WHY THIS EXISTS AT ALL
 * `window.print()` is a NO-OP in an Android WebView. Chrome implements printing
 * in its browser chrome, not in the web engine, so a bare WebView — which is
 * all Capacitor gives us — has nothing listening. There is no error and no
 * dialog; the call simply returns. Reaching Android's print system means going
 * through PrintManager natively, which is what this does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY PRINT RENDERS TO A PDF FIRST (2026-09)
 *
 * This class used to hand the WebView's OWN PrintDocumentAdapter to
 * PrintManager and let the print system drive it. Download, which drives the
 * same adapter directly, produced a correct page; print came out reflowed and
 * unstyled from the identical HTML. The cause is not lost CSS — it is WHOSE
 * PrintAttributes reach the WebView:
 *
 *   download  we call adapter.onLayout(null, OUR_ATTRS, …) ourselves, so the
 *             page is always laid out at A4 / no margins / 600dpi.
 *
 *   print     the attrs passed to PrintManager.print() are only a HINT. The
 *             print subsystem shows its dialog, resolves the real attributes
 *             from the SELECTED PRINTER and the user's choices, and then calls
 *             adapter.onLayout(old, THOSE_ATTRS, …). The WebView re-lays the
 *             document out at the driver's page size and margins — a narrower
 *             printable width than the 186mm the sheet's CSS pins — and the
 *             table collapses.
 *
 * So the fix is to stop giving the print system something re-layoutable. The
 * HTML is rendered to a PDF ONCE, under our attributes, by exactly the code
 * the download path uses; print then serves that finished PDF through a
 * file-backed adapter that ignores the attributes it is handed. Whatever the
 * driver chooses, there is no HTML left for it to re-flow — it receives the
 * same bytes the download produces.
 *
 * The printer may still SCALE the finished page to its paper. That is a
 * uniform transform, not a re-layout, and it cannot break the geometry.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY A SECOND WEBVIEW, NOT THE APP'S
 * `bridge.getWebView()` holds the whole running app — printing it would print
 * the field UI, not the document. So the HTML is loaded into a throwaway
 * offscreen WebView whose only content is the document.
 *
 * WHY RENDERING STARTS FROM onPageFinished
 * createPrintDocumentAdapter() snapshots whatever the WebView has laid out at
 * that instant. Called too early it captures a blank or half-styled page.
 * onPageFinished fires after the document and its subresources have settled.
 * (The web side additionally inlines every image as a data: URI before handing
 * the HTML over, so there is no network fetch left to race — see
 * systemPrint.ts.)
 *
 * MARGINS ARE THE CSS'S JOB
 * RENDER_ATTRS carries NO_MARGINS deliberately: the document's own
 * `@page { margin: 6mm }` is the canonical geometry (186×277mm sheet inside a
 * 6mm printer ring, shared with the portal's Print/PDF). A native margin would
 * stack on top of it and inset the sheet twice.
 */
@CapacitorPlugin(name = "SystemPrint")
public class SystemPrintPlugin extends Plugin {

    /**
     * The ONE set of attributes every render uses — print and download alike.
     * Because print no longer lets the driver's attributes reach the WebView,
     * this is the only geometry the document is ever laid out at.
     */
    private static final PrintAttributes RENDER_ATTRS = new PrintAttributes.Builder()
        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
        .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
        // Colour is stated rather than left to the driver's default: some
        // drivers default to MONOCHROME, which drops the table shading and
        // makes a correct page look "unstyled" on paper.
        .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
        .build();

    /**
     * Held for the life of a render. PrintManager and the adapter keep only
     * weak grips on the WebView; if this were a local that went out of scope,
     * GC could collect it mid-render and produce a blank document.
     */
    private WebView printView;

    /** Called with the finished PDF, on the UI thread. */
    private interface PdfReady {
        void onReady(File pdf) throws Exception;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT);
        call.resolve(ret);
    }

    // ── print ────────────────────────────────────────────────────────────────

    @PluginMethod
    public void printHtml(PluginCall call) {
        final String html = call.getString("html");
        if (html == null || html.isEmpty()) { call.reject("html is required"); return; }
        final String jobName = safeName(call.getString("jobName", "Document"));
        final String baseUrl = call.getString("baseUrl", "https://app.ai-ms.io/");

        renderHtmlToPdf(html, baseUrl, jobName, call, (pdf) -> {
            PrintManager pm = (PrintManager) getContext().getSystemService(android.content.Context.PRINT_SERVICE);
            if (pm == null) { cleanup(); call.reject("This device has no print service"); return; }
            // Serve the FINISHED PDF. See the class docblock: handing the
            // WebView's own adapter here is what let the driver's attributes
            // re-lay the document out.
            pm.print(jobName, new PdfFileAdapter(pdf, jobName), RENDER_ATTRS);
            cleanup();
            // Resolving means "the dialog is up", not "the page came out":
            // once Android owns the job, printer choice, settings and
            // cancellation are never reported back to us.
            call.resolve();
        });
    }

    // ── save ─────────────────────────────────────────────────────────────────

    /**
     * Render to a PDF FILE, with no print dialog.
     *
     * The X1000 serves its own WiFi hotspot with no internet, so the tablet
     * cannot be on the printer's network and on ours at once — the rider must
     * be able to take the document with them: save first, join the printer's
     * WiFi, print from the printer's own app.
     *
     * Lands in the public Downloads collection, so it appears in Files, in the
     * Downloads app and in every app's picker — including the printer's. On
     * API 29+ that is MediaStore, which needs no storage permission.
     */
    @PluginMethod
    public void savePdf(PluginCall call) {
        final String html = call.getString("html");
        if (html == null || html.isEmpty()) { call.reject("html is required"); return; }
        final String fileName = safeName(call.getString("fileName", "document")) + ".pdf";
        final String baseUrl = call.getString("baseUrl", "https://app.ai-ms.io/");
        final boolean share = Boolean.TRUE.equals(call.getBoolean("share", false));

        renderHtmlToPdf(html, baseUrl, fileName, call, (pdf) -> {
            Uri saved = publishToDownloads(pdf, fileName);
            cleanup();
            if (share && saved != null) shareFile(pdf, fileName);
            JSObject ret = new JSObject();
            ret.put("uri", saved != null ? saved.toString() : "");
            ret.put("fileName", fileName);
            call.resolve(ret);
        });
    }

    // ── the one renderer both paths use ──────────────────────────────────────

    /**
     * HTML → PDF file, at RENDER_ATTRS, via the WebView's PrintDocumentAdapter
     * driven directly (onLayout, then onWrite to a descriptor we own).
     *
     * This is the whole reason print and download can no longer disagree:
     * there is exactly one rendering path, and it is this one.
     */
    private void renderHtmlToPdf(
        final String html,
        final String baseUrl,
        final String jobName,
        final PluginCall call,
        final PdfReady onReady
    ) {
        // WebView construction, loading and PrintManager all require the UI
        // thread — doing any of it on the bridge's thread throws.
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                final WebView wv = new WebView(getContext());
                WebSettings s = wv.getSettings();
                // The document is fully inlined by the web side; JS is not
                // needed to render it, so leave it off.
                s.setJavaScriptEnabled(false);
                s.setLoadsImagesAutomatically(true);
                // Lay out at the document's own width rather than a phone
                // viewport — without this the page reflows to ~360dp.
                s.setUseWideViewPort(true);
                s.setLoadWithOverviewMode(false);

                wv.setWebViewClient(new WebViewClient() {
                    private boolean started = false;

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        // onPageFinished can fire more than once (frames,
                        // history); only ever render once.
                        if (started) return;
                        started = true;
                        try {
                            final PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                            // Scratch file: writing through a temp keeps a
                            // failed render from leaving a half-written file
                            // anywhere the user can see it.
                            final File tmp = new File(getContext().getCacheDir(), safeName(jobName) + ".pdf");

                            adapter.onLayout(null, RENDER_ATTRS, null, new PdfPrintCallbacks.Layout() {
                                @Override
                                public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                                    try {
                                        final ParcelFileDescriptor pfd = ParcelFileDescriptor.open(
                                            tmp, ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_READ_WRITE);
                                        adapter.onWrite(new PageRange[]{ PageRange.ALL_PAGES }, pfd,
                                            new CancellationSignal(),
                                            new PdfPrintCallbacks.Write() {
                                                @Override
                                                public void onWriteFinished(PageRange[] pages) {
                                                    try { pfd.close(); } catch (Exception ignored) {}
                                                    try {
                                                        onReady.onReady(tmp);
                                                    } catch (Exception e) {
                                                        cleanup();
                                                        call.reject("Rendered the PDF but could not use it: " + e.getMessage());
                                                    }
                                                }

                                                @Override
                                                public void onWriteFailed(CharSequence error) {
                                                    try { pfd.close(); } catch (Exception ignored) {}
                                                    cleanup();
                                                    call.reject("Could not write the PDF: " + error);
                                                }
                                            });
                                    } catch (Exception e) {
                                        cleanup();
                                        call.reject("Could not create the PDF file: " + e.getMessage());
                                    }
                                }

                                @Override
                                public void onLayoutFailed(CharSequence error) {
                                    cleanup();
                                    call.reject("Could not lay out the PDF: " + error);
                                }
                            }, null);
                        } catch (Exception e) {
                            cleanup();
                            call.reject("Could not build the PDF: " + e.getMessage());
                        }
                    }

                    @Override
                    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                        // Only fail on the MAIN document: a missing image must
                        // not sink the whole job.
                        if (request != null && request.isForMainFrame() && !started) {
                            started = true;
                            cleanup();
                            call.reject("The document could not be prepared");
                        }
                    }
                });

                printView = wv;
                wv.loadDataWithBaseURL(baseUrl, html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                cleanup();
                call.reject("Render failed to start: " + e.getMessage());
            }
        });
    }

    /**
     * A PrintDocumentAdapter that serves an EXISTING PDF file.
     *
     * Android's print system accepts a ready-made PDF: the adapter contract is
     * "produce PDF bytes into this descriptor", and nothing requires those
     * bytes to be generated on demand. onLayout reports the document's page
     * count and declares CONTENT_TYPE_DOCUMENT; onWrite copies the file.
     *
     * It deliberately IGNORES the PrintAttributes it is handed. That is the
     * point: the page was already laid out at RENDER_ATTRS, and re-laying it
     * out at the driver's attributes is the bug this replaced.
     */
    private static final class PdfFileAdapter extends PrintDocumentAdapter {
        private final File pdf;
        private final String name;

        PdfFileAdapter(File pdf, String name) {
            this.pdf = pdf;
            this.name = name;
        }

        @Override
        public void onLayout(
            PrintAttributes oldAttributes,
            PrintAttributes newAttributes,
            CancellationSignal cancellationSignal,
            LayoutResultCallback callback,
            Bundle extras
        ) {
            if (cancellationSignal != null && cancellationSignal.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(name + ".pdf")
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(countPages())
                .build();
            // `changed = false`: the content is fixed, so the spooler need not
            // re-request it when the user changes a setting.
            callback.onLayoutFinished(info, false);
        }

        @Override
        public void onWrite(
            PageRange[] pages,
            ParcelFileDescriptor destination,
            CancellationSignal cancellationSignal,
            WriteResultCallback callback
        ) {
            try (InputStream in = new FileInputStream(pdf);
                 OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (cancellationSignal != null && cancellationSignal.isCanceled()) {
                        callback.onWriteCancelled();
                        return;
                    }
                    out.write(buf, 0, n);
                }
                out.flush();
                // The whole document is always written. A page SUBSET chosen in
                // the dialog is not honoured here — the spooler re-extracts the
                // requested pages from what it receives, so the user still gets
                // what they asked for.
                callback.onWriteFinished(new PageRange[]{ PageRange.ALL_PAGES });
            } catch (Exception e) {
                callback.onWriteFailed(e.getMessage());
            }
        }

        /** Real page count, so the dialog's preview and range controls are right. */
        private int countPages() {
            ParcelFileDescriptor fd = null;
            PdfRenderer r = null;
            try {
                fd = ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY);
                r = new PdfRenderer(fd);
                return r.getPageCount();
            } catch (Exception e) {
                // UNKNOWN is legal and simply leaves the preview page-count blank.
                return PrintDocumentInfo.PAGE_COUNT_UNKNOWN;
            } finally {
                try { if (r != null) r.close(); } catch (Exception ignored) {}
                try { if (fd != null) fd.close(); } catch (Exception ignored) {}
            }
        }
    }

    // ── filing and sharing ───────────────────────────────────────────────────

    /** Anything unsafe in a filename — a document number can contain '/'. */
    private static String safeName(String raw) {
        return (raw == null ? "document" : raw).replaceAll("[^A-Za-z0-9._-]", "_");
    }

    /** Copy the rendered PDF into the public Downloads collection. */
    private Uri publishToDownloads(File src, String fileName) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            cv.put(MediaStore.Downloads.MIME_TYPE, "application/pdf");
            cv.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri item = getContext().getContentResolver()
                .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (item == null) throw new Exception("Downloads is not writable");
            try (InputStream in = new FileInputStream(src);
                 OutputStream out = getContext().getContentResolver().openOutputStream(item)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            cv.clear();
            cv.put(MediaStore.Downloads.IS_PENDING, 0);
            getContext().getContentResolver().update(item, cv, null, null);
            return item;
        }
        File dir = android.os.Environment.getExternalStoragePublicDirectory(
            android.os.Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists()) dir.mkdirs();
        File dest = new File(dir, fileName);
        try (InputStream in = new FileInputStream(src);
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        return Uri.fromFile(dest);
    }

    /**
     * Offer the PDF straight to another app — the rider's next move is the
     * printer's own app, and a share sheet puts it one tap away. A FileProvider
     * content:// URI, because a file:// URI handed to another app raises
     * FileUriExposedException on modern Android.
     */
    private void shareFile(File file, String fileName) {
        try {
            Uri content = FileProvider.getUriForFile(
                getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/pdf");
            send.putExtra(Intent.EXTRA_STREAM, content);
            send.putExtra(Intent.EXTRA_SUBJECT, fileName);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Open with");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
        } catch (Exception e) {
            // Non-fatal: the file is already in Downloads.
        }
    }

    private void cleanup() {
        if (printView != null) {
            try { printView.destroy(); } catch (Exception ignored) {}
            printView = null;
        }
    }
}
