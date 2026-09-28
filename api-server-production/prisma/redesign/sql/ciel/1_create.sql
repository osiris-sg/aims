-- org_ciel · generated from orgs/ciel.prisma (DRY RUN). Unqualified names resolve to org_ciel via search_path.
-- Creates the schema, its enums, tables and indexes. No foreign keys yet (added after the copy).

BEGIN;
CREATE SCHEMA IF NOT EXISTS org_ciel;
SET LOCAL search_path TO org_ciel, public;

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('SUCCESS', 'FAILURE', 'PENDING');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('not_delivered', 'delivering', 'not_installed', 'completed');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('draft', 'unconfirmed', 'confirmed', 'pending_delivery', 'delivered_not_installed', 'delivered_installed', 'pending_payment', 'paid', 'pending_return', 'returned');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('INVENTORY', 'ASSET');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('pending', 'ongoing', 'completed');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowedModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "customerCode" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "gstRegNo" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "salesmanId" TEXT,
    "xeroId" TEXT,
    "xeroLastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "supplierCode" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "gstRegNo" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "xeroId" TEXT,
    "xeroLastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "defaultValue" TEXT,
    "validation" JSONB,
    "sortOrder" INTEGER DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showInList" BOOLEAN NOT NULL DEFAULT false,
    "showInForm" BOOLEAN NOT NULL DEFAULT true,
    "groupName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDashboardLayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'ops',
    "layout" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDashboardLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "linkUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceName" TEXT,
    "organizationId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "status" "AuditStatus" NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailIngestConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "watchedSenders" JSONB NOT NULL DEFAULT '[]',
    "routingMode" TEXT NOT NULL DEFAULT 'AI',
    "defaultDocType" TEXT,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "aiGuidance" TEXT,
    "createMode" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailIngestConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailIngestLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "createdDocumentIds" JSONB NOT NULL DEFAULT '[]',
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "rawMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailIngestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartOfAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "accountType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "normalBalance" TEXT NOT NULL,
    "isControlAccount" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentAccountId" TEXT,
    "xeroId" TEXT,
    "xeroLastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartOfAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journalNumber" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isUnconfirmed" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "description" TEXT,
    "totalDebit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "sourceDocumentId" TEXT,
    "sourcePaymentId" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "reversesEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntryLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "foreignAmount" DOUBLE PRECISION,
    "exchangeRate" DOUBLE PRECISION,
    "costCenterId" TEXT,

    CONSTRAINT "JournalEntryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentDetails" JSONB,
    "baseCurrency" TEXT NOT NULL DEFAULT 'SGD',
    "nextNumbers" JSONB,
    "numberPrefixes" JSONB,
    "activateLastSoldPrice" BOOLEAN NOT NULL DEFAULT true,
    "activateLastBuyPrice" BOOLEAN NOT NULL DEFAULT true,
    "yearOpeningDate" TIMESTAMP(3),
    "yearOpeningStock" DOUBLE PRECISION DEFAULT 0,
    "monthOpeningDate" TIMESTAMP(3),
    "monthOpeningStock" DOUBLE PRECISION DEFAULT 0,
    "monthClosingStock" DOUBLE PRECISION DEFAULT 0,
    "taxRegistrationNumber" TEXT,
    "taxDefaultPercentage" DOUBLE PRECISION DEFAULT 9,
    "taxReference" TEXT DEFAULT 'GST',
    "taxBasis" TEXT DEFAULT 'ACCRUAL',
    "taxPeriod" TEXT DEFAULT 'QUARTERLY',
    "salesTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "purchasesTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "fiscalYearEndDay" INTEGER DEFAULT 31,
    "fiscalYearEndMonth" INTEGER DEFAULT 12,
    "timeZone" TEXT DEFAULT 'Asia/Singapore',
    "currencyRates" JSONB,
    "accountCodeRanges" JSONB,
    "controlAccounts" JSONB,
    "billApprovalThreshold" DOUBLE PRECISION DEFAULT 5000,
    "enablePerpetualInventory" BOOLEAN NOT NULL DEFAULT false,
    "lockedThroughDate" TIMESTAMP(3),
    "closeHistory" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "cost" DOUBLE PRECISION NOT NULL,
    "salvageValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inServiceDate" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "usefulLifeMonths" INTEGER,
    "decliningRate" DOUBLE PRECISION,
    "totalUnits" DOUBLE PRECISION,
    "unitsPerPeriod" DOUBLE PRECISION,
    "sourcePoId" TEXT,
    "disposedAt" TIMESTAMP(3),
    "disposalProceeds" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "depreciationProvisionAccountId" TEXT,
    "depreciationExpenseAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepreciationEntry" (
    "id" TEXT NOT NULL,
    "fixedAssetId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "journalEntryId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepreciationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringJournalTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "frequency" TEXT NOT NULL,
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastRunEntryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lines" JSONB NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "RecurringJournalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMemory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "side" TEXT NOT NULL DEFAULT 'SALES',
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "embedding" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "filename" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "endingBalance" DOUBLE PRECISION,
    "columnMapping" JSONB,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "runningBalance" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "matchedJournalLineId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedBy" TEXT,
    "postedJournalEntryId" TEXT,
    "suggestedAccountId" TEXT,
    "suggestionConfidence" DOUBLE PRECISION,
    "suggestionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "journalLineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "BankStatementMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XeroConnection" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XeroConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XeroAccountMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "aimsAccountId" TEXT,
    "aimsAccountCode" TEXT NOT NULL,
    "xeroAccountId" TEXT NOT NULL,
    "xeroAccountCode" TEXT,
    "xeroAccountName" TEXT NOT NULL,
    "xeroAccountType" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XeroAccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XeroSyncRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "counts" JSONB,
    "errors" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "startedBy" TEXT,

    CONSTRAINT "XeroSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "config" JSONB NOT NULL,
    "documentTemplateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'unconfirmed',
    "baseDocumentId" UUID,
    "revisionNumber" INTEGER DEFAULT 0,
    "editingByUserId" TEXT,
    "editingByName" TEXT,
    "editingAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "projectId" UUID,
    "projectDeploymentId" UUID,
    "attachments" JSONB,
    "customerId" UUID,
    "supplierId" UUID,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLine" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PRODUCT',
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uom" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isFixedAsset" BOOLEAN NOT NULL DEFAULT false,
    "assetId" UUID,
    "inventoryId" UUID,
    "revenueItemId" TEXT,
    "accountId" TEXT,
    "taxRateId" TEXT,
    "costCenterId" TEXT,
    "sectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentItem" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION DEFAULT 0,
    "discount" DOUBLE PRECISION DEFAULT 0,
    "amount" DOUBLE PRECISION DEFAULT 0,
    "uom" TEXT,
    "lineNumber" INTEGER,
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "isFixedAsset" BOOLEAN NOT NULL DEFAULT false,
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'not_delivered',
    "deductedAt" TIMESTAMP(3),
    "deliveringAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "installSkipped" BOOLEAN NOT NULL DEFAULT false,
    "inventoryId" UUID,
    "assetId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentNumberFormat" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "nextSerial" INTEGER NOT NULL DEFAULT 1,
    "resetPolicy" TEXT NOT NULL DEFAULT 'never',
    "lastResetKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentNumberFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSignLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signerName" TEXT,
    "signerIp" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "DocumentSignLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentEmbedding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "customerId" TEXT,
    "textSnippet" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmitJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "s3Key" TEXT NOT NULL,
    "fileUrl" TEXT,
    "mimeType" TEXT,
    "fileName" TEXT,
    "documentId" UUID,
    "reason" TEXT,
    "sequenceWarning" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmitJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" UUID,
    "sourceQuotationId" UUID,
    "orderType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "items" JSONB NOT NULL,
    "linkedDocuments" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SERVICE',
    "unitPrice" DOUBLE PRECISION,
    "taxRate" DOUBLE PRECISION,
    "accountCode" TEXT NOT NULL,
    "accountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workSectionId" TEXT,
    "descriptionTemplate" TEXT,
    "includes" JSONB,
    "unitCost" DOUBLE PRECISION,
    "uom" TEXT,
    "pricingMode" TEXT NOT NULL DEFAULT 'priced',
    "supplierName" TEXT,

    CONSTRAINT "RevenueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "assetId" UUID NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "uom" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "documentId" UUID NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "customerId" UUID,
    "customerName" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetTemplateTag" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetTemplateTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineItem" (
    "id" UUID NOT NULL,
    "message" TEXT,
    "pdfUrl" TEXT,
    "inventoryId" UUID,
    "documentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "receiptId" UUID,
    "attachments" JSONB,
    "xeroId" TEXT,
    "journalEntryId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "bankAccountId" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "xeroId" TEXT,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringInvoiceTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "documentTemplateId" TEXT NOT NULL,
    "numberFormatId" TEXT,
    "config" JSONB NOT NULL,
    "frequency" TEXT NOT NULL,
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastRunDocumentId" TEXT,
    "nextRunNo" INTEGER NOT NULL DEFAULT 1,
    "projectId" TEXT,
    "projectDeploymentId" TEXT,
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "RecurringInvoiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "projectNumber" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "organizationId" TEXT,
    "customerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "ProjectStatus" NOT NULL DEFAULT 'pending',
    "designer" TEXT,
    "stage" TEXT,
    "commissionPct" DOUBLE PRECISION,
    "designerUserId" TEXT,
    "rebatePct" DOUBLE PRECISION,
    "source" TEXT,
    "leadId" UUID,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "ref" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "whatsappPhone" TEXT,
    "appointmentAt" TIMESTAMP(3),
    "appointmentNote" TEXT,
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "propertyType" TEXT,
    "propertyRooms" TEXT,
    "propertyStatus" TEXT,
    "keyCollection" TEXT,
    "keyCollectionDate" TIMESTAMP(3),
    "moveIn" TEXT,
    "budget" TEXT,
    "areas" TEXT,
    "designStyle" TEXT,
    "remarks" TEXT,
    "approachNotes" TEXT,
    "floorPlanUrl" TEXT,
    "attachmentUrl" TEXT,
    "attachmentKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unqualified',
    "deadProofUrl" TEXT,
    "deadProofKey" TEXT,
    "deadAt" TIMESTAMP(3),
    "assignedToUserId" TEXT,
    "assignedToName" TEXT,
    "assignedAt" TIMESTAMP(3),
    "firstContactedAt" TIMESTAMP(3),
    "firstContactDeadline" TIMESTAMP(3),
    "replacementDeadline" TIMESTAMP(3),
    "quotationId" UUID,
    "projectId" UUID,
    "emailFrom" TEXT,
    "emailSubject" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "kind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "date" TIMESTAMP(3),
    "supplierName" TEXT,
    "supplierId" TEXT,
    "description" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "sectionId" TEXT,
    "attachmentUrl" TEXT,
    "attachmentKey" TEXT,
    "source" TEXT NOT NULL DEFAULT 'portal',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "createdByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'milestone',
    "label" TEXT NOT NULL,
    "pct" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dueTrigger" TEXT,
    "invoiceId" UUID,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectQuestStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "paymentTag" TEXT,
    "requiresProof" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "completedByName" TEXT,
    "notes" TEXT,
    "proofUrl" TEXT,
    "proofKey" TEXT,
    "skipReason" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectQuestStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectScheduleItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'work',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'schedule',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestMediaRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "stepId" TEXT,
    "scheduleItemId" TEXT,
    "waNumber" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "mediaCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMediaAt" TIMESTAMP(3),

    CONSTRAINT "QuestMediaRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierRebate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "pct" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierRebate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leaderUserId" TEXT,
    "yearlyTarget" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "letter" TEXT,
    "title" TEXT NOT NULL,
    "defaultNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "phoneNumberId" TEXT,
    "waMessageId" TEXT,
    "templateName" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppQnA" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "embedding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppQnA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAgentConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoSendEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifyNumber" TEXT,
    "autoSendGuidance" TEXT,
    "aiGuidance" TEXT,
    "ownerNotifyNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "inboundBody" TEXT NOT NULL,
    "suggestedReply" TEXT NOT NULL,
    "canAutoSend" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppScheduledMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentMessageId" TEXT,
    "error" TEXT,
    "createdBy" TEXT,
    "recurrence" TEXT NOT NULL DEFAULT 'NONE',
    "recurEvery" INTEGER,
    "recurUntil" TIMESTAMP(3),
    "recurCount" INTEGER NOT NULL DEFAULT 0,
    "recurAnchorDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppScheduledMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "profileName" TEXT,
    "appContactName" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "agentAutoReply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAppointment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupName" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "timeText" TEXT,
    "topic" TEXT,
    "venue" TEXT,
    "tentative" BOOLEAN NOT NULL DEFAULT false,
    "clientName" TEXT,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "reminderStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "remindedAt" TIMESTAMP(3),
    "error" TEXT,
    "sourceMessage" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAccountConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "accountName" TEXT,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdAccountConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdInsight" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adsetId" TEXT,
    "adsetName" TEXT,
    "adId" TEXT NOT NULL,
    "adName" TEXT,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "linkClicks" INTEGER NOT NULL DEFAULT 0,
    "metaLeads" INTEGER NOT NULL DEFAULT 0,
    "thruplays" INTEGER NOT NULL DEFAULT 0,
    "videoAvgSec" DOUBLE PRECISION,
    "videoP25" INTEGER NOT NULL DEFAULT 0,
    "videoP50" INTEGER NOT NULL DEFAULT 0,
    "videoP75" INTEGER NOT NULL DEFAULT 0,
    "videoP100" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PermissionToRole" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PermissionToRole_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_organizationId_key" ON "Role"("name", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_organizationId_key" ON "UserRole"("userId", "roleId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_xeroId_key" ON "Customer"("xeroId");

-- CreateIndex
CREATE INDEX "Customer_salesmanId_idx" ON "Customer"("salesmanId");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_organizationId_key" ON "Customer"("email", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_organizationId_key" ON "Customer"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerCode_organizationId_key" ON "Customer"("customerCode", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_xeroId_key" ON "Supplier"("xeroId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_email_organizationId_key" ON "Supplier"("email", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_organizationId_key" ON "Supplier"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_supplierCode_organizationId_key" ON "Supplier"("supplierCode", "organizationId");

-- CreateIndex
CREATE INDEX "CustomField_organizationId_entityType_idx" ON "CustomField"("organizationId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_organizationId_entityType_fieldName_key" ON "CustomField"("organizationId", "entityType", "fieldName");

-- CreateIndex
CREATE INDEX "CustomFieldValue_entityId_entityType_idx" ON "CustomFieldValue"("entityId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_customFieldId_entityId_key" ON "CustomFieldValue"("customFieldId", "entityId");

-- CreateIndex
CREATE INDEX "UserDashboardLayout_organizationId_key_idx" ON "UserDashboardLayout"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "UserDashboardLayout_userId_organizationId_key_key" ON "UserDashboardLayout"("userId", "organizationId", "key");

-- CreateIndex
CREATE INDEX "Notification_userId_organizationId_readAt_idx" ON "Notification"("userId", "organizationId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_kind_entityId_key" ON "Notification"("userId", "kind", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_resource_idx" ON "AuditLog"("resource");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resource_createdAt_idx" ON "AuditLog"("resource", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_action_createdAt_idx" ON "AuditLog"("organizationId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_action_createdAt_idx" ON "AuditLog"("userId", "action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailIngestConfig_organizationId_key" ON "EmailIngestConfig"("organizationId");

-- CreateIndex
CREATE INDEX "EmailIngestLog_organizationId_createdAt_idx" ON "EmailIngestLog"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailIngestLog_organizationId_messageId_key" ON "EmailIngestLog"("organizationId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccount_xeroId_key" ON "ChartOfAccount"("xeroId");

-- CreateIndex
CREATE INDEX "ChartOfAccount_organizationId_accountType_idx" ON "ChartOfAccount"("organizationId", "accountType");

-- CreateIndex
CREATE INDEX "ChartOfAccount_organizationId_category_idx" ON "ChartOfAccount"("organizationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccount_organizationId_code_key" ON "ChartOfAccount"("organizationId", "code");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_entryDate_idx" ON "JournalEntry"("organizationId", "entryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_status_idx" ON "JournalEntry"("organizationId", "status");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_type_idx" ON "JournalEntry"("organizationId", "type");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceDocumentId_idx" ON "JournalEntry"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "JournalEntry_sourcePaymentId_idx" ON "JournalEntry"("sourcePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_organizationId_journalNumber_key" ON "JournalEntry"("organizationId", "journalNumber");

-- CreateIndex
CREATE INDEX "JournalEntryLine_journalEntryId_idx" ON "JournalEntryLine"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalEntryLine_accountId_idx" ON "JournalEntryLine"("accountId");

-- CreateIndex
CREATE INDEX "JournalEntryLine_costCenterId_idx" ON "JournalEntryLine"("costCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingSetting_organizationId_key" ON "AccountingSetting"("organizationId");

-- CreateIndex
CREATE INDEX "TaxRate_organizationId_isActive_idx" ON "TaxRate"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "CostCenter_organizationId_isActive_idx" ON "CostCenter"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "Budget_organizationId_year_idx" ON "Budget"("organizationId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_accountId_year_month_key" ON "Budget"("accountId", "year", "month");

-- CreateIndex
CREATE INDEX "FixedAsset_organizationId_isActive_idx" ON "FixedAsset"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "DepreciationEntry_organizationId_periodYear_periodMonth_idx" ON "DepreciationEntry"("organizationId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationEntry_fixedAssetId_periodYear_periodMonth_key" ON "DepreciationEntry"("fixedAssetId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "RecurringJournalTemplate_organizationId_isActive_idx" ON "RecurringJournalTemplate"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "RecurringJournalTemplate_organizationId_nextRunDate_idx" ON "RecurringJournalTemplate"("organizationId", "nextRunDate");

-- CreateIndex
CREATE INDEX "AccountMemory_organizationId_side_idx" ON "AccountMemory"("organizationId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMemory_organizationId_side_normalizedText_key" ON "AccountMemory"("organizationId", "side", "normalizedText");

-- CreateIndex
CREATE INDEX "BankStatementImport_organizationId_bankAccountId_idx" ON "BankStatementImport"("organizationId", "bankAccountId");

-- CreateIndex
CREATE INDEX "BankStatementLine_importId_idx" ON "BankStatementLine"("importId");

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_bankAccountId_status_idx" ON "BankStatementLine"("organizationId", "bankAccountId", "status");

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_date_idx" ON "BankStatementLine"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementMatch_journalLineId_key" ON "BankStatementMatch"("journalLineId");

-- CreateIndex
CREATE INDEX "BankStatementMatch_organizationId_idx" ON "BankStatementMatch"("organizationId");

-- CreateIndex
CREATE INDEX "BankStatementMatch_lineId_idx" ON "BankStatementMatch"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "XeroConnection_organizationId_key" ON "XeroConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "XeroConnection_tenantId_key" ON "XeroConnection"("tenantId");

-- CreateIndex
CREATE INDEX "XeroAccountMapping_organizationId_aimsAccountId_idx" ON "XeroAccountMapping"("organizationId", "aimsAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "XeroAccountMapping_organizationId_xeroAccountId_key" ON "XeroAccountMapping"("organizationId", "xeroAccountId");

-- CreateIndex
CREATE INDEX "XeroSyncRun_organizationId_startedAt_idx" ON "XeroSyncRun"("organizationId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "Document_baseDocumentId_idx" ON "Document"("baseDocumentId");

-- CreateIndex
CREATE INDEX "Document_organizationId_type_idx" ON "Document"("organizationId", "type");

-- CreateIndex
CREATE INDEX "Document_organizationId_status_idx" ON "Document"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Document_projectId_idx" ON "Document"("projectId");

-- CreateIndex
CREATE INDEX "Document_projectDeploymentId_idx" ON "Document"("projectDeploymentId");

-- CreateIndex
CREATE INDEX "Document_name_idx" ON "Document" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Document_name_organizationId_documentTemplateId_key" ON "Document"("name", "organizationId", "documentTemplateId");

-- CreateIndex
CREATE INDEX "DocumentLine_assetId_idx" ON "DocumentLine"("assetId");

-- CreateIndex
CREATE INDEX "DocumentLine_accountId_idx" ON "DocumentLine"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLine_documentId_lineNumber_key" ON "DocumentLine"("documentId", "lineNumber");

-- CreateIndex
CREATE INDEX "DocumentItem_itemId_idx" ON "DocumentItem"("itemId");

-- CreateIndex
CREATE INDEX "DocumentItem_documentId_idx" ON "DocumentItem"("documentId");

-- CreateIndex
CREATE INDEX "DocumentItem_itemId_itemType_idx" ON "DocumentItem"("itemId", "itemType");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentItem_documentId_itemId_lineNumber_key" ON "DocumentItem"("documentId", "itemId", "lineNumber");

-- CreateIndex
CREATE INDEX "DocumentNumberFormat_organizationId_documentType_idx" ON "DocumentNumberFormat"("organizationId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentShareLink_token_key" ON "DocumentShareLink"("token");

-- CreateIndex
CREATE INDEX "DocumentShareLink_documentId_idx" ON "DocumentShareLink"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSignLink_token_key" ON "DocumentSignLink"("token");

-- CreateIndex
CREATE INDEX "DocumentSignLink_documentId_idx" ON "DocumentSignLink"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentEmbedding_documentId_key" ON "DocumentEmbedding"("documentId");

-- CreateIndex
CREATE INDEX "DocumentEmbedding_organizationId_type_idx" ON "DocumentEmbedding"("organizationId", "type");

-- CreateIndex
CREATE INDEX "DocumentEmbedding_organizationId_customerId_idx" ON "DocumentEmbedding"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "SubmitJob_organizationId_createdByUserId_createdAt_idx" ON "SubmitJob"("organizationId", "createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SubmitJob_status_idx" ON "SubmitJob"("status");

-- CreateIndex
CREATE INDEX "SubmitJob_organizationId_createdAt_idx" ON "SubmitJob"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_organizationId_status_idx" ON "Order"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_sourceQuotationId_idx" ON "Order"("sourceQuotationId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_organizationId_key" ON "Order"("orderNumber", "organizationId");

-- CreateIndex
CREATE INDEX "RevenueItem_organizationId_isActive_idx" ON "RevenueItem"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "RevenueItem_organizationId_type_idx" ON "RevenueItem"("organizationId", "type");

-- CreateIndex
CREATE INDEX "RevenueItem_organizationId_workSectionId_idx" ON "RevenueItem"("organizationId", "workSectionId");

-- CreateIndex
CREATE INDEX "PriceHistory_assetId_organizationId_idx" ON "PriceHistory"("assetId", "organizationId");

-- CreateIndex
CREATE INDEX "PriceHistory_customerId_organizationId_idx" ON "PriceHistory"("customerId", "organizationId");

-- CreateIndex
CREATE INDEX "PriceHistory_documentDate_idx" ON "PriceHistory"("documentDate");

-- CreateIndex
CREATE INDEX "PriceHistory_createdAt_idx" ON "PriceHistory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetTemplateTag_assetId_templateId_key" ON "AssetTemplateTag"("assetId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_xeroId_key" ON "Payment"("xeroId");

-- CreateIndex
CREATE INDEX "Payment_customerId_organizationId_idx" ON "Payment"("customerId", "organizationId");

-- CreateIndex
CREATE INDEX "Payment_documentId_idx" ON "Payment"("documentId");

-- CreateIndex
CREATE INDEX "Payment_receiptId_idx" ON "Payment"("receiptId");

-- CreateIndex
CREATE INDEX "Payment_paymentDate_idx" ON "Payment"("paymentDate");

-- CreateIndex
CREATE INDEX "Payment_organizationId_paymentDate_idx" ON "Payment"("organizationId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "BillPayment_xeroId_key" ON "BillPayment"("xeroId");

-- CreateIndex
CREATE INDEX "BillPayment_organizationId_paymentDate_idx" ON "BillPayment"("organizationId", "paymentDate");

-- CreateIndex
CREATE INDEX "BillPayment_billId_idx" ON "BillPayment"("billId");

-- CreateIndex
CREATE INDEX "BillPayment_supplierId_idx" ON "BillPayment"("supplierId");

-- CreateIndex
CREATE INDEX "RecurringInvoiceTemplate_organizationId_isActive_idx" ON "RecurringInvoiceTemplate"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "RecurringInvoiceTemplate_organizationId_nextRunDate_idx" ON "RecurringInvoiceTemplate"("organizationId", "nextRunDate");

-- CreateIndex
CREATE INDEX "RecurringInvoiceTemplate_projectDeploymentId_idx" ON "RecurringInvoiceTemplate"("projectDeploymentId");

-- CreateIndex
CREATE INDEX "Project_organizationId_status_idx" ON "Project"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Project_customerId_idx" ON "Project"("customerId");

-- CreateIndex
CREATE INDEX "Project_name_idx" ON "Project" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectNumber_organizationId_key" ON "Project"("projectNumber", "organizationId");

-- CreateIndex
CREATE INDEX "Lead_organizationId_status_idx" ON "Lead"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Lead_organizationId_assignedToUserId_idx" ON "Lead"("organizationId", "assignedToUserId");

-- CreateIndex
CREATE INDEX "Lead_organizationId_receivedAt_idx" ON "Lead"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "LeadAttachment_organizationId_leadId_idx" ON "LeadAttachment"("organizationId", "leadId");

-- CreateIndex
CREATE INDEX "ProjectCost_organizationId_projectId_idx" ON "ProjectCost"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectCost_projectId_status_idx" ON "ProjectCost"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectMilestone_organizationId_projectId_idx" ON "ProjectMilestone"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectQuestStep_organizationId_projectId_idx" ON "ProjectQuestStep"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectQuestStep_projectId_stepNo_key" ON "ProjectQuestStep"("projectId", "stepNo");

-- CreateIndex
CREATE INDEX "ProjectScheduleItem_organizationId_projectId_idx" ON "ProjectScheduleItem"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectScheduleItem_projectId_startDate_idx" ON "ProjectScheduleItem"("projectId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectShareLink_token_key" ON "ProjectShareLink"("token");

-- CreateIndex
CREATE INDEX "ProjectShareLink_projectId_idx" ON "ProjectShareLink"("projectId");

-- CreateIndex
CREATE INDEX "QuestMediaRequest_organizationId_waNumber_status_idx" ON "QuestMediaRequest"("organizationId", "waNumber", "status");

-- CreateIndex
CREATE INDEX "QuestMediaRequest_projectId_idx" ON "QuestMediaRequest"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierRebate_organizationId_supplierName_key" ON "SupplierRebate"("organizationId", "supplierName");

-- CreateIndex
CREATE INDEX "Team_organizationId_idx" ON "Team"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_organizationId_name_key" ON "Team"("organizationId", "name");

-- CreateIndex
CREATE INDEX "WorkSection_organizationId_sortOrder_idx" ON "WorkSection"("organizationId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSection_organizationId_title_key" ON "WorkSection"("organizationId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_waMessageId_key" ON "WhatsAppMessage"("waMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_organizationId_createdAt_idx" ON "WhatsAppMessage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppQnA_organizationId_idx" ON "WhatsAppQnA"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAgentConfig_organizationId_key" ON "WhatsAppAgentConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSuggestion_inboundMessageId_key" ON "WhatsAppSuggestion"("inboundMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppSuggestion_organizationId_status_createdAt_idx" ON "WhatsAppSuggestion"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppScheduledMessage_status_scheduledAt_idx" ON "WhatsAppScheduledMessage"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "WhatsAppScheduledMessage_organizationId_scheduledAt_idx" ON "WhatsAppScheduledMessage"("organizationId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppContact_organizationId_waId_key" ON "WhatsAppContact"("organizationId", "waId");

-- CreateIndex
CREATE INDEX "WhatsAppAppointment_organizationId_groupId_idx" ON "WhatsAppAppointment"("organizationId", "groupId");

-- CreateIndex
CREATE INDEX "WhatsAppAppointment_reminderStatus_remindAt_idx" ON "WhatsAppAppointment"("reminderStatus", "remindAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdAccountConnection_organizationId_key" ON "AdAccountConnection"("organizationId");

-- CreateIndex
CREATE INDEX "AdInsight_organizationId_date_idx" ON "AdInsight"("organizationId", "date");

-- CreateIndex
CREATE INDEX "AdInsight_organizationId_campaignId_idx" ON "AdInsight"("organizationId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "AdInsight_organizationId_date_adId_key" ON "AdInsight"("organizationId", "date", "adId");

-- CreateIndex
CREATE INDEX "_PermissionToRole_B_index" ON "_PermissionToRole"("B");

COMMIT;
