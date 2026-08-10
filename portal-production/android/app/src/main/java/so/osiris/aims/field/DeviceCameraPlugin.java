package so.osiris.aims.field;

import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * DeviceCamera — a one-method capability probe the WebView can't do itself.
 *
 * hasCamera() reports whether the device actually has a camera SENSOR
 * (FEATURE_CAMERA_ANY). The proof-photo flow uses Camera.takePhoto() (the Ion
 * in-app camera, CameraX-backed) which needs NO external camera app — but it
 * still needs a physical camera. If there's none, the UI shows a "camera
 * unavailable — choose an existing photo" message instead of silently opening
 * the gallery, so the failure is legible rather than mysterious.
 */
@CapacitorPlugin(name = "DeviceCamera")
public class DeviceCameraPlugin extends Plugin {

    @PluginMethod
    public void hasCamera(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        boolean has = pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);
        JSObject ret = new JSObject();
        ret.put("value", has);
        call.resolve(ret);
    }
}
