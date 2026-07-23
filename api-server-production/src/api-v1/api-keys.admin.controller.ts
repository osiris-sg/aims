import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ApiKeysService } from './api-keys.service';

// Admin management of external API keys, following the AdminController
// pattern: Clerk-authenticated + OsirisAdmin-only (req.isOsirisAdmin is set by
// the guard). Org comes from the path so the admin org page can manage any org.

interface AdminRequest extends Request {
  isOsirisAdmin?: boolean;
  auth?: { userId: string };
}

@ApiTags('admin api-keys')
@ApiBearerAuth()
@Controller('admin/organizations/:orgId/api-keys')
@UseGuards(ClerkAuthGuard)
export class ApiKeysAdminController {
  constructor(private readonly keys: ApiKeysService) {}

  private assertOsirisAdmin(req: AdminRequest) {
    if (!req.isOsirisAdmin) {
      throw new ForbiddenException('Access denied. Only OsirisAdmin can manage API keys.');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List an organization\'s external API keys (no secrets).' })
  list(@Req() req: AdminRequest, @Param('orgId') orgId: string) {
    this.assertOsirisAdmin(req);
    return this.keys.list(orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Mint a new API key — plaintext returned ONCE in this response.' })
  create(
    @Req() req: AdminRequest,
    @Param('orgId') orgId: string,
    @Body() body: { name: string; scopes?: string[]; autoPost?: boolean },
  ) {
    this.assertOsirisAdmin(req);
    return this.keys.create(orgId, body || ({} as any), req.auth?.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a key / toggle autoPost / adjust scopes.' })
  update(
    @Req() req: AdminRequest,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; autoPost?: boolean; scopes?: string[] },
  ) {
    this.assertOsirisAdmin(req);
    return this.keys.update(orgId, id, body || {});
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revoke a key (immediate; irreversible).' })
  revoke(@Req() req: AdminRequest, @Param('orgId') orgId: string, @Param('id') id: string) {
    this.assertOsirisAdmin(req);
    return this.keys.revoke(orgId, id);
  }
}
