import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { S3Service } from '../common/services/s3.service';
import { SubmitTempSignatureDto } from './dto/submit-temp-signature.dto';

/**
 * TEMPORARY standalone signature capture (2026-09).
 *
 * A client who cannot use the field app signs here instead: name + signature +
 * optional comment, straight to S3 for MANUAL backfill onto a delivery later.
 * Deliberately standalone — no DO, no delivery, no token, no database row, no
 * schema change. Nothing downstream reads this; it is a drop box.
 *
 * ⚠️ This endpoint is UNAUTHENTICATED and has no token in front of it, so the
 * only things standing between it and the open internet are the validation and
 * the rate limiter below. Both are load-bearing — do not relax either.
 */

// ── limits ──────────────────────────────────────────────────────────────────
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB — a trimmed PNG signature is ~10–40 KB
const MAX_NAME_LEN = 120;
const MAX_COMMENT_LEN = 1000;

/** Only what a signature pad can produce. No SVG (script-bearing), no PDF. */
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg']);

/**
 * Magic-byte signatures, checked against the DECODED bytes — a client-declared
 * MIME type is not evidence. The guest delivery photo upload validates neither
 * type nor size; this deliberately does both.
 */
const MAGIC: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

// ── IN-MEMORY rate limiter ──────────────────────────────────────────────────
// ⚠️ Same caveat as public-delivery: this state lives in THIS Node process
// ONLY. Render runs a SINGLE backend instance today, so a per-process limiter
// is sufficient. If the backend is EVER scaled horizontally, each instance
// keeps its own counters and the limit silently weakens to per-instance. Move
// to a shared store (Redis) BEFORE scaling beyond one instance.
//
// Keyed on client IP alone — unlike the other public surfaces there is no token
// to scope by, so the limit is deliberately tighter than their 60/min.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 10; // submissions per IP per minute
const rlBuckets = new Map<string, { count: number; resetAt: number }>();

@Injectable()
export class TempSignatureService {
  private readonly logger = new Logger(TempSignatureService.name);

  constructor(private readonly s3: S3Service) {}

  /** Per-IP gate. Throws 429 when the caller is over the limit. */
  rateGate(ip: string) {
    const key = ip || 'unknown';
    const now = Date.now();
    const bucket = rlBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rlBuckets.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
      return;
    }
    if (bucket.count >= RL_MAX) {
      throw new HttpException(
        'Too many submissions. Please wait a minute and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    bucket.count += 1;
    // Opportunistic sweep so a flood of distinct IPs cannot grow the map forever.
    if (rlBuckets.size > 5000) {
      for (const [k, v] of rlBuckets) if (v.resetAt <= now) rlBuckets.delete(k);
    }
  }

  /**
   * Decode + validate a `data:image/png;base64,…` signature.
   * Rejects: non-data-URLs, disallowed MIME, oversized payloads, and any body
   * whose real magic bytes disagree with the declared type.
   */
  private decodeSignature(dataUrl: string): { buffer: Buffer; mime: string; ext: string } {
    const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl || '');
    if (!m) throw new BadRequestException('Signature must be a base64 image data URL');

    const declared = m[1].toLowerCase();
    if (!ALLOWED_IMAGE_MIME.has(declared)) {
      throw new BadRequestException('Signature must be a PNG or JPEG image');
    }

    // Cheap size gate on the encoded string BEFORE allocating the buffer.
    const b64 = m[2].replace(/\s/g, '');
    if (Math.ceil((b64.length * 3) / 4) > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Signature image is too large');
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      throw new BadRequestException('Signature image could not be decoded');
    }
    if (buffer.length === 0) throw new BadRequestException('Signature image is empty');
    if (buffer.length > MAX_IMAGE_BYTES) throw new BadRequestException('Signature image is too large');

    // The bytes must actually BE the declared image type.
    const hit = MAGIC.find(
      (sig) => sig.mime === declared && sig.bytes.every((b, i) => buffer[i] === b),
    );
    if (!hit) throw new BadRequestException('That file is not a valid image');

    return { buffer, mime: declared, ext: declared === 'image/png' ? 'png' : 'jpg' };
  }

  /**
   * Store one submission as TWO objects sharing a base key:
   *   temp-signature/<YYYY-MM-DD>/<ISO timestamp>-<rand>.png    ← the signature
   *   temp-signature/<YYYY-MM-DD>/<ISO timestamp>-<rand>.json   ← the sidecar
   *
   * The random suffix means two submissions in the same millisecond cannot
   * collide, so nothing ever overwrites anything.
   */
  async submit(dto: SubmitTempSignatureDto, meta: { ip: string; userAgent: string }) {
    const name = String(dto?.name ?? '').trim();
    if (!name) throw new BadRequestException('Please enter your name');
    if (name.length > MAX_NAME_LEN) throw new BadRequestException('Name is too long');

    const comment = String(dto?.comment ?? '').trim();
    if (comment.length > MAX_COMMENT_LEN) {
      throw new BadRequestException(`Comment must be ${MAX_COMMENT_LEN} characters or fewer`);
    }

    if (!dto?.signature) throw new BadRequestException('Please draw your signature');
    const { buffer, mime, ext } = this.decodeSignature(dto.signature);

    const submittedAt = new Date();
    const day = submittedAt.toISOString().slice(0, 10); // YYYY-MM-DD
    const stamp = submittedAt.toISOString().replace(/[:.]/g, '-'); // filename-safe ISO
    const rand = randomBytes(4).toString('hex');
    const baseKey = `temp-signature/${day}/${stamp}-${rand}`;
    const imageKey = `${baseKey}.${ext}`;
    const sidecarKey = `${baseKey}.json`;

    const sidecar = {
      name,
      comment: comment || null,
      imageKey,
      submittedAt: submittedAt.toISOString(),
      // For disambiguation at backfill time when several people sign the same day.
      ip: meta.ip || null,
      userAgent: (meta.userAgent || '').slice(0, 500) || null,
    };

    await this.s3.uploadFile(imageKey, buffer, mime);
    await this.s3.uploadFile(sidecarKey, JSON.stringify(sidecar, null, 2), 'application/json');

    // Key logged server-side only — the response deliberately reveals nothing
    // about storage.
    this.logger.log(`[temp-signature] stored ${imageKey} (${buffer.length} bytes) for "${name}"`);

    return { success: true };
  }
}
