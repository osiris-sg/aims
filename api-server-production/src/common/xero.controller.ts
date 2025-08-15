import { Controller, Get, Query, Res, UseGuards, HttpException, HttpStatus, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { XeroService } from './xero.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Public } from 'src/decorators/public.decorator';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@Controller('xero')
@UseGuards(ClerkAuthGuard)
export class XeroController {
  constructor(private readonly xeroService: XeroService) {}

  /**
   * Initiate Xero OAuth flow
   * GET /xero/connect?organizationId=xxx
   */
  @Public()
  @Get('connect')
  async connectXero(@Query('organizationId') organizationId: string, @Res() res: Response) {
    try {
      if (!organizationId) {
        return res.status(400).json({ error: 'organizationId is required' });
      }

      const authUrl = await this.xeroService.getAuthorizationUrl(organizationId);
      res.redirect(authUrl);
    } catch (error) {
      res.status(500).json({ error: 'Failed to initiate Xero connection' });
    }
  }

  /**
   * Handle Xero OAuth callback
   * GET /xero/callback?code=...&state=...
   */
  @Public()
  @Get('callback')
  async handleCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    try {
      // Extract organizationId from state parameter
      const organizationId = state;

      if (!organizationId || organizationId === 'no-org') {
        console.error('🔴 XERO CALLBACK: No organization ID in state parameter');
        res.redirect(`${process.env.APP_URL}/portal/integrations?xero=error&details=${encodeURIComponent('No organization ID provided')}`);
        return;
      }

      const result = await this.xeroService.handleOAuthCallback(code, state, organizationId);

      // Check if this is a debug response
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        console.log('Xero OAuth debug result:', result);
        // Still redirect to error page but with debug info
        const message = 'message' in result ? result.message : 'Unknown debug error';
        res.redirect(`${process.env.APP_URL}/portal/integrations?xero=debug&msg=${encodeURIComponent(message as string)}`);
        return;
      }

      console.log('Xero connection successful for organization:', organizationId, result);

      // Redirect to a success page in your frontend
      res.redirect(`${process.env.APP_URL}/portal/integrations?xero=success`);
    } catch (error) {
      console.error('Xero OAuth callback error:', error);
      res.redirect(`${process.env.APP_URL}/portal/integrations?xero=error&details=${encodeURIComponent(error.message)}`);
    }
  }

  /**
   * Get connection status
   * GET /xero/status
   */
  @Get('status')
  async getConnectionStatus(@Req() req: RequestWithOrganization) {
    try {
      const organizationId = req.userOrganization?.id;
      if (!organizationId) {
        return {
          connected: false,
          message: 'Organization not found',
        };
      }

      // Use the new getConnectionStatus method from XeroService
      return this.xeroService.getConnectionStatus(organizationId);
    } catch (error) {
      return {
        connected: false,
        message: 'Error checking Xero connection status',
        error: error.message,
      };
    }
  }

  /**
   * Get Xero accounts for dropdown selection
   * GET /xero/accounts
   */
  @Get('accounts')
  async getAccounts(@Req() req: RequestWithOrganization) {
    try {
      const organizationId = req.userOrganization?.id;
      if (!organizationId) {
        throw new HttpException('Organization not found', HttpStatus.BAD_REQUEST);
      }

      const accounts = await this.xeroService.getAccounts(organizationId);
      return {
        success: true,
        data: accounts,
      };
    } catch (error) {
      console.error('Error fetching Xero accounts:', error);
      throw new HttpException(`Failed to fetch accounts: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
