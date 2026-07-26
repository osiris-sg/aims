// Shared multi-file/ZIP expansion for upload entry points (guru 2026-07-26:
// every upload behaves the same). Takes a raw file selection, expands ZIPs
// client-side, filters to supported types/sizes, and returns the flat list.
// Toasts explain anything skipped.

import JSZip from "jszip";
import { toast } from "react-toastify";

export const SUPPORTED_EXT = /\.(jpe?g|png|gif|webp|bmp|pdf)$/i;
export const UPLOAD_ACCEPT = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.zip,application/pdf,image/*,application/zip";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", pdf: "application/pdf",
};
const MAX_FILE = 10 * 1024 * 1024;
const MAX_ZIP = 25 * 1024 * 1024;

const isZip = (f: File) =>
  /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";

export async function expandUploadFiles(list: FileList | File[] | null): Promise<File[]> {
  if (!list) return [];
  const incoming = Array.from(list);
  const accepted: File[] = [];
  for (const f of incoming) {
    if (isZip(f)) {
      if (f.size > MAX_ZIP) {
        toast.error(`${f.name}: ZIP is over 25 MB.`);
        continue;
      }
      try {
        const zip = await JSZip.loadAsync(f);
        let pulled = 0;
        for (const entry of Object.values(zip.files)) {
          if (entry.dir) continue;
          const base = entry.name.split("/").pop() || entry.name;
          if (base.startsWith(".") || entry.name.startsWith("__MACOSX")) continue;
          if (!SUPPORTED_EXT.test(base)) continue;
          const blob = await entry.async("blob");
          if (blob.size > MAX_FILE) {
            toast.warn(`${base} (in ${f.name}) skipped — over 10 MB.`);
            continue;
          }
          const ext = base.split(".").pop()!.toLowerCase();
          accepted.push(new File([blob], base, { type: MIME_BY_EXT[ext] || "application/octet-stream" }));
          pulled++;
        }
        if (!pulled) toast.warn(`${f.name}: no supported files inside (JPG, PNG, WebP, BMP, GIF, PDF).`);
      } catch {
        toast.error(`${f.name}: couldn't read the ZIP.`);
      }
      continue;
    }
    const okType = SUPPORTED_EXT.test(f.name) || /image\//.test(f.type) || f.type === "application/pdf";
    if (!okType) {
      toast.error(`${f.name}: unsupported type. Use JPG, PNG, WebP, PDF, or a ZIP of those.`);
      continue;
    }
    if (f.size > MAX_FILE) {
      toast.error(`${f.name} is over 10 MB.`);
      continue;
    }
    accepted.push(f);
  }
  return accepted;
}
