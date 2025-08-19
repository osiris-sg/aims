import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XeroClient } from 'xero-node';
import { PrismaService } from './prisma.service';

@Injectable()
export class XeroService {
  private xeroClient: XeroClient;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.xeroClient = new XeroClient({
      clientId: this.configService.get('XERO.CLIENT_ID'),
      clientSecret: this.configService.get('XERO.CLIENT_SECRET'),
      redirectUris: [this.configService.get('XERO.REDIRECT_URI')],
      scopes: this.configService.get('XERO.SCOPES').split(' '),
    });
  }

  /**
   * Create an invoice in Xero
   * Based on: https://developer.xero.com/documentation/api/accounting/invoices
   */
  async createInvoice(
    organizationId: string,
    invoiceData: {
      contactName: string;
      contactEmail?: string;
      reference?: string;
      invoiceNumber?: string;
      dueDate?: string;
      lineItems: Array<{
        description: string;
        quantity: number;
        unitAmount: number;
        accountCode?: string;
        taxType?: string;
      }>;
      status?: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED';
    },
  ) {
    try {
      console.log('🔧 XERO SERVICE: Starting createInvoice with data:', {
        contactName: invoiceData.contactName,
        lineItems: invoiceData.lineItems.length + ' items',
      });

      // Get tenant ID (organization) - you'll need to store this after OAuth
      const tenantId = await this.getTenantId(organizationId);

      if (!tenantId) {
        console.error('🔴 XERO SERVICE: No tenant ID available - OAuth not completed');
        throw new HttpException('Xero tenant not connected - Please complete OAuth setup first', HttpStatus.BAD_REQUEST);
      }

      console.log('✅ XERO SERVICE: Tenant ID found:', tenantId);

      // Create contact if it doesn't exist
      console.log('🔍 XERO SERVICE: Getting/creating contact for:', invoiceData.contactName);
      const contact = await this.getOrCreateContact(tenantId, invoiceData.contactName, invoiceData.contactEmail);
      console.log('✅ XERO SERVICE: Contact ready - ID:', contact.contactID);

      // Prepare invoice object according to Xero API format
      const invoice = {
        type: 'ACCREC' as any, // Accounts Receivable (Sales Invoice) - type assertion for enum
        contact: {
          contactID: contact.contactID,
        },
        date: new Date().toISOString().split('T')[0], // Current date in YYYY-MM-DD format
        dueDate: invoiceData.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now if not specified
        reference: invoiceData.reference || '',
        invoiceNumber: invoiceData.invoiceNumber || undefined, // Let Xero auto-generate if not provided
        status: (invoiceData.status || 'DRAFT') as any, // Type assertion for enum
        lineItems: invoiceData.lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitAmount: item.unitAmount,
          accountCode: item.accountCode || '200', // Default to Sales account
          taxType: (item.taxType || 'NONE') as any, // Type assertion for enum
        })),
      };

      // Create the invoice in Xero
      console.log('🚀 XERO SERVICE: Calling Xero API createInvoices...');
      const response = await this.xeroClient.accountingApi.createInvoices(tenantId, {
        invoices: [invoice as any], // Type assertion to handle Xero API types
      });

      console.log('🎉 XERO SERVICE: Xero API call successful!');
      console.log('📋 XERO SERVICE: Created invoice details:', {
        invoiceID: response.body.invoices[0]?.invoiceID,
        invoiceNumber: response.body.invoices[0]?.invoiceNumber,
        status: response.body.invoices[0]?.status,
        total: response.body.invoices[0]?.total,
      });

      return response.body.invoices[0];
    } catch (error) {
      console.error('💥 XERO SERVICE: API call failed');
      console.error('💥 XERO SERVICE: Error type:', error.constructor?.name || 'Unknown');
      console.error('💥 XERO SERVICE: Error message:', error.message || 'No message available');
      console.error('💥 XERO SERVICE: Full error object:', JSON.stringify(error, null, 2));

      if (error.response) {
        console.error('💥 XERO SERVICE: HTTP Status:', error.response.status);
        console.error('💥 XERO SERVICE: Response data:', JSON.stringify(error.response.data, null, 2));
      }

      // Handle different error types
      let errorMessage = 'Unknown error occurred';
      if (error.message) {
        errorMessage = error.message;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.statusText) {
        errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      throw new HttpException(`Failed to create Xero invoice: ${errorMessage}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Update an existing invoice in Xero
   */
  async updateInvoice(
    organizationId: string,
    xeroInvoiceId: string,
    invoiceData: {
      contactName: string;
      contactEmail?: string;
      reference?: string;
      invoiceNumber?: string;
      dueDate?: string;
      lineItems: Array<{
        description: string;
        quantity: number;
        unitAmount: number;
        accountCode?: string;
        taxType?: string;
      }>;
      status?: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED';
    },
  ) {
    try {
      console.log('🔧 XERO SERVICE: Starting updateInvoice for Xero Invoice ID:', xeroInvoiceId);
      console.log('🔧 XERO SERVICE: Update data:', {
        contactName: invoiceData.contactName,
        lineItems: invoiceData.lineItems.length + ' items',
      });

      // Get tenant ID
      const tenantId = await this.getTenantId(organizationId);
      if (!tenantId) {
        console.error('🔴 XERO SERVICE: No tenant ID available - OAuth not completed');
        throw new HttpException('Xero tenant not connected - Please complete OAuth setup first', HttpStatus.BAD_REQUEST);
      }

      // Create contact if it doesn't exist
      console.log('🔍 XERO SERVICE: Getting/creating contact for:', invoiceData.contactName);
      const contact = await this.getOrCreateContact(tenantId, invoiceData.contactName, invoiceData.contactEmail);

      // Prepare updated invoice object
      const invoice = {
        invoiceID: xeroInvoiceId,
        type: 'ACCREC' as any,
        contact: {
          contactID: contact.contactID,
        },
        date: new Date().toISOString().split('T')[0],
        dueDate: invoiceData.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        reference: invoiceData.reference || '',
        invoiceNumber: invoiceData.invoiceNumber || undefined,
        status: (invoiceData.status || 'DRAFT') as any,
        lineItems: invoiceData.lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitAmount: item.unitAmount,
          accountCode: item.accountCode || '200',
          taxType: (item.taxType || 'NONE') as any,
        })),
      };

      console.log('📤 XERO SERVICE: Updating invoice with:', {
        invoiceID: xeroInvoiceId,
        contactName: invoiceData.contactName,
        lineItemsCount: invoice.lineItems.length,
      });

      // Update the invoice in Xero
      const response = await this.xeroClient.accountingApi.updateInvoice(tenantId, xeroInvoiceId, { invoices: [invoice] });

      console.log('✅ XERO SERVICE: Invoice updated successfully!', {
        invoiceID: response.body.invoices[0]?.invoiceID,
        invoiceNumber: response.body.invoices[0]?.invoiceNumber,
        status: response.body.invoices[0]?.status,
        total: response.body.invoices[0]?.total,
      });

      return response.body.invoices[0];
    } catch (error) {
      console.error('💥 XERO SERVICE: Update API call failed');
      console.error('💥 XERO SERVICE: Error type:', error.constructor?.name || 'Unknown');
      console.error('💥 XERO SERVICE: Error message:', error.message || 'No message available');
      console.error('💥 XERO SERVICE: Full error object:', JSON.stringify(error, null, 2));

      if (error.response) {
        console.error('💥 XERO SERVICE: HTTP Status:', error.response.status);
        console.error('💥 XERO SERVICE: Response data:', JSON.stringify(error.response.data, null, 2));
      }

      // Handle different error types
      let errorMessage = 'Unknown error occurred';
      if (error.message) {
        errorMessage = error.message;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.statusText) {
        errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      throw new HttpException(`Failed to update Xero invoice: ${errorMessage}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Check if an invoice exists in Xero by ID
   */
  async invoiceExists(organizationId: string, xeroInvoiceId: string): Promise<boolean> {
    try {
      console.log('🔍 XERO SERVICE: Checking if invoice exists:', xeroInvoiceId);

      const tenantId = await this.getTenantId(organizationId);
      if (!tenantId) {
        console.log('🔴 XERO SERVICE: No tenant ID available for invoice existence check');
        return false;
      }

      // Try to get the invoice from Xero
      const response = await this.xeroClient.accountingApi.getInvoice(tenantId, xeroInvoiceId);

      if (response.body?.invoices && response.body.invoices.length > 0) {
        console.log('✅ XERO SERVICE: Invoice exists in Xero:', xeroInvoiceId);
        return true;
      } else {
        console.log('❌ XERO SERVICE: Invoice not found in Xero:', xeroInvoiceId);
        return false;
      }
    } catch (error) {
      console.log('❌ XERO SERVICE: Invoice does not exist or error checking:', xeroInvoiceId, error.message);
      return false;
    }
  }

  /**
   * Find an invoice in Xero by invoice number
   */
  async findInvoiceByNumber(organizationId: string, invoiceNumber: string): Promise<any | null> {
    try {
      console.log('🔍 XERO SERVICE: Searching for invoice by number:', invoiceNumber);

      const tenantId = await this.getTenantId(organizationId);
      if (!tenantId) {
        console.log('🔴 XERO SERVICE: No tenant ID available for invoice search');
        return null;
      }

      // Search for invoices with the specific invoice number
      const response = await this.xeroClient.accountingApi.getInvoices(
        tenantId,
        undefined, // ifModifiedSince
        `InvoiceNumber="${invoiceNumber}"`, // where clause
        undefined, // order
        undefined, // ids
        undefined, // invoiceNumbers
        undefined, // contactIDs
        undefined, // statuses
        1, // page - limit to 1 result since invoice numbers should be unique
      );

      if (response.body?.invoices && response.body.invoices.length > 0) {
        const invoice = response.body.invoices[0];
        console.log(`✅ XERO SERVICE: Found invoice with number ${invoiceNumber}, ID:`, invoice.invoiceID);
        return invoice;
      } else {
        console.log(`❌ XERO SERVICE: No invoice found with number:`, invoiceNumber);
        return null;
      }
    } catch (error) {
      console.error(`💥 XERO SERVICE: Error searching for invoice by number ${invoiceNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Get detailed connection status for monitoring
   */
  async getConnectionStatus(organizationId: string) {
    const tokenInfo = await this.loadTokensFromDatabase(organizationId);

    if (!tokenInfo) {
      return {
        connected: false,
        message: 'No Xero connection found. Please authenticate first.',
        authUrl: '/xero/connect',
      };
    }

    const now = new Date();
    const accessTokenMinutesLeft = Math.floor((tokenInfo.expiresAt.getTime() - now.getTime()) / (60 * 1000));
    const refreshTokenDaysLeft = Math.floor((tokenInfo.refreshTokenExpiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const tokenAge = Math.floor((now.getTime() - tokenInfo.createdAt.getTime()) / (24 * 60 * 60 * 1000));

    // Check if refresh token has expired
    if (tokenInfo.refreshTokenExpiresAt <= now) {
      return {
        connected: false,
        message: 'Xero refresh token has expired. Re-authentication required.',
        authUrl: '/xero/connect',
        details: {
          refreshTokenExpired: true,
          expiredAt: tokenInfo.refreshTokenExpiresAt.toISOString(),
        },
      };
    }

    // Check if access token has expired
    const accessTokenExpired = tokenInfo.expiresAt <= now;

    return {
      connected: true,
      tenantId: tokenInfo.tenantId,
      accessToken: {
        expired: accessTokenExpired,
        expiresAt: tokenInfo.expiresAt.toISOString(),
        minutesLeft: accessTokenMinutesLeft,
      },
      refreshToken: {
        expiresAt: tokenInfo.refreshTokenExpiresAt.toISOString(),
        daysLeft: refreshTokenDaysLeft,
        warningThreshold: refreshTokenDaysLeft <= 7,
      },
      tokenAge: {
        days: tokenAge,
        createdAt: tokenInfo.createdAt.toISOString(),
      },
      message: accessTokenExpired
        ? 'Access token expired but refresh token is valid. Will auto-refresh on next API call.'
        : refreshTokenDaysLeft <= 7
          ? `Connection healthy. Refresh token expires in ${refreshTokenDaysLeft} days - consider re-authenticating soon.`
          : 'Connection healthy and tokens are valid.',
    };
  }

  /**
   * Get or create a contact in Xero
   */
  private async getOrCreateContact(tenantId: string, contactName: string, contactEmail?: string) {
    try {
      // First, try to find existing contact
      const existingContacts = await this.xeroClient.accountingApi.getContacts(tenantId, undefined, `Name="${contactName}"`);

      if (existingContacts.body.contacts && existingContacts.body.contacts.length > 0) {
        console.log('✅ XERO SERVICE: Found existing contact:', existingContacts.body.contacts[0].name);
        return existingContacts.body.contacts[0];
      }

      // Create new contact if not found
      console.log('🔧 XERO SERVICE: Creating new contact:', contactName);
      const newContact = {
        name: contactName,
        emailAddress: contactEmail || '',
        contactStatus: 'ACTIVE' as any, // Type assertion for enum
      };

      const response = await this.xeroClient.accountingApi.createContacts(tenantId, {
        contacts: [newContact as any], // Type assertion to handle Xero API types
      });

      console.log('✅ XERO SERVICE: Created new contact:', response.body.contacts[0].name);

      return response.body.contacts[0];
    } catch (error) {
      console.error('Error managing Xero contact:', error);
      throw new HttpException(`Failed to manage Xero contact: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Database-backed token storage methods
  private async loadTokensFromDatabase(organizationId: string) {
    try {
      const xeroConnection = await this.prisma.xeroConnection.findUnique({
        where: { organizationId },
      });

      if (!xeroConnection) {
        console.log('🔍 XERO SERVICE: No Xero connection found in database for organization:', organizationId);
        return null;
      }

      console.log('✅ XERO SERVICE: Loaded Xero tokens from database for organization:', organizationId);
      console.log('✅ XERO SERVICE: Access token expires:', xeroConnection.accessTokenExpiresAt.toISOString());
      console.log('✅ XERO SERVICE: Refresh token expires:', xeroConnection.refreshTokenExpiresAt.toISOString());

      return {
        tenantId: xeroConnection.tenantId,
        accessToken: xeroConnection.accessToken,
        refreshToken: xeroConnection.refreshToken,
        expiresAt: xeroConnection.accessTokenExpiresAt,
        refreshTokenExpiresAt: xeroConnection.refreshTokenExpiresAt,
        createdAt: xeroConnection.createdAt,
      };
    } catch (error) {
      console.error('💥 XERO SERVICE: Error loading tokens from database:', error.message);
      return null;
    }
  }

  private async saveTokensToDatabase(
    organizationId: string,
    tokenData: {
      tenantId: string;
      accessToken: string;
      refreshToken: string;
      expiresAt: Date;
      refreshTokenExpiresAt: Date;
    },
  ) {
    try {
      const xeroConnection = await this.prisma.xeroConnection.upsert({
        where: { organizationId },
        create: {
          organizationId,
          tenantId: tokenData.tenantId,
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          accessTokenExpiresAt: tokenData.expiresAt,
          refreshTokenExpiresAt: tokenData.refreshTokenExpiresAt,
        },
        update: {
          tenantId: tokenData.tenantId,
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          accessTokenExpiresAt: tokenData.expiresAt,
          refreshTokenExpiresAt: tokenData.refreshTokenExpiresAt,
        },
      });

      console.log('💾 XERO SERVICE: Tokens saved to database successfully');
      console.log('💾 XERO SERVICE: Access token expires:', tokenData.expiresAt.toISOString());
      console.log('💾 XERO SERVICE: Refresh token expires:', tokenData.refreshTokenExpiresAt.toISOString());

      return xeroConnection;
    } catch (error) {
      console.error('💥 XERO SERVICE: Error saving tokens to database:', error.message);
      throw error;
    }
  }

  /**
   * Get tenant ID from database for the given organization
   */
  async getTenantId(organizationId: string): Promise<string | null> {
    try {
      // Load tokens from database
      const tokenInfo = await this.loadTokensFromDatabase(organizationId);

      if (!tokenInfo) {
        console.warn('🔴 XERO SERVICE: No Xero connection found for organization:', organizationId);
        return null;
      }

      const now = new Date();
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
      const minutesUntilExpiry = Math.floor((tokenInfo.expiresAt.getTime() - now.getTime()) / (60 * 1000));
      const daysUntilRefreshExpiry = Math.floor((tokenInfo.refreshTokenExpiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const tokenAge = Math.floor((now.getTime() - tokenInfo.createdAt.getTime()) / (24 * 60 * 60 * 1000));

      console.log('🔍 XERO SERVICE: Token status check for organization:', organizationId);
      console.log('  - Current time:', now.toISOString());
      console.log('  - Access token expires at:', tokenInfo.expiresAt.toISOString());
      console.log('  - Minutes until access token expiry:', minutesUntilExpiry);
      console.log('  - Refresh token expires at:', tokenInfo.refreshTokenExpiresAt.toISOString());
      console.log('  - Days until refresh token expiry:', daysUntilRefreshExpiry);
      console.log('  - Token age (days):', tokenAge);
      console.log('  - Refresh token present:', !!tokenInfo.refreshToken);

      // Check if refresh token itself has expired (60 days)
      if (tokenInfo.refreshTokenExpiresAt <= now) {
        console.error('💥 XERO SERVICE: Refresh token has expired after 60 days! Re-authentication required.');
        console.error('💥 XERO SERVICE: Expired at:', tokenInfo.refreshTokenExpiresAt.toISOString());
        console.error('💥 XERO SERVICE: Current time:', now.toISOString());
        console.error('💥 XERO SERVICE: Please visit /xero/connect to re-authenticate with Xero');

        // Delete expired connection from database
        await this.prisma.xeroConnection.delete({
          where: { organizationId },
        });
        console.log('🗑️ XERO SERVICE: Deleted XeroConnection for organization:', organizationId, 'due to refresh token expiry');

        return null;
      }

      // Warn if refresh token expires soon (within 7 days)
      if (daysUntilRefreshExpiry <= 7) {
        console.warn('⚠️ XERO SERVICE: Refresh token expires in', daysUntilRefreshExpiry, 'days! Consider re-authenticating soon.');
      }

      // Check if access token is expired or will expire in next 5 minutes
      if (tokenInfo.expiresAt <= fiveMinutesFromNow) {
        console.log('🔄 XERO SERVICE: Access token expired or expiring soon, attempting refresh...');
        console.log('🔄 XERO SERVICE: Refresh token length:', tokenInfo.refreshToken?.length || 0);

        if (tokenInfo.refreshToken) {
          try {
            await this.refreshAccessToken(organizationId, tokenInfo);
            console.log('✅ XERO SERVICE: Token refreshed successfully');

            // Reload updated tokens from database
            const updatedTokenInfo = await this.loadTokensFromDatabase(organizationId);
            if (updatedTokenInfo) {
              tokenInfo.accessToken = updatedTokenInfo.accessToken;
              tokenInfo.expiresAt = updatedTokenInfo.expiresAt;
              console.log('✅ XERO SERVICE: New expiry time:', tokenInfo.expiresAt.toISOString());
            }
          } catch (refreshError) {
            console.error('🔴 XERO SERVICE: Token refresh failed:', refreshError);
            console.error('🔴 XERO SERVICE: Refresh error details:', refreshError.message);

            // Only delete connection if it's a permanent error (401/403), not temporary network issues
            const isTemporaryError =
              refreshError.message?.includes('ENOTFOUND') || refreshError.message?.includes('ECONNRESET') || refreshError.message?.includes('timeout') || refreshError.message?.includes('network');

            if (isTemporaryError) {
              console.warn('⚠️ XERO SERVICE: Temporary network error - keeping connection for retry later');
              return null;
            }

            // Check if it's a 401/403 error (invalid refresh token)
            const isAuthError =
              refreshError.message?.includes('401') || refreshError.message?.includes('403') || refreshError.message?.includes('invalid_grant') || refreshError.message?.includes('unauthorized');

            if (isAuthError) {
              console.warn('🔴 XERO SERVICE: Authentication error - deleting invalid tokens');
              await this.prisma.xeroConnection.delete({
                where: { organizationId },
              });
              console.log('🗑️ XERO SERVICE: Deleted XeroConnection for organization:', organizationId, 'due to auth error');
            } else {
              console.warn('⚠️ XERO SERVICE: Unknown refresh error - keeping connection for manual review');
            }

            return null;
          }
        } else {
          console.warn('🔴 XERO SERVICE: No refresh token available - OAuth re-authorization required');

          // Delete connection without refresh token
          await this.prisma.xeroConnection.delete({
            where: { organizationId },
          });
          console.log('🗑️ XERO SERVICE: Deleted XeroConnection for organization:', organizationId, 'due to missing refresh token');

          return null;
        }
      } else {
        console.log('✅ XERO SERVICE: Access token still valid for', minutesUntilExpiry, 'minutes');
      }

      console.log('✅ XERO SERVICE: Using tenant ID:', tokenInfo.tenantId);

      // Set the token in the client for API calls
      await this.xeroClient.setTokenSet({
        access_token: tokenInfo.accessToken,
        refresh_token: tokenInfo.refreshToken,
        expires_in: Math.floor((tokenInfo.expiresAt.getTime() - Date.now()) / 1000),
      });

      return tokenInfo.tenantId;
    } catch (error) {
      console.error('💥 XERO SERVICE: Error getting tenant ID:', error);
      return null;
    }
  }

  /**
   * Initialize OAuth flow for connecting to Xero
   * This should be called when setting up Xero integration for an organization
   */
  async getAuthorizationUrl(organizationId?: string): Promise<string> {
    try {
      // Include organizationId in the state parameter for OAuth callback
      const state = organizationId || 'no-org';

      // The xero-node SDK doesn't support custom state in buildConsentUrl directly
      // We need to build the URL manually or use the SDK and append the state
      const baseAuthUrl = await this.xeroClient.buildConsentUrl();

      // Append the state parameter to the URL
      const url = new URL(baseAuthUrl);
      url.searchParams.set('state', state);

      const authUrl = url.toString();
      console.log('🔗 XERO SERVICE: Authorization URL generated with state:', state);
      return authUrl;
    } catch (error) {
      console.error('Error building Xero authorization URL:', error);
      throw new HttpException(`Failed to build authorization URL: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Handle OAuth callback and store tenant information
   * This should be called after user authorizes your app in Xero
   */
  async handleOAuthCallback(code: string, state: string, organizationId: string) {
    try {
      console.log('🔧 XERO SERVICE: Handling OAuth callback with code:', code ? 'present' : 'missing');
      console.log('🔧 XERO SERVICE: Full callback URL params - code length:', code?.length, 'state:', state);

      // Set the access token from the callback
      console.log('🔧 XERO SERVICE: Calling apiCallback...');

      // Create a new XeroClient instance for this callback to avoid state issues
      const callbackClient = new XeroClient({
        clientId: this.configService.get('XERO.CLIENT_ID'),
        clientSecret: this.configService.get('XERO.CLIENT_SECRET'),
        redirectUris: [this.configService.get('XERO.REDIRECT_URI')],
        scopes: this.configService.get('XERO.SCOPES').split(' '),
      });

      let tokenSet;
      try {
        console.log('🔧 XERO SERVICE: Attempting callback with fresh client...');
        tokenSet = await callbackClient.apiCallback(code);
        console.log('✅ XERO SERVICE: Fresh client callback successful');
      } catch (freshClientError) {
        console.log('🔧 XERO SERVICE: Fresh client failed, trying original client...');
        try {
          // Fallback to original client
          tokenSet = await this.xeroClient.apiCallback(code);
          console.log('✅ XERO SERVICE: Original client callback successful');
        } catch (originalClientError) {
          console.error('🔴 XERO SERVICE: Both clients failed');
          console.error('🔴 XERO SERVICE: Fresh client error:', freshClientError.message);
          console.error('🔴 XERO SERVICE: Original client error:', originalClientError.message);

          // Let's try to bypass the SDK issue for now and manually exchange the token
          console.log('🔧 XERO SERVICE: Attempting manual token exchange...');

          try {
            // Manual token exchange using HTTP request
            const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: `Basic ${Buffer.from(`${this.configService.get('XERO.CLIENT_ID')}:${this.configService.get('XERO.CLIENT_SECRET')}`).toString('base64')}`,
              },
              body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: this.configService.get('XERO.REDIRECT_URI'),
              }),
            });

            if (!tokenResponse.ok) {
              const errorText = await tokenResponse.text();
              console.error('🔴 XERO SERVICE: Manual token exchange failed:', tokenResponse.status, errorText);
              throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
            }

            const manualTokenSet = await tokenResponse.json();
            console.log('✅ XERO SERVICE: Manual token exchange successful');
            console.log('🔧 XERO SERVICE: Manual token set keys:', Object.keys(manualTokenSet));

            // Use the manually obtained token
            tokenSet = manualTokenSet;
          } catch (manualError) {
            console.error('🔴 XERO SERVICE: Manual token exchange also failed:', manualError.message);

            // Return debug info
            return {
              success: false,
              message: 'Both SDK and manual OAuth token exchange failed',
              debug: {
                codeReceived: !!code,
                codeLength: code?.length,
                freshClientError: freshClientError.message,
                originalClientError: originalClientError.message,
                manualError: manualError.message,
              },
            };
          }
        }
      }

      // Debug: log the full tokenSet structure
      console.log('🔧 XERO SERVICE: Raw token set:', JSON.stringify(tokenSet, null, 2));
      console.log('🔧 XERO SERVICE: Token set keys:', Object.keys(tokenSet || {}));

      // Check if tokenSet has the expected structure
      if (!tokenSet) {
        throw new Error('No token set received from Xero');
      }

      console.log('🔧 XERO SERVICE: Token set received:', {
        hasAccessToken: !!tokenSet.access_token,
        hasRefreshToken: !!tokenSet.refresh_token,
        expiresIn: tokenSet.expires_in,
        tokenType: tokenSet.token_type,
      });

      // Check if we have an access token
      if (!tokenSet || !tokenSet.access_token) {
        console.error('🔴 XERO SERVICE: No access_token in tokenSet');
        console.log('🔧 XERO SERVICE: Attempting to create a mock successful response for testing...');

        // For testing purposes, let's create a mock response
        return {
          success: false,
          message: 'OAuth callback received but token parsing failed',
          debug: {
            codeReceived: !!code,
            tokenSetType: typeof tokenSet,
            tokenSetKeys: tokenSet ? Object.keys(tokenSet) : [],
          },
        };
      }

      // Try setting the token in the client
      console.log('🔧 XERO SERVICE: Setting token in client...');
      try {
        await this.xeroClient.setTokenSet(tokenSet);
        console.log('✅ XERO SERVICE: Token set successfully in client');
      } catch (setTokenError) {
        console.error('🔴 XERO SERVICE: Error setting token:', setTokenError);
        // Continue anyway - maybe we can still get tenants
      }

      // Get tenant connections
      console.log('🔧 XERO SERVICE: Getting tenant connections...');
      const tenants = await this.xeroClient.updateTenants();
      console.log('🔧 XERO SERVICE: Tenants found:', tenants.length);

      // Store the first tenant in database
      if (tenants.length > 0) {
        const firstTenant = tenants[0];
        const now = new Date();

        await this.saveTokensToDatabase(organizationId, {
          tenantId: firstTenant.tenantId,
          accessToken: tokenSet.access_token,
          refreshToken: tokenSet.refresh_token || '', // Store empty string if no refresh token (shouldn't happen with offline_access)
          expiresAt: new Date(Date.now() + (tokenSet.expires_in || 3600) * 1000),
          refreshTokenExpiresAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
        });

        console.log('💾 XERO SERVICE: Stored tokens in database for organization:', organizationId);
        console.log('💾 XERO SERVICE: Refresh token available:', !!tokenSet.refresh_token);
      }

      // Return tenant information to store in your database
      const result = {
        accessToken: tokenSet.access_token,
        refreshToken: tokenSet.refresh_token,
        expiresAt: new Date(Date.now() + (tokenSet.expires_in || 3600) * 1000),
        tenants: tenants.map((tenant) => ({
          tenantId: tenant.tenantId,
          tenantName: tenant.tenantName,
          tenantType: tenant.tenantType,
        })),
      };

      console.log('✅ XERO SERVICE: OAuth callback completed successfully');
      console.log('✅ XERO SERVICE: Stored tenant info for:', tenants.length > 0 ? tenants[0].tenantName : 'no tenants');
      return result;
    } catch (error) {
      console.error('💥 XERO SERVICE: OAuth callback failed:', error);
      console.error('💥 XERO SERVICE: Error details:', error.message);
      throw new HttpException(`Failed to handle OAuth callback: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Refresh access token when it expires
   */
  async refreshToken() {
    try {
      const newTokenSet = await this.xeroClient.refreshToken();

      return {
        accessToken: newTokenSet.access_token,
        refreshToken: newTokenSet.refresh_token,
        expiresAt: new Date(Date.now() + newTokenSet.expires_in * 1000),
      };
    } catch (error) {
      console.error('Error refreshing Xero token:', error);
      throw new HttpException(`Failed to refresh token: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Internal method to refresh access token and update stored credentials
   */
  private async refreshAccessToken(organizationId: string, tokenInfo: any): Promise<void> {
    try {
      console.log('🔄 XERO SERVICE: Refreshing access token...');
      console.log('🔄 XERO SERVICE: Using refresh token starting with:', tokenInfo.refreshToken?.substring(0, 10) + '...');

      // Manual token refresh using HTTP request (more reliable than SDK)
      const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.configService.get('XERO.CLIENT_ID')}:${this.configService.get('XERO.CLIENT_SECRET')}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenInfo.refreshToken,
        }),
      });

      console.log('🔄 XERO SERVICE: Refresh response status:', tokenResponse.status);

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('🔴 XERO SERVICE: Refresh response error:', errorText);

        // Check for specific error types
        if (tokenResponse.status === 400) {
          console.error('🔴 XERO SERVICE: Bad request - likely invalid refresh token');
        } else if (tokenResponse.status === 401) {
          console.error('🔴 XERO SERVICE: Unauthorized - refresh token may be expired');
        }

        throw new Error(`Token refresh failed: ${tokenResponse.status} ${errorText}`);
      }

      const newTokenSet = await tokenResponse.json();
      console.log('✅ XERO SERVICE: Token refresh successful');
      console.log('✅ XERO SERVICE: New access token length:', newTokenSet.access_token?.length || 0);
      console.log('✅ XERO SERVICE: New refresh token provided:', !!newTokenSet.refresh_token);
      console.log('✅ XERO SERVICE: Token expires in:', newTokenSet.expires_in || 'unknown', 'seconds');

      const oldRefreshToken = tokenInfo.refreshToken;
      const newExpiryTime = new Date(Date.now() + (newTokenSet.expires_in || 1800) * 1000);

      // Update tokens in database
      await this.saveTokensToDatabase(organizationId, {
        tenantId: tokenInfo.tenantId,
        accessToken: newTokenSet.access_token,
        refreshToken: newTokenSet.refresh_token || oldRefreshToken, // Use new refresh token if provided, otherwise keep old one
        expiresAt: newExpiryTime,
        refreshTokenExpiresAt: tokenInfo.refreshTokenExpiresAt, // Keep existing refresh token expiry
      });

      console.log('💾 XERO SERVICE: Updated token information saved to database');
      console.log('💾 XERO SERVICE: Next expiry:', newExpiryTime.toISOString());

      // Log if refresh token changed
      if (newTokenSet.refresh_token && newTokenSet.refresh_token !== oldRefreshToken) {
        console.log('🔄 XERO SERVICE: Refresh token was rotated (new token provided)');
      } else {
        console.log('🔄 XERO SERVICE: Refresh token unchanged');
      }
    } catch (error) {
      console.error('💥 XERO SERVICE: Token refresh failed:', error);
      console.error('💥 XERO SERVICE: Error type:', error.constructor.name);
      console.error('💥 XERO SERVICE: Error message:', error.message);
      throw error;
    }
  }

  async getAccounts(organizationId: string): Promise<any[]> {
    console.log('📊 XERO SERVICE: Fetching accounts from Xero...');

    const tenantId = await this.getTenantId(organizationId);
    if (!tenantId) {
      throw new Error('Xero not connected - please authorize first');
    }

    try {
      const response = await this.xeroClient.accountingApi.getAccounts(tenantId);
      const accounts = response.body.accounts || [];

      console.log(`✅ XERO SERVICE: Retrieved ${accounts.length} accounts`);
      console.log('📊 XERO SERVICE: Account types found:', [...new Set(accounts.map((acc) => acc.type))]);

      // Return accounts formatted for dropdown use
      return accounts.map((account) => ({
        accountID: account.accountID,
        code: account.code,
        name: account.name,
        type: account.type,
        status: account.status,
        description: account.description,
        // Combine code and name for display
        displayName: account.code ? `${account.code} - ${account.name}` : account.name,
      }));
    } catch (error) {
      console.error('🔴 XERO SERVICE: Error fetching accounts:', error);
      throw error;
    }
  }
}
