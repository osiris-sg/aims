package android.print;

/**
 * Shim that lets app code drive PrintDocumentAdapter directly.
 *
 * PrintDocumentAdapter.LayoutResultCallback and WriteResultCallback both have
 * PACKAGE-PRIVATE constructors, so they cannot be subclassed from outside
 * `android.print` — the framework intends only the print spooler to construct
 * them. Rendering HTML straight to a PDF file (rather than via the print
 * dialog) needs exactly those callbacks, so the class that extends them has to
 * declare itself in this package. That is what this file is: two abstract
 * subclasses with PUBLIC constructors, which app code can then extend from its
 * own package.
 *
 * This is the conventional workaround for "HTML to PDF without the dialog" on
 * Android and touches no private API — it only widens the visibility of a
 * constructor the platform already exposes to its own package.
 *
 * It lives here ONLY for that reason. Nothing else belongs in android.print.
 */
public final class PdfPrintCallbacks {

    private PdfPrintCallbacks() {}

    /** LayoutResultCallback with a constructor app code can call. */
    public abstract static class Layout extends PrintDocumentAdapter.LayoutResultCallback {
        public Layout() {
            super();
        }
    }

    /** WriteResultCallback with a constructor app code can call. */
    public abstract static class Write extends PrintDocumentAdapter.WriteResultCallback {
        public Write() {
            super();
        }
    }
}
