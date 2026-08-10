"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
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

interface DeviceCameraPlugin {
  hasCamera(): Promise<{ value: boolean }>;
}
const DeviceCamera = registerPlugin<DeviceCameraPlugin>("DeviceCamera");

/**
 * True only in the native shell AND when the device reports a physical camera
 * sensor (FEATURE_CAMERA_ANY). Web always false — the web build keeps its
 * <input capture> path. Any failure resolves false (treated as "no camera").
 */
export async function hasNativeCamera(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    return (await DeviceCamera.hasCamera()).value;
  } catch {
    return false;
  }
}

/**
 * Open the in-app camera and return the shot as a File (fed into the same
 * compress→upload / extraction pipelines the <input> used). Returns null if the
 * user backed out (not an error). Throws on a real failure (permission denied,
 * no camera, sensor busy) so the caller can show the "camera unavailable" guard.
 */
export async function captureNativePhoto(): Promise<File | null> {
  // takePhoto needs the runtime CAMERA grant (declared in the manifest); request
  // it on first use, matching how the WebView flow would have prompted.
  const perm = await Camera.checkPermissions();
  if (perm.camera !== "granted") {
    const req = await Camera.requestPermissions({ permissions: ["camera"] });
    if (req.camera !== "granted") throw new Error("Camera permission denied");
  }

  let result;
  try {
    result = await Camera.takePhoto({ quality: 90 });
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
