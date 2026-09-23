package so.osiris.aims.field;

import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
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

    private void cleanup() {
        if (printView != null) {
            try { printView.destroy(); } catch (Exception ignored) {}
            printView = null;
        }
    }
}
