# Xero Invoice Integration

This document explains how to set up and use the Xero integration for automatic invoice creation.

## Overview

When you create or update a TI (Invoice) document in your system with a status other than "draft", it will automatically create a corresponding invoice in Xero.

## Setup Steps

### 1. Create a Xero Developer App

1. Go to [Xero Developer Portal](https://developer.xero.com/app/manage)
2. Create a new app
3. Get your **Client ID** and **Client Secret**
4. Set the redirect URI to: `http://your-domain.com/xero/callback`

### 2. Environment Variables

Add these environment variables to your `.env` file:

```bash
# Xero API Configuration
XERO_CLIENT_ID=your_xero_client_id_here
XERO_CLIENT_SECRET=your_xero_client_secret_here
XERO_REDIRECT_URI=http://localhost:40400/xero/callback
XERO_SCOPES=accounting.transactions accounting.contacts accounting.settings
```

### 3. Connect Xero Account

1. Visit: `http://your-api-url/xero/connect`
2. Authorize your Xero organization
3. You'll be redirected back with success/error status

## How It Works

### Automatic Invoice Creation

When you:

- Create a new TI document with status ≠ "draft"
- Update an existing TI document to status ≠ "draft"

The system will automatically:

1. Create a contact in Xero (if it doesn't exist)
2. Create an invoice with line items from your document
3. Log the success/failure (continues even if Xero fails)

### Invoice Data Mapping

| Your System         | Xero Invoice     |
| ------------------- | ---------------- |
| Customer name       | Contact name     |
| Customer email      | Contact email    |
| Document items      | Line items       |
| Item description    | Line description |
| Item quantity       | Line quantity    |
| Asset price         | Unit amount      |
| Reference/PO number | Reference        |
| Due date            | Due date         |

### API Endpoints

- `GET /xero/connect` - Start OAuth flow
- `GET /xero/callback` - OAuth callback (automatically called)
- `GET /xero/status` - Check connection status

## Development Notes

### Current Limitations

1. **Tenant ID Storage**: Currently returns null - you need to implement storage of tenant IDs per organization
2. **Token Management**: OAuth tokens need to be stored and refreshed
3. **Error Handling**: Xero failures don't stop document creation (by design)

### Next Steps for Full Implementation

1. **Add Database Fields**:

   ```sql
   ALTER TABLE organizations ADD COLUMN xero_tenant_id VARCHAR(255);
   ALTER TABLE organizations ADD COLUMN xero_access_token TEXT;
   ALTER TABLE organizations ADD COLUMN xero_refresh_token TEXT;
   ALTER TABLE organizations ADD COLUMN xero_token_expires_at TIMESTAMP;
   ```

2. **Store Xero Invoice ID**:

   ```sql
   ALTER TABLE documents ADD COLUMN xero_invoice_id VARCHAR(255);
   ```

3. **Implement Token Storage**: Update `getTenantId()` method to retrieve stored tenant ID

4. **Add Frontend Integration**: Create settings page for Xero connection

## Testing

### Test Invoice Creation

1. Create a TI document
2. Add items and customer
3. Submit with status "submitted" or other non-draft status
4. Check console logs for Xero creation attempts

### Troubleshooting

- Check that environment variables are set correctly
- Verify Xero app redirect URI matches your configuration
- Check API logs for detailed error messages
- Ensure customer exists before creating invoice

## Security Notes

- Store Xero credentials securely
- Use HTTPS in production
- Implement proper error handling
- Consider rate limiting for Xero API calls

## API Documentation

For detailed Xero API documentation, visit:
https://developer.xero.com/documentation/api/accounting/invoices
