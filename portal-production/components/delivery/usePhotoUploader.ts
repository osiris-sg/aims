"use client";

import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { captureNativePhoto, captureNativePhotos } from "@/app/(field)/lib/nativeCamera";
import { compressImageBlob } from "@/app/(field)/lib/imageCompress";

export interface CapturedPhoto {
  key: string;
  previewUrl: string;
  /**
   * Angle label ("front"/"back"/"left"/"right"/"top", or "" for a free-form /
   * extra shot). Stamped positionally by GuidedPhotoCapture and submitted parallel
   * to the flat photos[] so returns can pair by angle. Absent for free-form captures.
   */
  angle?: string;
}

interface Options {
  /**
   * Uploads ONE compressed blob and resolves its stored key (or null to skip).
   * Auth lives in the CALLER, never here: the field flow wraps uploadImage() +
   * Clerk, the guest flow wraps the token-scoped /public endpoint.
   */
  upload: (blob: Blob) => Promise<string | null>;
  onError?: (message: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
}

/**
 * The capture plumbing shared by every proof-photo surface: native-camera
 * detection, compression, upload. Extracted from PhotoCaptureField so the
 * guided equipment flow (one shot per angle) and the free-form grid (multi-shot
 * in a row) behave identically where it matters and differ only in their UI.
 *
 * Every source is compressed. The native Sunmi camera ignores takePhoto's
 * resize and hands back raw 8 MP frames, so we never trust the plugin to have
 * downsized; compressImageBlob does the decode/encode off the main thread.
 */
export function usePhotoUploader({ upload, onError, onUploadingChange }: Options) {
  const [uploading, setUploading] = useState(false);
  const isNative = Capacitor.isNativePlatform();
  // CAPTURE MODE — decided UP FRONT from the plugin registry, then corrected by
  // outcome if the call still fails.
  //
  // Two device classes need opposite things:
  //   • Sunmi V3     — no camera app at all, so <input capture> degrades to a
  //                    gallery it cannot populate. It NEEDS Camera.takePhoto().
  //   • normal phone — has a camera app; <input capture> opens it. takePhoto()
  //                    only works if the APK actually carries the plugin.
  //
  // isPluginAvailable is a REGISTRY check, not the FEATURE_CAMERA_ANY hardware
  // guess that got this wrong twice: it asks whether a JS implementation is
  // registered for this platform or the native bridge advertised the plugin in
  // PluginHeaders, i.e. whether the installed APK actually carries it. On a
  // build predating @capacitor/camera it returns false, so we start on <input>
  // and the very first tap opens the phone's camera.
  //
  // The outcome fallback stays as a safety net for "plugin present but the call
  // throws" (permission denied, no sensor). That path still costs one tap, but
  // it is a genuine error rather than the guaranteed every-session miss the
  // outcome-only design produced.
  const inAppSupported = isNative && Capacitor.isPluginAvailable('Camera');
  const [inAppFailed, setInAppFailed] = useState(false);
  const captureMode: 'inapp' | 'input' = inAppSupported && !inAppFailed ? 'inapp' : 'input';
  const [camMsg, setCamMsg] = useState<string | null>(null);

  const setUploadingFlag = (v: boolean) => {
    setUploading(v);
    onUploadingChange?.(v);
  };

  /** Compress + upload each file, in order. Returns only the ones that stored. */
  const ingestFiles = async (files: File[]): Promise<CapturedPhoto[]> => {
    if (files.length === 0) return [];
    onError?.("");
    setUploadingFlag(true);
    try {
      const out: CapturedPhoto[] = [];
      for (const file of files) {
        const blob = await compressImageBlob(file);
        const key = await upload(blob);
        if (key) out.push({ key, previewUrl: URL.createObjectURL(blob) });
      }
      return out;
    } catch (e: any) {
      onError?.(e?.message ?? "Upload failed");
      return [];
    } finally {
      setUploadingFlag(false);
    }
  };

  /**
   * Native multi-shot: the camera reopens after each shot so several can be
   * taken in a row; backing out ends the run. A real failure before any capture
   * flips to the gallery-only guard.
   */
  const takeNativePhotos = async (): Promise<CapturedPhoto[]> => {
    setCamMsg(null);
    try {
      const files = await captureNativePhotos();
      return files.length ? await ingestFiles(files) : [];
    } catch {
      setInAppFailed(true);
      setCamMsg("Switched to the device camera. Tap the camera button again.");
      return [];
    }
  };

  /** Native single shot, for the guided flow where each angle is its own step. */
  const takeNativePhotoOnce = async (): Promise<CapturedPhoto[]> => {
    setCamMsg(null);
    try {
      const file = await captureNativePhoto();
      return file ? await ingestFiles([file]) : [];
    } catch {
      setInAppFailed(true);
      setCamMsg("Switched to the device camera. Tap the camera button again.");
      return [];
    }
  };

  return {
    uploading,
    isNative,
    captureMode,
    camMsg,
    setCamMsg,
    ingestFiles,
    takeNativePhotos,
    takeNativePhotoOnce,
  };
}
