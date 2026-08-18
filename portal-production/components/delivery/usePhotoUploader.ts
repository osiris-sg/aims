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
  // CAPTURE MODE — chosen by OUTCOME, never by a capability probe.
  //
  // Two device classes have to work and they need opposite things:
  //   • Sunmi V3     — no camera app at all, so <input capture> degrades to a
  //                    gallery it cannot populate. It NEEDS Camera.takePhoto().
  //   • normal phone — has a camera app; <input capture> opens it. takePhoto()
  //                    only works if the APK actually carries the plugin.
  //
  // Probing was tried twice and guessed wrong both times: FEATURE_CAMERA_ANY
  // under-reports on the Sunmi, and assuming "native = takePhoto works" breaks
  // any device on an APK built before @capacitor/camera was added. So we stop
  // predicting. Native starts on the in-app camera (the Sunmi's only option);
  // if a real capture throws we fall back to <input capture> — the path that
  // worked before the Sunmi work — rather than stranding the rider on gallery.
  const [inAppFailed, setInAppFailed] = useState(false);
  const captureMode: 'inapp' | 'input' = isNative && !inAppFailed ? 'inapp' : 'input';
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
