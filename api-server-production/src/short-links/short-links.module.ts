import { Global, Module } from '@nestjs/common';
import { ShortLinksController } from './short-links.controller';
import { PrismaService } from '../common/prisma.service';
import { ShortLinksService } from './short-links.service';

/** Round AD: short redirect links for the WhatsApp pushes (global — the shipments / email / operator modules create them). */
@Global()
@Module({ controllers: [ShortLinksController], providers: [ShortLinksService, PrismaService], exports: [ShortLinksService] })
export class ShortLinksModule {}
