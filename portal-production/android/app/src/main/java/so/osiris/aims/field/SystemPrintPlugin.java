package so.osiris.aims.field;

import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.print.PageRange;
import android.print.PdfPrintCallbacks;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
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
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * SystemPrint — hand an HTML document to Android's own print system.
 *
 * WHY THIS EXISTS AT ALL
 * `window.print()` is a NO-OP in an Android WebView. Chrome implements printing
 * in its browser chrome, not in the web engine, so a bare WebView — which is
 * all Capacitor gives us — has nothing listening. There is no error and no
 * dialog; the call simply returns. Reaching Android's print system means going
 * through PrintManager natively, which is what this does.
 *
 * WHY A SECOND WEBVIEW, NOT THE APP'S
 * `bridge.getWebView()` holds the whole running app — printing it would print
 * the field UI, not the document. So the HTML is loaded into a throwaway
 * offscreen WebView whose only content is the document.
 *
 * WHY THE PRINT IS STARTED FROM onPageFinished
 * createPrintDocumentAdapter() snapshots whatever the WebView has laid out at
 * that instant. Called too early it captures a blank or half-styled page.
 * onPageFinished fires after the document and its subresources have settled,
 * which is the earliest safe point. (The web side additionally inlines every
 * image as a data: URI before handing the HTML over, so there is no network
 * fetch left to race — see systemPrint.ts.)
 *
 * MARGINS ARE THE CSS'S JOB
 * PrintAttributes carries NO_MARGINS deliberately: the document's own
 * `@page { margin: 6mm }` is the canonical geometry (186×277mm sheet inside a
 * 6mm printer ring, shared with the portal's Print/PDF). Setting margins here
 * as well would stack on top of it and shrink the sheet twice.
 */
@CapacitorPlugin(name = "SystemPrint")
public class SystemPrintPlugin extends Plugin {

    /**
     * Held for the life of the print job. PrintManager only keeps a weak grip
     * on the adapter, and the adapter is backed by this WebView: if it were a
     * local that went out of scope, GC could collect it mid-job and the spooler
     * would hand the user a blank or truncated document.
     */
    private WebView printView;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        // PrintManager has shipped since API 19; minSdk is far above that, so
        // this is really "are we in the native shell at all".
        ret.put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT);
        call.resolve(ret);
    }

    @PluginMethod
    public void printHtml(PluginCall call) {
        final String html = call.getString("html");
        if (html == null || html.isEmpty()) { call.reject("html is required"); return; }
        final String jobName = call.getString("jobName", "Document");
        // Resolves any relative URL left in the document, and gives the WebView
        // an origin so same-origin rules behave sanely.
        final String baseUrl = call.getString("baseUrl", "https://app.ai-ms.io/");

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
                // viewport — without this the print reflows to ~360dp and the
                // A4 sheet comes out as a narrow column.
                s.setUseWideViewPort(true);
                s.setLoadWithOverviewMode(false);

                wv.setWebViewClient(new WebViewClient() {
                    private boolean started = false;

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        // onPageFinished can fire more than once (frames,
                        // history); only ever start one job.
                        if (started) return;
                        started = true;
                        try {
                            PrintManager pm = (PrintManager) getContext().getSystemService(android.content.Context.PRINT_SERVICE);
                            if (pm == null) { cleanup(); call.reject("This device has no print service"); return; }

                            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                            PrintAttributes attrs = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                                // See the class docblock — the document's own
                                // @page margin is the only margin.
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();

                            pm.print(jobName, adapter, attrs);
                            // Resolving here means "the dialog is up", not "the
                            // page came out": once Android owns the job the user
                            // may pick a printer, change settings or cancel, and
                            // none of that is reported back to us. The rider is
                            // told exactly that.
                            call.resolve();
                        } catch (Exception e) {
                            cleanup();
                            call.reject("Could not open the print dialog: " + e.getMessage());
                        }
                    }

                    @Override
                    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                        // Only fail on the MAIN document: a missing image must
                        // not sink the whole print.
                        if (request != null && request.isForMainFrame() && !started) {
                            started = true;
                            cleanup();
                            call.reject("The document could not be prepared for printing");
                        }
                    }
                });

                printView = wv;
                wv.loadDataWithBaseURL(baseUrl, html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                cleanup();
                call.reject("Print failed to start: " + e.getMessage());
            }
        });
    }

    /**
     * Render the same HTML to a PDF FILE, with no print dialog.
     *
     * WHY THIS IS NEEDED AT ALL: the X1000 makes its own WiFi hotspot with no
     * internet. The tablet cannot be on that hotspot and on the network that
     * serves this app at the same time — so the rider must be able to take the
     * document WITH them: save the PDF first, join the printer's WiFi, then
     * print from the printer's own app. Android's print dialog offers
     * "Save as PDF", but that buries the file behind a picker and a filename
     * prompt at exactly the moment the rider is standing at a truck.
     *
     * HOW: PrintDocumentAdapter is the same machinery the dialog drives, just
     * called directly — onLayout to settle the page geometry, then onWrite to a
     * file descriptor we own. The result is the byte-identical PDF the dialog
     * would have produced, which is what keeps print and download the same
     * document.
     *
     * WHERE IT LANDS: the public Downloads collection, so it appears in Files,
     * in the Downloads app, and in any app's file picker — including the
     * printer's. On API 29+ that is MediaStore (no storage permission needed,
     * which is why this asks for none); below it, the legacy Downloads
     * directory.
     */
    @PluginMethod
    public void savePdf(PluginCall call) {
        final String html = call.getString("html");
        if (html == null || html.isEmpty()) { call.reject("html is required"); return; }
        final String rawName = call.getString("fileName", "document");
        // Strip anything that is not safe in a filename — a document number can
        // legitimately contain '/' and would otherwise create a directory.
        final String fileName = rawName.replaceAll("[^A-Za-z0-9._-]", "_") + ".pdf";
        final String baseUrl = call.getString("baseUrl", "https://app.ai-ms.io/");
        final boolean share = Boolean.TRUE.equals(call.getBoolean("share", false));

        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                final WebView wv = new WebView(getContext());
                WebSettings s2 = wv.getSettings();
                s2.setJavaScriptEnabled(false);
                s2.setLoadsImagesAutomatically(true);
                s2.setUseWideViewPort(true);
                s2.setLoadWithOverviewMode(false);

                wv.setWebViewClient(new WebViewClient() {
                    private boolean started = false;

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (started) return;
                        started = true;
                        try {
                            PrintAttributes attrs = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                                // The document's own @page margin is the only
                                // margin — same rule as the print path.
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();

                            final PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(fileName);
                            // Scratch file first: MediaStore wants a stream to
                            // copy, and writing through a temp keeps a failed
                            // render from leaving a half-written file in the
                            // user's Downloads.
                            final File tmp = new File(getContext().getCacheDir(), fileName);

                            // See PdfPrintCallbacks: these two callbacks have package-private
                            // constructors, so the subclass has to live in android.print.
                            adapter.onLayout(null, attrs, null, new PdfPrintCallbacks.Layout() {
                                @Override
                                public void onLayoutFinished(android.print.PrintDocumentInfo info, boolean changed) {
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
                                                        Uri saved = publishToDownloads(tmp, fileName);
                                                        cleanup();
                                                        if (share && saved != null) shareFile(tmp, fileName);
                                                        JSObject ret = new JSObject();
                                                        ret.put("uri", saved != null ? saved.toString() : "");
                                                        ret.put("fileName", fileName);
                                                        call.resolve(ret);
                                                    } catch (Exception e) {
                                                        cleanup();
                                                        call.reject("Saved the PDF but could not file it: " + e.getMessage());
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
                        if (request != null && request.isForMainFrame() && !started) {
                            started = true;
                            cleanup();
                            call.reject("The document could not be prepared for saving");
                        }
                    }
                });

                printView = wv;
                wv.loadDataWithBaseURL(baseUrl, html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                cleanup();
                call.reject("Save failed to start: " + e.getMessage());
            }
        });
    }

    /** Copy the rendered PDF into the public Downloads collection. */
    private Uri publishToDownloads(File src, String fileName) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            cv.put(MediaStore.Downloads.MIME_TYPE, "application/pdf");
            cv.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            Uri item = getContext().getContentResolver().insert(collection, cv);
            if (item == null) throw new Exception("Downloads is not writable");
            try (InputStream in = new java.io.FileInputStream(src);
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
        // Pre-Q: the legacy public Downloads directory.
        File dir = android.os.Environment.getExternalStoragePublicDirectory(
            android.os.Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists()) dir.mkdirs();
        File dest = new File(dir, fileName);
        try (InputStream in = new java.io.FileInputStream(src);
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        return Uri.fromFile(dest);
    }

    /**
     * Offer the PDF straight to another app.
     *
     * This is the point of the feature: the rider's next move is to open the
     * printer's own app, and a share sheet puts it one tap away instead of
     * sending them hunting through Files. Uses a FileProvider content:// URI —
     * a file:// URI thrown at another app raises FileUriExposedException on
     * modern Android.
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
            // Non-fatal: the file is already in Downloads, so the rider can
            // still reach it the slow way.
        }
    }

    private void cleanup() {
        if (printView != null) {
            try { printView.destroy(); } catch (Exception ignored) {}
            printView = null;
        }
    }
}
