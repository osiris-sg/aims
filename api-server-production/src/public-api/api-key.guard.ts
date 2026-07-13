import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Shared-secret guard for the water-sg inbound pull API. Reads the presented
 * key from `Authorization: Bearer <key>` OR `X-Api-Key: <key>` and compares it
 * against WATER_SG_INBOUND_API_KEY.
 *
 * This is a DISTINCT secret from WATER_SG_API_KEY (which AIMS uses to call OUT
 * to water-sg) — separate trust direction, rotated independently.
 *
 * Fail-closed: a missing/blank server key rejects every request (never opens
 * the endpoint). Comparison is constant-time over SHA-256 digests so neither
 * the key value nor its length leaks via timing.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>('WATER_SG_INBOUND_API_KEY');
    if (!expected) {
      // Fail closed — an unconfigured key must never mean "allow all".
      this.logger.error('WATER_SG_INBOUND_API_KEY is not configured — rejecting request.');
      throw new UnauthorizedException('API key authentication is not available.');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const presented = this.extractKey(req);
    if (!presented || !this.safeEqual(presented, expected)) {
      throw new UnauthorizedException('Invalid or missing API key.');
    }
    return true;
  }

  /** `Authorization: Bearer <key>` takes precedence; falls back to `X-Api-Key`. */
  private extractKey(req: Request): string | null {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      if (token) return token;
    }
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim();
    return null;
  }

  /** Constant-time equality — hash both sides to a fixed length so unequal
   *  input lengths don't throw and don't leak via timing. */
  private safeEqual(a: string, b: string): boolean {
    const ha = createHash('sha256').update(a).digest();
    const hb = createHash('sha256').update(b).digest();
    return timingSafeEqual(ha, hb);
  }
}
