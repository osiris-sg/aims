# SiteJobs release build (minify + shrinkResources on). Capacitor finds plugin
# methods by reflection, so plugin classes and their annotated methods must
# survive R8. Capacitor's AAR ships consumer rules for @CapacitorPlugin; the
# rules below restate them for our own plugins and the third-party ones, and
# keep Firebase Messaging, which is registered through the manifest.

# Capacitor core + bridge
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep @com.getcapacitor.NativePlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keepclassmembers class * extends com.getcapacitor.Plugin { public <methods>; }

# Our plugins (BtPrinter, DeviceCamera, SystemPrint) and the PdfPrint helper
-keep class so.osiris.aims.field.** { *; }
-keep class android.print.PdfPrintCallbacks { *; }

# Capacitor community / Capgo plugins
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.capgo.** { *; }
-keep class app.capgo.** { *; }
-keep class io.ionic.** { *; }

# Firebase Cloud Messaging (push notifications)
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# JS interface: the bridge exposes methods to the WebView by name
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface, *Annotation*, Signature, InnerClasses, EnclosingMethod

# Keep the names R8 would otherwise obfuscate in stack traces we read
-keepattributes SourceFile, LineNumberTable
