-- org_adhjapan · copy this org's rows out of public (read) into org_adhjapan (write). public is NOT modified.
-- Org matched by: name ILIKE 'Asia Deal Hub%' (preflight checks it matches exactly one org).

BEGIN;
-- DocumentLine: new in the org schema, nothing to copy from public.
INSERT INTO org_adhjapan."Role" ("id", "name", "description", "allowedModules", "createdAt", "updatedAt", "organizationId")
  SELECT t."id", t."name", t."description", t."allowedModules", t."createdAt", t."updatedAt", t."organizationId"
  FROM public."Role" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."UserRole" ("id", "userId", "roleId", "createdAt", "organizationId", "assignedAt", "assignedBy", "expiresAt", "isActive")
  SELECT t."id", t."userId", t."roleId", t."createdAt", t."organizationId", t."assignedAt", t."assignedBy", t."expiresAt", t."isActive"
  FROM public."UserRole" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."Permission" ("id", "name", "description", "resource", "action", "createdAt", "updatedAt")
  SELECT t."id", t."name", t."description", t."resource", t."action", t."createdAt", t."updatedAt"
  FROM public."Permission" t
  WHERE TRUE;

INSERT INTO org_adhjapan."Customer" ("id", "customerCode", "name", "email", "phone", "address", "gstRegNo", "jpName", "jpAddress", "jpContact", "currency", "salesmanId", "xeroId", "xeroLastSyncAt", "whatsappGroupId", "whatsappGroupName", "createdAt", "updatedAt", "organizationId")
  SELECT t."id", t."customerCode", t."name", t."email", t."phone", t."address", t."gstRegNo", t."jpName", t."jpAddress", t."jpContact", t."currency", t."salesmanId", t."xeroId", t."xeroLastSyncAt", t."whatsappGroupId", t."whatsappGroupName", t."createdAt", t."updatedAt", t."organizationId"
  FROM public."Customer" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."Supplier" ("id", "supplierCode", "name", "email", "phone", "address", "gstRegNo", "currency", "xeroId", "xeroLastSyncAt", "createdAt", "updatedAt", "organizationId")
  SELECT t."id", t."supplierCode", t."name", t."email", t."phone", t."address", t."gstRegNo", t."currency", t."xeroId", t."xeroLastSyncAt", t."createdAt", t."updatedAt", t."organizationId"
  FROM public."Supplier" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."CustomField" ("id", "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", "required", "options", "defaultValue", "validation", "sortOrder", "isActive", "showInList", "showInForm", "groupName", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."entityType", t."fieldName", t."displayLabel", t."fieldType", t."required", t."options", t."defaultValue", t."validation", t."sortOrder", t."isActive", t."showInList", t."showInForm", t."groupName", t."createdAt", t."updatedAt"
  FROM public."CustomField" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."CustomFieldValue" ("id", "customFieldId", "entityId", "entityType", "value", "createdAt", "updatedAt")
  SELECT t."id", t."customFieldId", t."entityId", t."entityType", t."value", t."createdAt", t."updatedAt"
  FROM public."CustomFieldValue" t
  WHERE (EXISTS (SELECT 1 FROM public."CustomField" p00 WHERE p00.id = t."customFieldId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')));

INSERT INTO org_adhjapan."UserDashboardLayout" ("id", "userId", "organizationId", "key", "layout", "createdAt", "updatedAt")
  SELECT t."id", t."userId", t."organizationId", t."key", t."layout", t."createdAt", t."updatedAt"
  FROM public."UserDashboardLayout" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."Notification" ("id", "organizationId", "userId", "kind", "title", "body", "entityType", "entityId", "linkUrl", "readAt", "createdAt")
  SELECT t."id", t."organizationId", t."userId", t."kind", t."title", t."body", t."entityType", t."entityId", t."linkUrl", t."readAt", t."createdAt"
  FROM public."Notification" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."AuditLog" ("id", "userId", "userName", "userEmail", "action", "resource", "resourceId", "resourceName", "organizationId", "details", "ipAddress", "userAgent", "status", "errorMessage", "createdAt")
  SELECT t."id", t."userId", t."userName", t."userEmail", t."action", t."resource", t."resourceId", t."resourceName", t."organizationId", t."details", t."ipAddress", t."userAgent", t."status"::text::org_adhjapan."AuditStatus", t."errorMessage", t."createdAt"
  FROM public."AuditLog" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."EmailIngestConfig" ("id", "organizationId", "enabled", "watchedSenders", "routingMode", "defaultDocType", "rules", "aiGuidance", "createMode", "allowDomains", "allowAddresses", "filterMode", "filterNotes", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."enabled", t."watchedSenders", t."routingMode", t."defaultDocType", t."rules", t."aiGuidance", t."createMode", t."allowDomains", t."allowAddresses", t."filterMode", t."filterNotes", t."createdAt", t."updatedAt"
  FROM public."EmailIngestConfig" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."EmailIngestLog" ("id", "organizationId", "messageId", "fromAddress", "subject", "status", "reason", "createdDocumentIds", "attachmentCount", "rawMeta", "verdict", "direction", "counterparty", "triage", "inboxState", "orderId", "shipmentId", "actions", "threadKey", "inReplyTo", "emailDate", "filterVerdict", "filterReason", "purgeAfter", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."messageId", t."fromAddress", t."subject", t."status", t."reason", t."createdDocumentIds", t."attachmentCount", t."rawMeta", t."verdict", t."direction", t."counterparty", t."triage", t."inboxState", t."orderId", t."shipmentId", t."actions", t."threadKey", t."inReplyTo", t."emailDate", t."filterVerdict", t."filterReason", t."purgeAfter", t."createdAt", t."updatedAt"
  FROM public."EmailIngestLog" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."ChartOfAccount" ("id", "organizationId", "code", "name", "description", "accountType", "category", "normalBalance", "isControlAccount", "isSystem", "isActive", "parentAccountId", "xeroId", "xeroLastSyncAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."description", t."accountType", t."category", t."normalBalance", t."isControlAccount", t."isSystem", t."isActive", t."parentAccountId", t."xeroId", t."xeroLastSyncAt", t."createdAt", t."updatedAt"
  FROM public."ChartOfAccount" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."JournalEntry" ("id", "organizationId", "journalNumber", "entryDate", "type", "status", "isUnconfirmed", "reference", "description", "totalDebit", "totalCredit", "currency", "sourceDocumentId", "sourcePaymentId", "postedAt", "postedBy", "voidedAt", "voidedBy", "reversesEntryId", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."journalNumber", t."entryDate", t."type", t."status", t."isUnconfirmed", t."reference", t."description", t."totalDebit", t."totalCredit", t."currency", t."sourceDocumentId", t."sourcePaymentId", t."postedAt", t."postedBy", t."voidedAt", t."voidedBy", t."reversesEntryId", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."JournalEntry" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."JournalEntryLine" ("id", "journalEntryId", "accountId", "lineNumber", "description", "debit", "credit", "foreignAmount", "exchangeRate", "costCenterId")
  SELECT t."id", t."journalEntryId", t."accountId", t."lineNumber", t."description", t."debit", t."credit", t."foreignAmount", t."exchangeRate", t."costCenterId"
  FROM public."JournalEntryLine" t
  WHERE (EXISTS (SELECT 1 FROM public."CostCenter" p00 WHERE p00.id = t."costCenterId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."JournalEntry" p01 WHERE p01.id = t."journalEntryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."ChartOfAccount" p02 WHERE p02.id = t."accountId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')));

INSERT INTO org_adhjapan."AccountingSetting" ("id", "organizationId", "paymentDetails", "baseCurrency", "nextNumbers", "numberPrefixes", "activateLastSoldPrice", "activateLastBuyPrice", "yearOpeningDate", "yearOpeningStock", "monthOpeningDate", "monthOpeningStock", "monthClosingStock", "taxRegistrationNumber", "taxDefaultPercentage", "taxReference", "taxBasis", "taxPeriod", "salesTaxInclusive", "purchasesTaxInclusive", "fiscalYearEndDay", "fiscalYearEndMonth", "timeZone", "currencyRates", "accountCodeRanges", "controlAccounts", "billApprovalThreshold", "enablePerpetualInventory", "lockedThroughDate", "closeHistory", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."paymentDetails", t."baseCurrency", t."nextNumbers", t."numberPrefixes", t."activateLastSoldPrice", t."activateLastBuyPrice", t."yearOpeningDate", t."yearOpeningStock", t."monthOpeningDate", t."monthOpeningStock", t."monthClosingStock", t."taxRegistrationNumber", t."taxDefaultPercentage", t."taxReference", t."taxBasis", t."taxPeriod", t."salesTaxInclusive", t."purchasesTaxInclusive", t."fiscalYearEndDay", t."fiscalYearEndMonth", t."timeZone", t."currencyRates", t."accountCodeRanges", t."controlAccounts", t."billApprovalThreshold", t."enablePerpetualInventory", t."lockedThroughDate", t."closeHistory", t."createdAt", t."updatedAt"
  FROM public."AccountingSetting" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TaxRate" ("id", "organizationId", "code", "name", "rate", "direction", "category", "isActive", "isSystem", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."rate", t."direction", t."category", t."isActive", t."isSystem", t."createdAt", t."updatedAt"
  FROM public."TaxRate" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."CostCenter" ("id", "organizationId", "code", "name", "description", "parentId", "isActive", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."description", t."parentId", t."isActive", t."createdAt", t."updatedAt"
  FROM public."CostCenter" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."Budget" ("id", "organizationId", "accountId", "year", "month", "amount", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."accountId", t."year", t."month", t."amount", t."createdAt", t."updatedAt"
  FROM public."Budget" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."FixedAsset" ("id", "organizationId", "code", "name", "description", "category", "cost", "salvageValue", "inServiceDate", "method", "usefulLifeMonths", "decliningRate", "totalUnits", "unitsPerPeriod", "sourcePoId", "disposedAt", "disposalProceeds", "isActive", "depreciationProvisionAccountId", "depreciationExpenseAccountId", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."code", t."name", t."description", t."category", t."cost", t."salvageValue", t."inServiceDate", t."method", t."usefulLifeMonths", t."decliningRate", t."totalUnits", t."unitsPerPeriod", t."sourcePoId", t."disposedAt", t."disposalProceeds", t."isActive", t."depreciationProvisionAccountId", t."depreciationExpenseAccountId", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."FixedAsset" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."DepreciationEntry" ("id", "fixedAssetId", "organizationId", "periodYear", "periodMonth", "amount", "journalEntryId", "postedAt")
  SELECT t."id", t."fixedAssetId", t."organizationId", t."periodYear", t."periodMonth", t."amount", t."journalEntryId", t."postedAt"
  FROM public."DepreciationEntry" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."RecurringJournalTemplate" ("id", "organizationId", "name", "description", "reference", "frequency", "nextRunDate", "lastRunAt", "lastRunEntryId", "isActive", "lines", "endDate", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."name", t."description", t."reference", t."frequency", t."nextRunDate", t."lastRunAt", t."lastRunEntryId", t."isActive", t."lines", t."endDate", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."RecurringJournalTemplate" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."AccountMemory" ("id", "organizationId", "side", "text", "normalizedText", "accountCode", "accountId", "count", "embedding", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."side", t."text", t."normalizedText", t."accountCode", t."accountId", t."count", t."embedding", t."createdAt", t."updatedAt"
  FROM public."AccountMemory" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."BankStatementImport" ("id", "organizationId", "bankAccountId", "source", "filename", "periodStart", "periodEnd", "endingBalance", "columnMapping", "notes", "status", "error", "createdAt", "createdBy")
  SELECT t."id", t."organizationId", t."bankAccountId", t."source", t."filename", t."periodStart", t."periodEnd", t."endingBalance", t."columnMapping", t."notes", t."status", t."error", t."createdAt", t."createdBy"
  FROM public."BankStatementImport" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."BankStatementLine" ("id", "importId", "organizationId", "bankAccountId", "date", "description", "reference", "amount", "runningBalance", "status", "matchedJournalLineId", "matchedAt", "matchedBy", "postedJournalEntryId", "suggestedAccountId", "suggestionConfidence", "suggestionReason", "createdAt")
  SELECT t."id", t."importId", t."organizationId", t."bankAccountId", t."date", t."description", t."reference", t."amount", t."runningBalance", t."status", t."matchedJournalLineId", t."matchedAt", t."matchedBy", t."postedJournalEntryId", t."suggestedAccountId", t."suggestionConfidence", t."suggestionReason", t."createdAt"
  FROM public."BankStatementLine" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."BankStatementMatch" ("id", "organizationId", "lineId", "journalLineId", "createdAt", "createdBy")
  SELECT t."id", t."organizationId", t."lineId", t."journalLineId", t."createdAt", t."createdBy"
  FROM public."BankStatementMatch" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."XeroConnection" ("id", "organizationId", "tenantId", "accessToken", "refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."tenantId", t."accessToken", t."refreshToken", t."accessTokenExpiresAt", t."refreshTokenExpiresAt", t."createdAt", t."updatedAt"
  FROM public."XeroConnection" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."XeroAccountMapping" ("id", "organizationId", "aimsAccountId", "aimsAccountCode", "xeroAccountId", "xeroAccountCode", "xeroAccountName", "xeroAccountType", "source", "confidence", "reason", "confirmedAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."aimsAccountId", t."aimsAccountCode", t."xeroAccountId", t."xeroAccountCode", t."xeroAccountName", t."xeroAccountType", t."source", t."confidence", t."reason", t."confirmedAt", t."createdAt", t."updatedAt"
  FROM public."XeroAccountMapping" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."XeroSyncRun" ("id", "organizationId", "scope", "status", "counts", "errors", "startedAt", "finishedAt", "startedBy")
  SELECT t."id", t."organizationId", t."scope", t."status", t."counts", t."errors", t."startedAt", t."finishedAt", t."startedBy"
  FROM public."XeroSyncRun" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."Document" ("id", "createdAt", "updatedAt", "config", "documentTemplateId", "type", "organizationId", "name", "status", "baseDocumentId", "revisionNumber", "editingByUserId", "editingByName", "editingAt", "lastActivityAt", "version", "projectId", "projectDeploymentId", "attachments")
  SELECT t."id", t."createdAt", t."updatedAt", t."config", t."documentTemplateId", t."type", t."organizationId", t."name", t."status"::text::org_adhjapan."DocumentStatus", t."baseDocumentId", t."revisionNumber", t."editingByUserId", t."editingByName", t."editingAt", t."lastActivityAt", t."version", t."projectId", t."projectDeploymentId", t."attachments"
  FROM public."Document" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."DocumentItem" ("id", "documentId", "itemId", "itemType", "sku", "description", "quantity", "unitPrice", "discount", "amount", "uom", "lineNumber", "isService", "isFixedAsset", "deliveryStatus", "deductedAt", "deliveringAt", "deliveredAt", "completedAt", "installSkipped", "inventoryId", "assetId", "createdAt", "updatedAt")
  SELECT t."id", t."documentId", t."itemId", t."itemType"::text::org_adhjapan."ItemType", t."sku", t."description", t."quantity", t."unitPrice", t."discount", t."amount", t."uom", t."lineNumber", t."isService", t."isFixedAsset", t."deliveryStatus"::text::org_adhjapan."DeliveryStatus", t."deductedAt", t."deliveringAt", t."deliveredAt", t."completedAt", t."installSkipped", t."inventoryId", t."assetId", t."createdAt", t."updatedAt"
  FROM public."DocumentItem" t
  WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')));

INSERT INTO org_adhjapan."DocumentNumberFormat" ("id", "organizationId", "documentType", "label", "pattern", "nextSerial", "resetPolicy", "lastResetKey", "isActive", "sortOrder", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."documentType", t."label", t."pattern", t."nextSerial", t."resetPolicy", t."lastResetKey", t."isActive", t."sortOrder", t."createdAt", t."updatedAt"
  FROM public."DocumentNumberFormat" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."DocumentShareLink" ("id", "token", "documentId", "createdAt", "revokedAt")
  SELECT t."id", t."token", t."documentId", t."createdAt", t."revokedAt"
  FROM public."DocumentShareLink" t
  WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')));

INSERT INTO org_adhjapan."DocumentSignLink" ("id", "token", "documentId", "createdAt", "expiresAt", "revokedAt", "signedAt", "signerName", "signerIp", "userAgent")
  SELECT t."id", t."token", t."documentId", t."createdAt", t."expiresAt", t."revokedAt", t."signedAt", t."signerName", t."signerIp", t."userAgent"
  FROM public."DocumentSignLink" t
  WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')));

INSERT INTO org_adhjapan."DocumentEmbedding" ("id", "organizationId", "documentId", "type", "customerId", "textSnippet", "embedding", "updatedAt")
  SELECT t."id", t."organizationId", t."documentId", t."type", t."customerId", t."textSnippet", t."embedding", t."updatedAt"
  FROM public."DocumentEmbedding" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."SubmitJob" ("id", "organizationId", "createdByUserId", "batchId", "docType", "status", "s3Key", "fileUrl", "mimeType", "fileName", "documentId", "reason", "sequenceWarning", "attemptCount", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."createdByUserId", t."batchId", t."docType", t."status", t."s3Key", t."fileUrl", t."mimeType", t."fileName", t."documentId", t."reason", t."sequenceWarning", t."attemptCount", t."createdAt", t."updatedAt"
  FROM public."SubmitJob" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."Order" ("id", "orderNumber", "organizationId", "customerId", "sourceQuotationId", "orderType", "status", "items", "linkedDocuments", "notes", "createdAt", "updatedAt")
  SELECT t."id", t."orderNumber", t."organizationId", t."customerId", t."sourceQuotationId", t."orderType", t."status", t."items", t."linkedDocuments", t."notes", t."createdAt", t."updatedAt"
  FROM public."Order" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."RevenueItem" ("id", "organizationId", "code", "name", "type", "unitPrice", "taxRate", "accountCode", "accountId", "isActive", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."type", t."unitPrice", t."taxRate", t."accountCode", t."accountId", t."isActive", t."createdAt", t."updatedAt"
  FROM public."RevenueItem" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."PriceHistory" ("id", "assetId", "unitPrice", "quantity", "uom", "totalAmount", "documentId", "documentNumber", "documentDate", "customerId", "customerName", "organizationId", "createdAt", "updatedAt")
  SELECT t."id", t."assetId", t."unitPrice", t."quantity", t."uom", t."totalAmount", t."documentId", t."documentNumber", t."documentDate", t."customerId", t."customerName", t."organizationId", t."createdAt", t."updatedAt"
  FROM public."PriceHistory" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."AssetTemplateTag" ("id", "assetId", "templateId", "createdAt")
  SELECT t."id", t."assetId", t."templateId", t."createdAt"
  FROM public."AssetTemplateTag" t
  WHERE (EXISTS (SELECT 1 FROM public."Asset" p00 WHERE p00.id = t."assetId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')));

INSERT INTO org_adhjapan."TimelineItem" ("id", "message", "pdfUrl", "inventoryId", "documentId", "createdAt", "updatedAt")
  SELECT t."id", t."message", t."pdfUrl", t."inventoryId", t."documentId", t."createdAt", t."updatedAt"
  FROM public."TimelineItem" t
  WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."Inventory" p01 WHERE p01.id = t."inventoryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')));

INSERT INTO org_adhjapan."Payment" ("id", "organizationId", "customerId", "documentId", "amount", "paymentDate", "paymentMethod", "reference", "notes", "receiptId", "attachments", "xeroId", "journalEntryId", "createdBy", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."customerId", t."documentId", t."amount", t."paymentDate", t."paymentMethod", t."reference", t."notes", t."receiptId", t."attachments", t."xeroId", t."journalEntryId", t."createdBy", t."createdAt", t."updatedAt"
  FROM public."Payment" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."BillPayment" ("id", "organizationId", "billId", "supplierId", "amount", "paymentDate", "paymentMethod", "reference", "notes", "bankAccountId", "journalEntryId", "xeroId", "attachments", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."billId", t."supplierId", t."amount", t."paymentDate", t."paymentMethod", t."reference", t."notes", t."bankAccountId", t."journalEntryId", t."xeroId", t."attachments", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."BillPayment" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."RecurringInvoiceTemplate" ("id", "organizationId", "code", "name", "customerId", "documentTemplateId", "numberFormatId", "config", "frequency", "nextRunDate", "endDate", "autoSend", "isActive", "lastRunAt", "lastRunDocumentId", "nextRunNo", "projectId", "projectDeploymentId", "sourceDocumentId", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."code", t."name", t."customerId", t."documentTemplateId", t."numberFormatId", t."config", t."frequency", t."nextRunDate", t."endDate", t."autoSend", t."isActive", t."lastRunAt", t."lastRunDocumentId", t."nextRunNo", t."projectId", t."projectDeploymentId", t."sourceDocumentId", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."RecurringInvoiceTemplate" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeDocType" ("id", "organizationId", "code", "label", "category", "sortOrder", "isActive", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."label", t."category", t."sortOrder", t."isActive", t."createdAt", t."updatedAt"
  FROM public."TradeDocType" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."Contract" ("id", "organizationId", "contractNo", "piNumber", "piDate", "supplierId", "customerId", "destinationPort", "destinationCountry", "incoterm", "shipmentMonth", "deliveryMonth", "currency", "consignee", "notifyParty", "piAmount", "depositPercent", "depositAmount", "depositDueNote", "depositDueDays", "depositDueUnit", "depositPaidAt", "status", "notes", "periodStart", "periodEnd", "grade", "sizeSpec", "annualQtyMt", "tolerancePct", "balanceTerms", "qpBasis", "qmjpRule", "premiumSchedule", "checkFields", "createdById", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."contractNo", t."piNumber", t."piDate", t."supplierId", t."customerId", t."destinationPort", t."destinationCountry", t."incoterm", t."shipmentMonth", t."deliveryMonth", t."currency", t."consignee", t."notifyParty", t."piAmount", t."depositPercent", t."depositAmount", t."depositDueNote", t."depositDueDays", t."depositDueUnit", t."depositPaidAt", t."status"::text::org_adhjapan."TradeRecordStatus", t."notes", t."periodStart", t."periodEnd", t."grade", t."sizeSpec", t."annualQtyMt", t."tolerancePct", t."balanceTerms", t."qpBasis", t."qmjpRule", t."premiumSchedule", t."checkFields", t."createdById", t."createdAt", t."updatedAt"
  FROM public."Contract" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeOrder" ("id", "organizationId", "year", "orderNo", "contractId", "customerId", "supplierId", "shipMonth", "deliveryMonth", "product", "grade", "size", "qtyMt", "tolPct", "supplierPremium", "clientPremium", "upcharge", "piNo", "piDate", "piAmount", "depositPct", "depositAmount", "depositDueDays", "depositDueUnit", "depositPaidAt", "currency", "incoterm", "destinationPort", "consignee", "notifyParty", "status", "isTest", "notes", "reconciliation", "customerPoNo", "customerPoDate", "checkFields", "supplierOrderId", "createdById", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."year", t."orderNo", t."contractId", t."customerId", t."supplierId", t."shipMonth", t."deliveryMonth", t."product", t."grade", t."size", t."qtyMt", t."tolPct", t."supplierPremium", t."clientPremium", t."upcharge", t."piNo", t."piDate", t."piAmount", t."depositPct", t."depositAmount", t."depositDueDays", t."depositDueUnit", t."depositPaidAt", t."currency", t."incoterm", t."destinationPort", t."consignee", t."notifyParty", t."status"::text::org_adhjapan."TradeRecordStatus", t."isTest", t."notes", t."reconciliation", t."customerPoNo", t."customerPoDate", t."checkFields", t."supplierOrderId", t."createdById", t."createdAt", t."updatedAt"
  FROM public."TradeOrder" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."SupplierOrder" ("id", "organizationId", "year", "soNo", "supplierId", "contractId", "declarationMonth", "product", "grade", "size", "qtyMt", "qpBasis", "provisionalPricePerMt", "supplierPremium", "currency", "piNo", "piDate", "piAmount", "depositPct", "depositAmount", "depositPaidAt", "status", "notes", "forOrderId", "createdById", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."year", t."soNo", t."supplierId", t."contractId", t."declarationMonth", t."product", t."grade", t."size", t."qtyMt", t."qpBasis", t."provisionalPricePerMt", t."supplierPremium", t."currency", t."piNo", t."piDate", t."piAmount", t."depositPct", t."depositAmount", t."depositPaidAt", t."status"::text::org_adhjapan."TradeRecordStatus", t."notes", t."forOrderId", t."createdById", t."createdAt", t."updatedAt"
  FROM public."SupplierOrder" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."ContractLine" ("id", "organizationId", "contractId", "grade", "product", "sizeSpec", "quantityMt", "tolerancePct", "supplierPremium", "clientPremium", "qmjp", "billetPremium", "upcharge", "sortOrder", "notes", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."contractId", t."grade", t."product", t."sizeSpec", t."quantityMt", t."tolerancePct", t."supplierPremium", t."clientPremium", t."qmjp", t."billetPremium", t."upcharge", t."sortOrder", t."notes", t."createdAt", t."updatedAt"
  FROM public."ContractLine" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeSetting" ("id", "organizationId", "defaultConsignee", "defaultNotifyParty", "docDefaults", "customerProfiles", "estimatorRates", "supplierProfiles", "alertRules", "updatedAt")
  SELECT t."id", t."organizationId", t."defaultConsignee", t."defaultNotifyParty", t."docDefaults", t."customerProfiles", t."estimatorRates", t."supplierProfiles", t."alertRules", t."updatedAt"
  FROM public."TradeSetting" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."Shipment" ("id", "organizationId", "orderId", "contractId", "seqNo", "contractLineId", "customerId", "blNumber", "vessel", "voyageNo", "shippingLine", "etd", "eta", "actualArrivalDate", "deliveryMonth", "portOfLoading", "portOfDischarge", "netWeightMt", "grossWeightMt", "totalBundles", "totalPieces", "containerCount", "hsCode", "countryOfOrigin", "commodity", "sizeSpec", "ciNumber", "ciAmount", "telexReleaseCode", "currency", "status", "notes", "costs", "supplierOrderId", "etaHistory", "dischargeDate", "detFreeDays", "demFreeDays", "warehouse", "storageStartDate", "managementNo", "arrivingVessel", "arrivingVoyageNo", "tsPort", "tsEta", "tsEtd", "blReleaseType", "createdById", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."orderId", t."contractId", t."seqNo", t."contractLineId", t."customerId", t."blNumber", t."vessel", t."voyageNo", t."shippingLine", t."etd", t."eta", t."actualArrivalDate", t."deliveryMonth", t."portOfLoading", t."portOfDischarge", t."netWeightMt", t."grossWeightMt", t."totalBundles", t."totalPieces", t."containerCount", t."hsCode", t."countryOfOrigin", t."commodity", t."sizeSpec", t."ciNumber", t."ciAmount", t."telexReleaseCode", t."currency", t."status"::text::org_adhjapan."TradeRecordStatus", t."notes", t."costs", t."supplierOrderId", t."etaHistory", t."dischargeDate", t."detFreeDays", t."demFreeDays", t."warehouse", t."storageStartDate", t."managementNo", t."arrivingVessel", t."arrivingVoyageNo", t."tsPort", t."tsEta", t."tsEtd", t."blReleaseType", t."createdById", t."createdAt", t."updatedAt"
  FROM public."Shipment" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeStepTemplate" ("id", "organizationId", "scope", "code", "title", "displayNo", "description", "sortOrder", "requiredDocTypes", "optionalDocTypes", "requiredFields", "isOngoing", "isActive", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."scope"::text::org_adhjapan."TradeStepScope", t."code", t."title", t."displayNo", t."description", t."sortOrder", t."requiredDocTypes", t."optionalDocTypes", t."requiredFields", t."isOngoing", t."isActive", t."createdAt", t."updatedAt"
  FROM public."TradeStepTemplate" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeStep" ("id", "organizationId", "contractId", "shipmentId", "orderId", "supplierOrderId", "templateId", "code", "title", "displayNo", "sortOrder", "requiredDocTypes", "optionalDocTypes", "requiredFields", "isOngoing", "status", "holdOpen", "skipReason", "notApplicable", "subtasks", "payment", "updatedById", "updatedByName", "completedAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."contractId", t."shipmentId", t."orderId", t."supplierOrderId", t."templateId", t."code", t."title", t."displayNo", t."sortOrder", t."requiredDocTypes", t."optionalDocTypes", t."requiredFields", t."isOngoing", t."status"::text::org_adhjapan."TradeStepStatus", t."holdOpen", t."skipReason", t."notApplicable", t."subtasks", t."payment", t."updatedById", t."updatedByName", t."completedAt", t."createdAt", t."updatedAt"
  FROM public."TradeStep" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeFile" ("id", "organizationId", "docType", "s3Key", "fileName", "mimeType", "sizeBytes", "uploadedById", "uploadedByName", "notes", "thumbKey", "docRef", "source", "emailLogId", "sha256", "createdAt")
  SELECT t."id", t."organizationId", t."docType", t."s3Key", t."fileName", t."mimeType", t."sizeBytes", t."uploadedById", t."uploadedByName", t."notes", t."thumbKey", t."docRef", t."source", t."emailLogId", t."sha256", t."createdAt"
  FROM public."TradeFile" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeFileLink" ("id", "organizationId", "fileId", "contractId", "shipmentId", "orderId", "supplierOrderId", "stepId", "hiddenAt", "hiddenReason", "createdAt")
  SELECT t."id", t."organizationId", t."fileId", t."contractId", t."shipmentId", t."orderId", t."supplierOrderId", t."stepId", t."hiddenAt", t."hiddenReason", t."createdAt"
  FROM public."TradeFileLink" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeDocumentLink" ("id", "organizationId", "documentId", "docType", "contractId", "shipmentId", "orderId", "stepId", "createdAt")
  SELECT t."id", t."organizationId", t."documentId", t."docType", t."contractId", t."shipmentId", t."orderId", t."stepId", t."createdAt"
  FROM public."TradeDocumentLink" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeGeneratedDoc" ("id", "organizationId", "shipmentId", "contractId", "orderId", "coversShipmentIds", "templateKey", "issuingEntity", "docType", "number", "docRef", "status", "header", "columns", "rows", "sourceFileId", "finalFileId", "documentId", "createdById", "createdByName", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."shipmentId", t."contractId", t."orderId", t."coversShipmentIds", t."templateKey", t."issuingEntity", t."docType", t."number", t."docRef", t."status"::text::org_adhjapan."TradeGeneratedDocStatus", t."header", t."columns", t."rows", t."sourceFileId", t."finalFileId", t."documentId", t."createdById", t."createdByName", t."createdAt", t."updatedAt"
  FROM public."TradeGeneratedDoc" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeExtraction" ("id", "organizationId", "fileId", "kind", "status", "result", "checks", "error", "model", "inputTokens", "outputTokens", "durationMs", "shipmentId", "contractId", "orderId", "acknowledgedById", "acknowledgedByName", "acknowledgedAt", "createdById", "createdAt")
  SELECT t."id", t."organizationId", t."fileId", t."kind"::text::org_adhjapan."TradeExtractionKind", t."status"::text::org_adhjapan."TradeExtractionStatus", t."result", t."checks", t."error", t."model", t."inputTokens", t."outputTokens", t."durationMs", t."shipmentId", t."contractId", t."orderId", t."acknowledgedById", t."acknowledgedByName", t."acknowledgedAt", t."createdById", t."createdAt"
  FROM public."TradeExtraction" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradePayment" ("id", "organizationId", "direction", "paidAt", "amount", "currency", "account", "counterpartyType", "counterpartyId", "counterpartyName", "reference", "notes", "proofFileId", "createdById", "createdByName", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."direction", t."paidAt", t."amount", t."currency", t."account", t."counterpartyType", t."counterpartyId", t."counterpartyName", t."reference", t."notes", t."proofFileId", t."createdById", t."createdByName", t."createdAt", t."updatedAt"
  FROM public."TradePayment" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradePaymentAllocation" ("id", "organizationId", "paymentId", "targetType", "targetId", "targetLabel", "amount", "orderId", "shipmentId", "supplierOrderId", "createdAt")
  SELECT t."id", t."organizationId", t."paymentId", t."targetType", t."targetId", t."targetLabel", t."amount", t."orderId", t."shipmentId", t."supplierOrderId", t."createdAt"
  FROM public."TradePaymentAllocation" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeCredit" ("id", "organizationId", "customerId", "sourceDocId", "sourceNumber", "amount", "currency", "status", "usedByDocId", "usedByNumber", "usedAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."customerId", t."sourceDocId", t."sourceNumber", t."amount", t."currency", t."status", t."usedByDocId", t."usedByNumber", t."usedAt", t."createdAt", t."updatedAt"
  FROM public."TradeCredit" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."TradeAlert" ("id", "organizationId", "kind", "key", "dueAt", "title", "detail", "shipmentId", "orderId", "supplierOrderId", "linkUrl", "status", "notifiedAt", "resolvedAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."kind", t."key", t."dueAt", t."title", t."detail", t."shipmentId", t."orderId", t."supplierOrderId", t."linkUrl", t."status", t."notifiedAt", t."resolvedAt", t."createdAt", t."updatedAt"
  FROM public."TradeAlert" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

INSERT INTO org_adhjapan."ShipmentTracking" ("id", "organizationId", "shipmentId", "source", "provider", "carrier", "blNumber", "data", "raw", "diff", "applied", "appliedById", "appliedByName", "appliedAt", "emailLogId", "createdById", "createdAt")
  SELECT t."id", t."organizationId", t."shipmentId", t."source", t."provider", t."carrier", t."blNumber", t."data", t."raw", t."diff", t."applied", t."appliedById", t."appliedByName", t."appliedAt", t."emailLogId", t."createdById", t."createdAt"
  FROM public."ShipmentTracking" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

-- Role ↔ Permission links for this org's roles (implicit Prisma join table)
INSERT INTO org_adhjapan."_PermissionToRole" ("A", "B")
  SELECT j."A", j."B" FROM public."_PermissionToRole" j JOIN public."Role" r ON r.id = j."B"
  WHERE r."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%');

COMMIT;
