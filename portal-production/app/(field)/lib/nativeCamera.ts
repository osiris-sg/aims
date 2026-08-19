"use client";

import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";

/**
 * Native camera capture for the field app.
 *
 * ⚠️ Uses Camera.takePhoto() — the Ion in-app camera (CameraX-backed) that
 * drives the sensor directly. It does NOT fire ACTION_IMAGE_CAPTURE, so it works
 * on devices (e.g. the Sunmi V3) that ship no external camera app. The
 * deprecated Camera.getPhoto() delegates to ACTION_IMAGE_CAPTURE and would fail
 * identically to the old <input capture> path — do not use it here.
 */

/**
 * Can the IN-APP CameraX capture actually run here?
 *
 * This is a PLUGIN REGISTRY check, not a hardware capability probe. It asks
 * whether @capacitor/camera has a JS implementation registered for this
 * platform, or the native bridge advertised it in PluginHeaders, which is
 * exactly "does the installed APK carry the plugin". That is the question that
 * matters: a build predating the plugin cannot run takePhoto no matter what
 * sensors the device has.
 *
 * It replaces the old FEATURE_CAMERA_ANY probe (DeviceCamera.hasCamera), which
 * guessed wrong twice: rugged devices like the Sunmi V3 under-report that
 * feature even with a working sensor, so the probe hid the in-app camera and
 * left only a gallery the Sunmi cannot populate.
 *
 * Synchronous, so callers can decide the capture path BEFORE the first tap
 * rather than wasting one discovering it.
 */
export function canUseInAppCamera(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Camera");
}

// takePhoto needs the runtime CAMERA grant (declared in the manifest); request
// it once, matching how the WebView flow would have prompted.
async function ensureCameraPermission(): Promise<void> {
  const perm = await Camera.checkPermissions();
  if (perm.camera !== "granted") {
    const req = await Camera.requestPermissions({ permissions: ["camera"] });
    if (req.camera !== "granted") throw new Error("Camera permission denied");
  }
}

// One capture. Returns null if the rider backed out of the camera (not an
// error), else the shot as a File. Throws on a real failure so the caller can
// show the guard. targetWidth/Height + quality make the PLUGIN resize the image
// natively (off the WebView main thread) — the returned File is already small,
// so callers skip the redundant main-thread canvas compression.
async function takeOne(): Promise<File | null> {
  let result;
  try {
    result = await Camera.takePhoto({
      targetWidth: 1600,
      targetHeight: 1600,
      quality: 70,
      correctOrientation: true,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? "");
    // Capacitor reports a user back-out as a "cancel" error — not a real failure.
    if (/cancel/i.test(msg)) return null;
    throw e;
  }

  const uri = result?.uri;
  if (!uri) throw new Error("Camera returned no image");
  // Native file URI → a WebView-loadable URL so fetch() can read the bytes.
  const src = Capacitor.convertFileSrc(uri);
  const blob = await (await fetch(src)).blob();
  const type = blob.type || "image/jpeg";
  return new File([blob], `camera-${Date.now()}.jpg`, { type });
}

/**
 * Single in-app capture (used where only one photo is wanted — nameplate scans).
 * The returned File is already downsized by the plugin; do NOT re-compress it.
 */
export async function captureNativePhoto(): Promise<File | null> {
  await ensureCameraPermission();
  return takeOne();
}

/**
 * Multi-shot capture: the camera auto-reopens after each confirmed shot so the
 * rider can take several in a row; backing out of the camera ENDS the run (the
 * "back = done" signal — takePhoto returns null on cancel). Returns every File
 * captured. Each is already plugin-downsized (skip re-compression).
 *
 * Error handling: a real failure after ≥1 capture keeps what was taken and stops
 * cleanly; a failure before any capture rethrows so the caller shows the guard.
 */
export async function captureNativePhotos(): Promise<File[]> {
  await ensureCameraPermission();
  const files: File[] = [];
  for (;;) {
    let file: File | null;
    try {
      file = await takeOne();
    } catch (e) {
      if (files.length > 0) break; // keep what we captured; stop on the error
      throw e; // nothing captured yet → surface for the "camera unavailable" guard
    }
    if (!file) break; // rider backed out of the camera = done
    files.push(file);
  }
  return files;
}
