-- org_biofuel · copy this org's rows out of public (read) into org_biofuel (write). public is NOT modified.
-- Org matched by: name ILIKE 'Biofuel%' (preflight checks it matches exactly one org).

BEGIN;
INSERT INTO org_biofuel."Role" ("id", "name", "description", "allowedModules", "createdAt", "updatedAt", "organizationId")
  SELECT t."id", t."name", t."description", t."allowedModules", t."createdAt", t."updatedAt", t."organizationId"
  FROM public."Role" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."UserRole" ("id", "userId", "roleId", "createdAt", "organizationId", "assignedAt", "assignedBy", "expiresAt", "isActive")
  SELECT t."id", t."userId", t."roleId", t."createdAt", t."organizationId", t."assignedAt", t."assignedBy", t."expiresAt", t."isActive"
  FROM public."UserRole" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Permission" ("id", "name", "description", "resource", "action", "createdAt", "updatedAt")
  SELECT t."id", t."name", t."description", t."resource", t."action", t."createdAt", t."updatedAt"
  FROM public."Permission" t
  WHERE TRUE;

INSERT INTO org_biofuel."Customer" ("id", "customerCode", "name", "email", "phone", "address", "gstRegNo", "currency", "salesmanId", "xeroId", "xeroLastSyncAt", "createdAt", "updatedAt", "organizationId")
  SELECT t."id", t."customerCode", t."name", t."email", t."phone", t."address", t."gstRegNo", t."currency", t."salesmanId", t."xeroId", t."xeroLastSyncAt", t."createdAt", t."updatedAt", t."organizationId"
  FROM public."Customer" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Supplier" ("id", "supplierCode", "name", "email", "phone", "address", "gstRegNo", "currency", "xeroId", "xeroLastSyncAt", "createdAt", "updatedAt", "organizationId")
  SELECT t."id", t."supplierCode", t."name", t."email", t."phone", t."address", t."gstRegNo", t."currency", t."xeroId", t."xeroLastSyncAt", t."createdAt", t."updatedAt", t."organizationId"
  FROM public."Supplier" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."CustomField" ("id", "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", "required", "options", "defaultValue", "validation", "sortOrder", "isActive", "showInList", "showInForm", "groupName", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."entityType", t."fieldName", t."displayLabel", t."fieldType", t."required", t."options", t."defaultValue", t."validation", t."sortOrder", t."isActive", t."showInList", t."showInForm", t."groupName", t."createdAt", t."updatedAt"
  FROM public."CustomField" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."CustomFieldValue" ("id", "customFieldId", "entityId", "entityType", "value", "createdAt", "updatedAt")
  SELECT t."id", t."customFieldId", t."entityId", t."entityType", t."value", t."createdAt", t."updatedAt"
  FROM public."CustomFieldValue" t
  WHERE (EXISTS (SELECT 1 FROM public."CustomField" p00 WHERE p00.id = t."customFieldId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."UserDashboardLayout" ("id", "userId", "organizationId", "key", "layout", "createdAt", "updatedAt")
  SELECT t."id", t."userId", t."organizationId", t."key", t."layout", t."createdAt", t."updatedAt"
  FROM public."UserDashboardLayout" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Notification" ("id", "organizationId", "userId", "kind", "title", "body", "entityType", "entityId", "linkUrl", "readAt", "createdAt")
  SELECT t."id", t."organizationId", t."userId", t."kind", t."title", t."body", t."entityType", t."entityId", t."linkUrl", t."readAt", t."createdAt"
  FROM public."Notification" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."AuditLog" ("id", "userId", "userName", "userEmail", "action", "resource", "resourceId", "resourceName", "organizationId", "details", "ipAddress", "userAgent", "status", "errorMessage", "createdAt")
  SELECT t."id", t."userId", t."userName", t."userEmail", t."action", t."resource", t."resourceId", t."resourceName", t."organizationId", t."details", t."ipAddress", t."userAgent", t."status"::text::org_biofuel."AuditStatus", t."errorMessage", t."createdAt"
  FROM public."AuditLog" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."EmailIngestConfig" ("id", "organizationId", "enabled", "watchedSenders", "routingMode", "defaultDocType", "rules", "aiGuidance", "createMode", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."enabled", t."watchedSenders", t."routingMode", t."defaultDocType", t."rules", t."aiGuidance", t."createMode", t."createdAt", t."updatedAt"
  FROM public."EmailIngestConfig" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."EmailIngestLog" ("id", "organizationId", "messageId", "fromAddress", "subject", "status", "reason", "createdDocumentIds", "attachmentCount", "rawMeta", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."messageId", t."fromAddress", t."subject", t."status", t."reason", t."createdDocumentIds", t."attachmentCount", t."rawMeta", t."createdAt", t."updatedAt"
  FROM public."EmailIngestLog" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."ChartOfAccount" ("id", "organizationId", "code", "name", "description", "accountType", "category", "normalBalance", "isControlAccount", "isSystem", "isActive", "parentAccountId", "xeroId", "xeroLastSyncAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."description", t."accountType", t."category", t."normalBalance", t."isControlAccount", t."isSystem", t."isActive", t."parentAccountId", t."xeroId", t."xeroLastSyncAt", t."createdAt", t."updatedAt"
  FROM public."ChartOfAccount" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."JournalEntry" ("id", "organizationId", "journalNumber", "entryDate", "type", "status", "isUnconfirmed", "reference", "description", "totalDebit", "totalCredit", "currency", "sourceDocumentId", "sourcePaymentId", "postedAt", "postedBy", "voidedAt", "voidedBy", "reversesEntryId", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."journalNumber", t."entryDate", t."type", t."status", t."isUnconfirmed", t."reference", t."description", t."totalDebit", t."totalCredit", t."currency", t."sourceDocumentId", t."sourcePaymentId", t."postedAt", t."postedBy", t."voidedAt", t."voidedBy", t."reversesEntryId", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."JournalEntry" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."JournalEntryLine" ("id", "journalEntryId", "accountId", "lineNumber", "description", "debit", "credit", "foreignAmount", "exchangeRate", "costCenterId")
  SELECT t."id", t."journalEntryId", t."accountId", t."lineNumber", t."description", t."debit", t."credit", t."foreignAmount", t."exchangeRate", t."costCenterId"
  FROM public."JournalEntryLine" t
  WHERE (EXISTS (SELECT 1 FROM public."CostCenter" p00 WHERE p00.id = t."costCenterId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."JournalEntry" p01 WHERE p01.id = t."journalEntryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."ChartOfAccount" p02 WHERE p02.id = t."accountId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."AccountingSetting" ("id", "organizationId", "paymentDetails", "baseCurrency", "nextNumbers", "numberPrefixes", "activateLastSoldPrice", "activateLastBuyPrice", "yearOpeningDate", "yearOpeningStock", "monthOpeningDate", "monthOpeningStock", "monthClosingStock", "taxRegistrationNumber", "taxDefaultPercentage", "taxReference", "taxBasis", "taxPeriod", "salesTaxInclusive", "purchasesTaxInclusive", "fiscalYearEndDay", "fiscalYearEndMonth", "timeZone", "currencyRates", "accountCodeRanges", "controlAccounts", "billApprovalThreshold", "enablePerpetualInventory", "lockedThroughDate", "closeHistory", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."paymentDetails", t."baseCurrency", t."nextNumbers", t."numberPrefixes", t."activateLastSoldPrice", t."activateLastBuyPrice", t."yearOpeningDate", t."yearOpeningStock", t."monthOpeningDate", t."monthOpeningStock", t."monthClosingStock", t."taxRegistrationNumber", t."taxDefaultPercentage", t."taxReference", t."taxBasis", t."taxPeriod", t."salesTaxInclusive", t."purchasesTaxInclusive", t."fiscalYearEndDay", t."fiscalYearEndMonth", t."timeZone", t."currencyRates", t."accountCodeRanges", t."controlAccounts", t."billApprovalThreshold", t."enablePerpetualInventory", t."lockedThroughDate", t."closeHistory", t."createdAt", t."updatedAt"
  FROM public."AccountingSetting" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."TaxRate" ("id", "organizationId", "code", "name", "rate", "direction", "category", "isActive", "isSystem", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."rate", t."direction", t."category", t."isActive", t."isSystem", t."createdAt", t."updatedAt"
  FROM public."TaxRate" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."CostCenter" ("id", "organizationId", "code", "name", "description", "parentId", "isActive", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."description", t."parentId", t."isActive", t."createdAt", t."updatedAt"
  FROM public."CostCenter" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Budget" ("id", "organizationId", "accountId", "year", "month", "amount", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."accountId", t."year", t."month", t."amount", t."createdAt", t."updatedAt"
  FROM public."Budget" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."FixedAsset" ("id", "organizationId", "code", "name", "description", "category", "cost", "salvageValue", "inServiceDate", "method", "usefulLifeMonths", "decliningRate", "totalUnits", "unitsPerPeriod", "sourcePoId", "disposedAt", "disposalProceeds", "isActive", "depreciationProvisionAccountId", "depreciationExpenseAccountId", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."code", t."name", t."description", t."category", t."cost", t."salvageValue", t."inServiceDate", t."method", t."usefulLifeMonths", t."decliningRate", t."totalUnits", t."unitsPerPeriod", t."sourcePoId", t."disposedAt", t."disposalProceeds", t."isActive", t."depreciationProvisionAccountId", t."depreciationExpenseAccountId", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."FixedAsset" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."DepreciationEntry" ("id", "fixedAssetId", "organizationId", "periodYear", "periodMonth", "amount", "journalEntryId", "postedAt")
  SELECT t."id", t."fixedAssetId", t."organizationId", t."periodYear", t."periodMonth", t."amount", t."journalEntryId", t."postedAt"
  FROM public."DepreciationEntry" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."RecurringJournalTemplate" ("id", "organizationId", "name", "description", "reference", "frequency", "nextRunDate", "lastRunAt", "lastRunEntryId", "isActive", "lines", "endDate", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."name", t."description", t."reference", t."frequency", t."nextRunDate", t."lastRunAt", t."lastRunEntryId", t."isActive", t."lines", t."endDate", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."RecurringJournalTemplate" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."AccountMemory" ("id", "organizationId", "side", "text", "normalizedText", "accountCode", "accountId", "count", "embedding", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."side", t."text", t."normalizedText", t."accountCode", t."accountId", t."count", t."embedding", t."createdAt", t."updatedAt"
  FROM public."AccountMemory" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."BankStatementImport" ("id", "organizationId", "bankAccountId", "source", "filename", "periodStart", "periodEnd", "endingBalance", "columnMapping", "notes", "status", "error", "createdAt", "createdBy")
  SELECT t."id", t."organizationId", t."bankAccountId", t."source", t."filename", t."periodStart", t."periodEnd", t."endingBalance", t."columnMapping", t."notes", t."status", t."error", t."createdAt", t."createdBy"
  FROM public."BankStatementImport" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."BankStatementLine" ("id", "importId", "organizationId", "bankAccountId", "date", "description", "reference", "amount", "runningBalance", "status", "matchedJournalLineId", "matchedAt", "matchedBy", "postedJournalEntryId", "suggestedAccountId", "suggestionConfidence", "suggestionReason", "createdAt")
  SELECT t."id", t."importId", t."organizationId", t."bankAccountId", t."date", t."description", t."reference", t."amount", t."runningBalance", t."status", t."matchedJournalLineId", t."matchedAt", t."matchedBy", t."postedJournalEntryId", t."suggestedAccountId", t."suggestionConfidence", t."suggestionReason", t."createdAt"
  FROM public."BankStatementLine" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."BankStatementMatch" ("id", "organizationId", "lineId", "journalLineId", "createdAt", "createdBy")
  SELECT t."id", t."organizationId", t."lineId", t."journalLineId", t."createdAt", t."createdBy"
  FROM public."BankStatementMatch" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."XeroConnection" ("id", "organizationId", "tenantId", "accessToken", "refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."tenantId", t."accessToken", t."refreshToken", t."accessTokenExpiresAt", t."refreshTokenExpiresAt", t."createdAt", t."updatedAt"
  FROM public."XeroConnection" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."XeroAccountMapping" ("id", "organizationId", "aimsAccountId", "aimsAccountCode", "xeroAccountId", "xeroAccountCode", "xeroAccountName", "xeroAccountType", "source", "confidence", "reason", "confirmedAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."aimsAccountId", t."aimsAccountCode", t."xeroAccountId", t."xeroAccountCode", t."xeroAccountName", t."xeroAccountType", t."source", t."confidence", t."reason", t."confirmedAt", t."createdAt", t."updatedAt"
  FROM public."XeroAccountMapping" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."XeroSyncRun" ("id", "organizationId", "scope", "status", "counts", "errors", "startedAt", "finishedAt", "startedBy")
  SELECT t."id", t."organizationId", t."scope", t."status", t."counts", t."errors", t."startedAt", t."finishedAt", t."startedBy"
  FROM public."XeroSyncRun" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Asset" ("id", "name", "skuKey", "categoryId", "description", "image", "createdAt", "updatedAt", "deletedAt", "organizationId", "price", "costPrice", "customPrices", "salesAccountCode", "rentalAccountCode", "parentAssetId", "uom", "assetClass", "isTracked", "autoCreateOnParentUnit", "allowManualEntry", "isExternal", "quantity", "minQuantity", "nfcTagUid", "waterSgProductLine")
  SELECT t."id", t."name", t."skuKey", t."categoryId", t."description", t."image", t."createdAt", t."updatedAt", t."deletedAt", t."organizationId", t."price", t."costPrice", t."customPrices", t."salesAccountCode", t."rentalAccountCode", t."parentAssetId", t."uom", t."assetClass"::text::org_biofuel."AssetClass", t."isTracked", t."autoCreateOnParentUnit", t."allowManualEntry", t."isExternal", t."quantity", t."minQuantity", t."nfcTagUid", t."waterSgProductLine"
  FROM public."Asset" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Category" ("id", "name", "organizationId")
  SELECT t."id", t."name", t."organizationId"
  FROM public."Category" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Inventory" ("id", "assetId", "location", "category", "quantity", "sku", "serialNumber", "year", "cameraP2P", "simCardId", "nfcTagUid", "taggedLatitude", "taggedLongitude", "taggedLocationAccuracy", "taggedLocationAt", "createdAt", "updatedAt", "status", "organizationId", "parentInventoryId")
  SELECT t."id", t."assetId", t."location", t."category", t."quantity", t."sku", t."serialNumber", t."year", t."cameraP2P", t."simCardId", t."nfcTagUid", t."taggedLatitude", t."taggedLongitude", t."taggedLocationAccuracy", t."taggedLocationAt", t."createdAt", t."updatedAt", t."status"::text::org_biofuel."InventoryStatus", t."organizationId", t."parentInventoryId"
  FROM public."Inventory" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."QuantityAdjustment" ("id", "assetId", "previousQty", "newQty", "adjustmentType", "amount", "reason", "adjustedBy", "adjustedAt", "organizationId", "createdAt")
  SELECT t."id", t."assetId", t."previousQty", t."newQty", t."adjustmentType"::text::org_biofuel."AdjustmentType", t."amount", t."reason", t."adjustedBy", t."adjustedAt", t."organizationId", t."createdAt"
  FROM public."QuantityAdjustment" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Document" ("id", "createdAt", "updatedAt", "config", "documentTemplateId", "type", "organizationId", "name", "status", "baseDocumentId", "revisionNumber", "editingByUserId", "editingByName", "editingAt", "lastActivityAt", "version", "projectId", "projectDeploymentId", "attachments")
  SELECT t."id", t."createdAt", t."updatedAt", t."config", t."documentTemplateId", t."type", t."organizationId", t."name", t."status"::text::org_biofuel."DocumentStatus", t."baseDocumentId", t."revisionNumber", t."editingByUserId", t."editingByName", t."editingAt", t."lastActivityAt", t."version", t."projectId", t."projectDeploymentId", t."attachments"
  FROM public."Document" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."DocumentItem" ("id", "documentId", "itemId", "itemType", "sku", "description", "quantity", "unitPrice", "discount", "amount", "uom", "lineNumber", "isService", "isFixedAsset", "deliveryStatus", "deductedAt", "deliveringAt", "deliveredAt", "completedAt", "installSkipped", "inventoryId", "assetId", "createdAt", "updatedAt")
  SELECT t."id", t."documentId", t."itemId", t."itemType"::text::org_biofuel."ItemType", t."sku", t."description", t."quantity", t."unitPrice", t."discount", t."amount", t."uom", t."lineNumber", t."isService", t."isFixedAsset", t."deliveryStatus"::text::org_biofuel."DeliveryStatus", t."deductedAt", t."deliveringAt", t."deliveredAt", t."completedAt", t."installSkipped", t."inventoryId", t."assetId", t."createdAt", t."updatedAt"
  FROM public."DocumentItem" t
  WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."DocumentNumberFormat" ("id", "organizationId", "documentType", "label", "pattern", "nextSerial", "resetPolicy", "lastResetKey", "isActive", "sortOrder", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."documentType", t."label", t."pattern", t."nextSerial", t."resetPolicy", t."lastResetKey", t."isActive", t."sortOrder", t."createdAt", t."updatedAt"
  FROM public."DocumentNumberFormat" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."DocumentShareLink" ("id", "token", "documentId", "createdAt", "revokedAt")
  SELECT t."id", t."token", t."documentId", t."createdAt", t."revokedAt"
  FROM public."DocumentShareLink" t
  WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."DocumentSignLink" ("id", "token", "documentId", "createdAt", "expiresAt", "revokedAt", "signedAt", "signerName", "signerIp", "userAgent")
  SELECT t."id", t."token", t."documentId", t."createdAt", t."expiresAt", t."revokedAt", t."signedAt", t."signerName", t."signerIp", t."userAgent"
  FROM public."DocumentSignLink" t
  WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."DocumentEmbedding" ("id", "organizationId", "documentId", "type", "customerId", "textSnippet", "embedding", "updatedAt")
  SELECT t."id", t."organizationId", t."documentId", t."type", t."customerId", t."textSnippet", t."embedding", t."updatedAt"
  FROM public."DocumentEmbedding" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."SubmitJob" ("id", "organizationId", "createdByUserId", "batchId", "docType", "status", "s3Key", "fileUrl", "mimeType", "fileName", "documentId", "reason", "sequenceWarning", "attemptCount", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."createdByUserId", t."batchId", t."docType", t."status", t."s3Key", t."fileUrl", t."mimeType", t."fileName", t."documentId", t."reason", t."sequenceWarning", t."attemptCount", t."createdAt", t."updatedAt"
  FROM public."SubmitJob" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Order" ("id", "orderNumber", "organizationId", "customerId", "sourceQuotationId", "orderType", "status", "items", "linkedDocuments", "notes", "createdAt", "updatedAt")
  SELECT t."id", t."orderNumber", t."organizationId", t."customerId", t."sourceQuotationId", t."orderType", t."status", t."items", t."linkedDocuments", t."notes", t."createdAt", t."updatedAt"
  FROM public."Order" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."RevenueItem" ("id", "organizationId", "code", "name", "type", "unitPrice", "taxRate", "accountCode", "accountId", "isActive", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."type", t."unitPrice", t."taxRate", t."accountCode", t."accountId", t."isActive", t."createdAt", t."updatedAt"
  FROM public."RevenueItem" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."PriceHistory" ("id", "assetId", "unitPrice", "quantity", "uom", "totalAmount", "documentId", "documentNumber", "documentDate", "customerId", "customerName", "organizationId", "createdAt", "updatedAt")
  SELECT t."id", t."assetId", t."unitPrice", t."quantity", t."uom", t."totalAmount", t."documentId", t."documentNumber", t."documentDate", t."customerId", t."customerName", t."organizationId", t."createdAt", t."updatedAt"
  FROM public."PriceHistory" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."AssetTemplateTag" ("id", "assetId", "templateId", "createdAt")
  SELECT t."id", t."assetId", t."templateId", t."createdAt"
  FROM public."AssetTemplateTag" t
  WHERE (EXISTS (SELECT 1 FROM public."Asset" p00 WHERE p00.id = t."assetId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."TimelineItem" ("id", "message", "pdfUrl", "inventoryId", "documentId", "createdAt", "updatedAt")
  SELECT t."id", t."message", t."pdfUrl", t."inventoryId", t."documentId", t."createdAt", t."updatedAt"
  FROM public."TimelineItem" t
  WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."Inventory" p01 WHERE p01.id = t."inventoryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."Payment" ("id", "organizationId", "customerId", "documentId", "amount", "paymentDate", "paymentMethod", "reference", "notes", "receiptId", "attachments", "xeroId", "journalEntryId", "createdBy", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."customerId", t."documentId", t."amount", t."paymentDate", t."paymentMethod", t."reference", t."notes", t."receiptId", t."attachments", t."xeroId", t."journalEntryId", t."createdBy", t."createdAt", t."updatedAt"
  FROM public."Payment" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."BillPayment" ("id", "organizationId", "billId", "supplierId", "amount", "paymentDate", "paymentMethod", "reference", "notes", "bankAccountId", "journalEntryId", "xeroId", "attachments", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."billId", t."supplierId", t."amount", t."paymentDate", t."paymentMethod", t."reference", t."notes", t."bankAccountId", t."journalEntryId", t."xeroId", t."attachments", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."BillPayment" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."RecurringInvoiceTemplate" ("id", "organizationId", "code", "name", "customerId", "documentTemplateId", "numberFormatId", "config", "frequency", "nextRunDate", "endDate", "autoSend", "isActive", "lastRunAt", "lastRunDocumentId", "nextRunNo", "projectId", "projectDeploymentId", "sourceDocumentId", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."code", t."name", t."customerId", t."documentTemplateId", t."numberFormatId", t."config", t."frequency", t."nextRunDate", t."endDate", t."autoSend", t."isActive", t."lastRunAt", t."lastRunDocumentId", t."nextRunNo", t."projectId", t."projectDeploymentId", t."sourceDocumentId", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."RecurringInvoiceTemplate" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Project" ("id", "projectNumber", "name", "description", "address", "organizationId", "customerId", "customerPoNumber", "createdAt", "updatedAt", "startDate", "endDate", "status", "siteOfficeId")
  SELECT t."id", t."projectNumber", t."name", t."description", t."address", t."organizationId", t."customerId", t."customerPoNumber", t."createdAt", t."updatedAt", t."startDate", t."endDate", t."status"::text::org_biofuel."ProjectStatus", t."siteOfficeId"
  FROM public."Project" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."SiteOffice" ("id", "name", "address", "customerId", "createdAt", "updatedAt")
  SELECT t."id", t."name", t."address", t."customerId", t."createdAt", t."updatedAt"
  FROM public."SiteOffice" t
  WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."ContactDetail" ("id", "name", "email", "phone", "siteOfficeId", "createdAt", "updatedAt")
  SELECT t."id", t."name", t."email", t."phone", t."siteOfficeId", t."createdAt", t."updatedAt"
  FROM public."ContactDetail" t
  WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')))));

INSERT INTO org_biofuel."CustomerContact" ("id", "name", "phone", "email", "designation", "isPrimary", "customerId", "createdAt", "updatedAt")
  SELECT t."id", t."name", t."phone", t."email", t."designation", t."isPrimary", t."customerId", t."createdAt", t."updatedAt"
  FROM public."CustomerContact" t
  WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."ProjectContact" ("id", "projectId", "customerContactId", "group", "source", "createdAt")
  SELECT t."id", t."projectId", t."customerContactId", t."group", t."source", t."createdAt"
  FROM public."ProjectContact" t
  WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')))));

INSERT INTO org_biofuel."CustomerInfoRequest" ("id", "organizationId", "token", "customerId", "projectId", "customerName", "projectName", "createdBy", "createdAt", "expiresAt", "revokedAt", "submittedAt", "submissionCount", "acceptedAt", "acceptedBy", "poDocumentId", "poNumber")
  SELECT t."id", t."organizationId", t."token", t."customerId", t."projectId", t."customerName", t."projectName", t."createdBy", t."createdAt", t."expiresAt", t."revokedAt", t."submittedAt", t."submissionCount", t."acceptedAt", t."acceptedBy", t."poDocumentId", t."poNumber"
  FROM public."CustomerInfoRequest" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."CustomerInfoContact" ("id", "requestId", "group", "name", "email", "phone", "sortOrder", "createdAt", "supersededAt")
  SELECT t."id", t."requestId", t."group", t."name", t."email", t."phone", t."sortOrder", t."createdAt", t."supersededAt"
  FROM public."CustomerInfoContact" t
  WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."ProjectDeployment" ("id", "organizationId", "projectId", "deploymentNumber", "sourceDocumentId", "type", "description", "monthlyRate", "currency", "deployedDate", "offHiredDate", "status", "notes", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."projectId", t."deploymentNumber", t."sourceDocumentId", t."type"::text::org_biofuel."DeploymentType", t."description", t."monthlyRate", t."currency", t."deployedDate", t."offHiredDate", t."status"::text::org_biofuel."DeploymentStatus", t."notes", t."createdAt", t."updatedAt"
  FROM public."ProjectDeployment" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."Assignment" ("id", "projectId", "projectDeploymentId", "inventoryId", "assetId", "quantity", "description", "documentId", "startDate", "endDate", "createdAt")
  SELECT t."id", t."projectId", t."projectDeploymentId", t."inventoryId", t."assetId", t."quantity", t."description", t."documentId", t."startDate", t."endDate", t."createdAt"
  FROM public."Assignment" t
  WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."Delivery" ("id", "organizationId", "deliveryNumber", "direction", "status", "riderUserId", "riderName", "vehicleNumber", "handoffMode", "handedOffAt", "handedOffByUserId", "projectId", "customerId", "siteAddress", "notes", "scheduledFor", "isDraft", "documentId", "startedAt", "completedAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."deliveryNumber", t."direction"::text::org_biofuel."DeliveryDirection", t."status"::text::org_biofuel."DeliveryRunStatus", t."riderUserId", t."riderName", t."vehicleNumber", t."handoffMode", t."handedOffAt", t."handedOffByUserId", t."projectId", t."customerId", t."siteAddress", t."notes", t."scheduledFor", t."isDraft", t."documentId", t."startedAt", t."completedAt", t."createdAt", t."updatedAt"
  FROM public."Delivery" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."DeliveryItem" ("id", "deliveryId", "assetId", "inventoryId", "description", "quantity", "assetClass", "sortOrder", "deliveryStatus", "skippedAt", "deliveringAt", "deliveredAt", "completedAt", "installSkipped", "documentId")
  SELECT t."id", t."deliveryId", t."assetId", t."inventoryId", t."description", t."quantity", t."assetClass"::text::org_biofuel."AssetClass", t."sortOrder", t."deliveryStatus"::text::org_biofuel."DeliveryStatus", t."skippedAt", t."deliveringAt", t."deliveredAt", t."completedAt", t."installSkipped", t."documentId"
  FROM public."DeliveryItem" t
  WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."DeliveryShareLink" ("id", "token", "documentId", "deliveryId", "createdAt", "expiresAt", "revokedAt")
  SELECT t."id", t."token", t."documentId", t."deliveryId", t."createdAt", t."expiresAt", t."revokedAt"
  FROM public."DeliveryShareLink" t
  WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."MaintenanceServiceReport" ("id", "organizationId", "assetId", "inventoryId", "technicianUserId", "technicianName", "description", "photos", "signature", "signedByName", "signedAt", "status", "kind", "documentId", "latitude", "longitude", "locationLabel", "waterSgSiteId", "reportNumber", "serviceData", "damaged", "paymentRequired", "invoiceDocumentId", "deliveryId", "deliveryItemId", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."assetId", t."inventoryId", t."technicianUserId", t."technicianName", t."description", t."photos", t."signature", t."signedByName", t."signedAt", t."status"::text::org_biofuel."MaintenanceServiceReportStatus", t."kind"::text::org_biofuel."MaintenanceReportKind", t."documentId", t."latitude", t."longitude", t."locationLabel", t."waterSgSiteId", t."reportNumber", t."serviceData", t."damaged", t."paymentRequired", t."invoiceDocumentId", t."deliveryId", t."deliveryItemId", t."createdAt", t."updatedAt"
  FROM public."MaintenanceServiceReport" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."DeliveryLocationPing" ("id", "reportId", "latitude", "longitude", "accuracy", "speed", "heading", "timestamp", "createdAt")
  SELECT t."id", t."reportId", t."latitude", t."longitude", t."accuracy", t."speed", t."heading", t."timestamp", t."createdAt"
  FROM public."DeliveryLocationPing" t
  WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%')));

INSERT INTO org_biofuel."MaintenanceSchedule" ("id", "organizationId", "assetId", "dueDate", "notes", "createdByUserId", "createdAt", "remindedAt", "cancelledAt")
  SELECT t."id", t."organizationId", t."assetId", t."dueDate", t."notes", t."createdByUserId", t."createdAt", t."remindedAt", t."cancelledAt"
  FROM public."MaintenanceSchedule" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."WhatsAppMessage" ("id", "organizationId", "direction", "counterparty", "phoneNumberId", "waMessageId", "templateName", "body", "status", "error", "payload", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."direction", t."counterparty", t."phoneNumberId", t."waMessageId", t."templateName", t."body", t."status", t."error", t."payload", t."createdAt", t."updatedAt"
  FROM public."WhatsAppMessage" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."WhatsAppQnA" ("id", "organizationId", "question", "answer", "embedding", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."question", t."answer", t."embedding", t."createdAt", t."updatedAt"
  FROM public."WhatsAppQnA" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."WhatsAppAgentConfig" ("id", "organizationId", "enabled", "autoSendEnabled", "notifyNumber", "autoSendGuidance", "aiGuidance", "ownerNotifyNumber", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."enabled", t."autoSendEnabled", t."notifyNumber", t."autoSendGuidance", t."aiGuidance", t."ownerNotifyNumber", t."createdAt", t."updatedAt"
  FROM public."WhatsAppAgentConfig" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."WhatsAppSuggestion" ("id", "organizationId", "inboundMessageId", "counterparty", "inboundBody", "suggestedReply", "canAutoSend", "confidence", "reason", "status", "sentMessageId", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."inboundMessageId", t."counterparty", t."inboundBody", t."suggestedReply", t."canAutoSend", t."confidence", t."reason", t."status", t."sentMessageId", t."createdAt", t."updatedAt"
  FROM public."WhatsAppSuggestion" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."WhatsAppScheduledMessage" ("id", "organizationId", "to", "body", "scheduledAt", "status", "sentMessageId", "error", "createdBy", "recurrence", "recurEvery", "recurUntil", "recurCount", "recurAnchorDay", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."to", t."body", t."scheduledAt", t."status", t."sentMessageId", t."error", t."createdBy", t."recurrence", t."recurEvery", t."recurUntil", t."recurCount", t."recurAnchorDay", t."createdAt", t."updatedAt"
  FROM public."WhatsAppScheduledMessage" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."WhatsAppContact" ("id", "organizationId", "waId", "profileName", "appContactName", "lastMessageAt", "agentAutoReply", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."waId", t."profileName", t."appContactName", t."lastMessageAt", t."agentAutoReply", t."createdAt", t."updatedAt"
  FROM public."WhatsAppContact" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."WhatsAppAppointment" ("id", "organizationId", "groupId", "groupName", "startsAt", "timeText", "topic", "venue", "tentative", "clientName", "remindAt", "reminderStatus", "remindedAt", "error", "sourceMessage", "createdBy", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."groupId", t."groupName", t."startsAt", t."timeText", t."topic", t."venue", t."tentative", t."clientName", t."remindAt", t."reminderStatus", t."remindedAt", t."error", t."sourceMessage", t."createdBy", t."createdAt", t."updatedAt"
  FROM public."WhatsAppAppointment" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."AdAccountConnection" ("id", "organizationId", "adAccountId", "accessToken", "accountName", "currency", "status", "lastError", "lastSyncAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."adAccountId", t."accessToken", t."accountName", t."currency", t."status", t."lastError", t."lastSyncAt", t."createdAt", t."updatedAt"
  FROM public."AdAccountConnection" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

INSERT INTO org_biofuel."AdInsight" ("id", "organizationId", "date", "campaignId", "campaignName", "adsetId", "adsetName", "adId", "adName", "spend", "impressions", "clicks", "linkClicks", "metaLeads", "thruplays", "videoAvgSec", "videoP25", "videoP50", "videoP75", "videoP100", "raw", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."date", t."campaignId", t."campaignName", t."adsetId", t."adsetName", t."adId", t."adName", t."spend", t."impressions", t."clicks", t."linkClicks", t."metaLeads", t."thruplays", t."videoAvgSec", t."videoP25", t."videoP50", t."videoP75", t."videoP100", t."raw", t."createdAt", t."updatedAt"
  FROM public."AdInsight" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

-- Role ↔ Permission links for this org's roles (implicit Prisma join table)
INSERT INTO org_biofuel."_PermissionToRole" ("A", "B")
  SELECT j."A", j."B" FROM public."_PermissionToRole" j JOIN public."Role" r ON r.id = j."B"
  WHERE r."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%');

COMMIT;
