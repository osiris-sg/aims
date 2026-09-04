import { Body, Controller, Delete, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserOrganization } from '../auth/decorators/user-organization.decorator';
import { DeleteDeviceTokenDto, RegisterDeviceTokenDto } from './dto/device-token.dto';
import { DeviceTokenService } from './device-token.service';

interface ClerkRequest extends Request {
  user?: { id: string };
}

/**
 * Device-token registration for push. AUTHENTICATED (the global ClerkAuthGuard
 * applies — no @Public here): the token is bound to the caller's own Clerk user
 * and active org, never to ids supplied in the body, so one device can never
 * register itself against somebody else's account.
 */
@ApiTags('push')
@Controller('device-tokens')
export class PushController {
  constructor(private readonly deviceTokens: DeviceTokenService) {}

  @Post()
  @ApiOperation({ summary: 'Register or refresh this device’s push token' })
  register(
    @Body() dto: RegisterDeviceTokenDto,
    @Req() req: ClerkRequest,
    @UserOrganization() org: { id: string },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new Error('Missing authenticated user');
    return this.deviceTokens.register(userId, org.id, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Drop this device’s push token (logout)' })
  remove(@Body() dto: DeleteDeviceTokenDto, @Req() req: ClerkRequest) {
    const userId = req.user?.id;
    if (!userId) throw new Error('Missing authenticated user');
    return this.deviceTokens.remove(userId, dto.token);
  }
}
