import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { hashApiKey } from './api-v1-key.guard';

// Minting, listing and revoking the per-org external API keys. The plaintext
// key is returned ONCE at creation and never stored — only its sha256 hash.

const DEFAULT_SCOPES = ['documents:create', 'documents:read'];

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        autoPost: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  async create(
    organizationId: string,
    dto: { name: string; scopes?: string[]; autoPost?: boolean },
    createdBy?: string,
  ) {
    const plaintext = `aims_${randomBytes(24).toString('hex')}`;
    const prefix = plaintext.slice(0, 13); // "aims_" + 8 chars — enough to recognise
    const row = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name: (dto.name || 'API key').trim(),
        prefix,
        keyHash: hashApiKey(plaintext),
        scopes: dto.scopes?.length ? dto.scopes : DEFAULT_SCOPES,
        autoPost: !!dto.autoPost,
        createdBy: createdBy ?? null,
      },
      select: { id: true, name: true, prefix: true, scopes: true, autoPost: true, createdAt: true },
    });
    // `key` is shown once in the UI and never retrievable again.
    return { ...row, key: plaintext };
  }

  async update(
    organizationId: string,
    id: string,
    dto: { name?: string; autoPost?: boolean; scopes?: string[] },
  ) {
    const existing = await this.prisma.apiKey.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('API key not found');
    return this.prisma.apiKey.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        autoPost: dto.autoPost !== undefined ? dto.autoPost : undefined,
        scopes: dto.scopes !== undefined ? dto.scopes : undefined,
      },
      select: { id: true, name: true, prefix: true, scopes: true, autoPost: true, revokedAt: true },
    });
  }

  async revoke(organizationId: string, id: string) {
    const existing = await this.prisma.apiKey.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('API key not found');
    return this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: { id: true, revokedAt: true },
    });
  }
}
