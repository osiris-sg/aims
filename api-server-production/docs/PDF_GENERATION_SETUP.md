# PDF Generation and S3 Upload Setup

This document explains how to set up the PDF generation and S3 upload feature for document management.

## Features

- Generate professional PDF documents from the document preview
- Upload PDFs to Amazon S3 for secure storage
- Generate signed URLs for secure PDF access
- Support for all document types (Invoices, Quotations, Delivery Orders, etc.)

## Prerequisites

1. AWS Account with S3 access
2. Node.js environment with Puppeteer installed
3. Configured environment variables

## AWS S3 Setup

### 1. Create S3 Bucket

1. Log in to AWS Console
2. Navigate to S3
3. Create a new bucket (e.g., `aims-documents`)
4. Choose your preferred region (e.g., `ap-southeast-1`)
5. Keep default settings or customize as needed

### 2. Configure Bucket Policy

Add the following CORS configuration to your S3 bucket:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
        "AllowedOrigins": ["http://localhost:3000", "https://yourdomain.com"],
        "ExposeHeaders": ["ETag"]
    }
]
```

### 3. Create IAM User

1. Go to IAM in AWS Console
2. Create a new user with programmatic access
3. Attach the following policy:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:GetObjectVersion"
            ],
            "Resource": "arn:aws:s3:::aims-documents/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": "arn:aws:s3:::aims-documents"
        }
    ]
}
```

4. Save the Access Key ID and Secret Access Key

## Environment Configuration

Add the following to your `.env` file:

```env
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET=aims-documents
```

## Usage

### From the Frontend

1. Navigate to any document edit page
2. Click the "Preview" button to see the document layout
3. Click "Print / PDF" button
4. Wait for the PDF to generate
5. Click "Open PDF" to view/download the document

### API Endpoint

```typescript
POST /documents/generate-pdf

Body:
{
  "documentType": "TI", // or "QO1", "DO", "RDO", "MSR"
  "documentId": "doc_123",
  "data": {
    // Document data including customer, items, etc.
  }
}

Response:
{
  "success": true,
  "url": "https://signed-s3-url.com/...",
  "key": "documents/org_id/TI/doc_123_2024-01-01.pdf",
  "message": "PDF generated and uploaded successfully"
}
```

## File Structure

Generated PDFs are stored in S3 with the following structure:
```
documents/
├── {organizationId}/
│   ├── TI/
│   │   ├── invoice_001_2024-01-01.pdf
│   │   └── invoice_002_2024-01-02.pdf
│   ├── QO1/
│   │   └── quotation_001_2024-01-01.pdf
│   └── DO/
│       └── delivery_001_2024-01-01.pdf
```

## Troubleshooting

### Puppeteer Issues

If you encounter Puppeteer errors on deployment:

1. Ensure all dependencies are installed:
```bash
npm install puppeteer
```

2. For Docker deployments, add required dependencies:
```dockerfile
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox
```

3. Set Puppeteer environment variables:
```env
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### S3 Access Issues

1. Verify IAM permissions are correct
2. Check if bucket name matches environment variable
3. Ensure CORS is properly configured
4. Verify AWS credentials are valid

## Security Notes

- Generated URLs are signed and expire after 1 hour
- PDFs are stored with organization-based folder structure for isolation
- Access is controlled through backend authentication
- Never expose AWS credentials in frontend code

## Future Enhancements

- Add PDF caching to reduce regeneration
- Implement batch PDF generation
- Add email delivery option
- Support for custom templates per organization