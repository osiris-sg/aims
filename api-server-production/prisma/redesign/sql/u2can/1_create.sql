-- org_u2can · generated from orgs/u2can.prisma (DRY RUN). Unqualified names resolve to org_u2can via search_path.
-- Creates the schema, its enums, tables and indexes. No foreign keys yet (added after the copy).

BEGIN;
CREATE SCHEMA IF NOT EXISTS org_u2can;
SET LOCAL search_path TO org_u2can, public;

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('SUCCESS', 'FAILURE', 'PENDING');

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
CREATE INDEX "_PermissionToRole_B_index" ON "_PermissionToRole"("B");

COMMIT;
