import { request } from "./request";
import { generateShortName } from "./imageUploader";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
};

function extFromFile(file: File): string {
  // Prefer the actual filename extension if present, else infer from MIME.
  const m = file.name.match(/\.([a-zA-Z0-9]+)$/);
  if (m) return m[1].toLowerCase();
  return MIME_TO_EXT[file.type] || "bin";
}

export type UploadedFileMeta = {
  fileKey: string;
  fileName: string;
  mimeType: string;
  size: number;
};

/**
 * Upload an arbitrary File (PDF, image, doc, etc.) to S3 via /uploads/image
 * (despite the path the backend handler is MIME-agnostic). Returns the
 * stored fileKey + metadata for persisting onto the parent record.
 */
export async function uploadFile({
  file,
  folder,
  token,
}: {
  file: File;
  folder: string; // e.g. "bills/<billId>/attachments"
  token: string;
}): Promise<UploadedFileMeta> {
  const ext = extFromFile(file);
  const fileKey = `${folder}/${generateShortName()}-${Date.now()}.${ext}`;

  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("key", fileKey);

  const response: any = await request(
    { path: "/uploads/image", method: "POST" },
    formData,
    token,
    undefined,
    true, // isClientSide
    true, // formData
  );
  const returnedKey = response?.data?.Key || response?.Key || fileKey;
  return {
    fileKey: returnedKey,
    fileName: file.name,
    mimeType: file.type || `application/${ext}`,
    size: file.size,
  };
}

export function publicFileUrl(fileKey: string): string {
  const base =
    process.env.NEXT_PUBLIC_RESOURCE_URL ??
    "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/";
  return `${base.replace(/\/$/, "")}/${fileKey}`;
}
