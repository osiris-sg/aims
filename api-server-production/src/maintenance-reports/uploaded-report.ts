import { BadRequestException } from '@nestjs/common';

/**
 * UPLOADED SERVICE REPORTS + THE PHOTOS ATTACHMENT (2026-11-12).
 *
 * An uploaded report is an ordinary SERVICE report whose paper already exists
 * (a scan, a PDF from another system): no schema change, stored as completed,
 * with the file and an `uploaded: true` marker in its own serviceData. Any
 * report may also carry ONE photos file (a PDF or an image) in
 * serviceData.photosFile.
 *
 * Both files come from POST /uploads/image, where the client picks the key, so
 * a key is only accepted under this org's own folder: a report can never be
 * pointed at another org's file and then downloaded through this module.
 */

export type ReportFile = { key: string; fileName: string; mimeType: string };

const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** The S3 folder an org's report files must live under. */
export const reportFileFolder = (organizationId: string) => `maintenance-reports/${organizationId}/`;

/** Validate an uploaded file reference (PDF or image, stored under the org's folder). */
export function cleanReportFile(body: any, organizationId: string): ReportFile {
  const key = typeof body?.fileKey === 'string' ? body.fileKey.trim() : '';
  if (!key || key.startsWith('data:')) throw new BadRequestException('Upload the file first');
  if (!key.startsWith(reportFileFolder(organizationId)) || key.includes('..')) {
    throw new BadRequestException('That file was not uploaded for this organisation');
  }
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : '';
  if (!MIME_EXT[mimeType]) throw new BadRequestException('Only a PDF or an image (JPG, PNG, WEBP, GIF) can be attached');
  const fileName = (typeof body?.fileName === 'string' ? body.fileName.trim() : '').slice(0, 200) || `file.${MIME_EXT[mimeType]}`;
  return { key, fileName, mimeType };
}

/** The extension a stored file downloads with. */
export const reportFileExt = (f: ReportFile) => MIME_EXT[f.mimeType] ?? 'pdf';

/** serviceData.uploadedFile when the report is an uploaded one, else null. */
export function uploadedFileOf(serviceData: unknown): ReportFile | null {
  const sd = (serviceData as Record<string, any> | null) ?? {};
  const f = sd.uploaded === true ? sd.uploadedFile : null;
  return f && typeof f.key === 'string' && f.key ? (f as ReportFile) : null;
}

/** serviceData.photosFile when the report has one, else null. */
export function photosFileOf(serviceData: unknown): ReportFile | null {
  const f = ((serviceData as Record<string, any> | null) ?? {}).photosFile;
  return f && typeof f.key === 'string' && f.key ? (f as ReportFile) : null;
}

/** "Service report #12 ….pdf" → "Service report #12 ….jpg" for an image file. */
export const withExt = (name: string, ext: string) => name.replace(/\.pdf$/i, `.${ext}`);

/** YYYY-MM-DD or null. */
export function cleanIsoDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
}
