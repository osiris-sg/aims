"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { hasNativeCamera, captureNativePhoto, captureNativePhotos } from "@/app/(field)/lib/nativeCamera";
import { compressImageBlob } from "@/app/(field)/lib/imageCompress";

export interface CapturedPhoto {
  key: string;
  previewUrl: string;
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
  // null = still checking / web (use <input>), true = native shell with a
  // camera sensor, false = native shell WITHOUT one (gallery only + guard).
  const isNative = Capacitor.isNativePlatform();
  const [nativeCam, setNativeCam] = useState<boolean | null>(null);
  const [camMsg, setCamMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    void hasNativeCamera().then((ok) => {
      if (!cancelled) setNativeCam(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [isNative]);

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
      setNativeCam(false);
      setCamMsg("Camera unavailable. Choose an existing photo below.");
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
      setNativeCam(false);
      setCamMsg("Camera unavailable. Choose an existing photo below.");
      return [];
    }
  };

  return {
    uploading,
    isNative,
    nativeCam,
    camMsg,
    setCamMsg,
    ingestFiles,
    takeNativePhotos,
    takeNativePhotoOnce,
  };
}
