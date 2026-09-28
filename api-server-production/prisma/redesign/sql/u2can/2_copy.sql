-- org_u2can · copy this org's rows out of public (read) into org_u2can (write). public is NOT modified.
-- Org matched by: name ILIKE 'U2CAN%' (preflight checks it matches exactly one org).

BEGIN;
INSERT INTO org_u2can."Role" ("id", "name", "description", "allowedModules", "createdAt", "updatedAt", "organizationId")
  SELECT t."id", t."name", t."description", t."allowedModules", t."createdAt", t."updatedAt", t."organizationId"
  FROM public."Role" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."UserRole" ("id", "userId", "roleId", "createdAt", "organizationId", "assignedAt", "assignedBy", "expiresAt", "isActive")
  SELECT t."id", t."userId", t."roleId", t."createdAt", t."organizationId", t."assignedAt", t."assignedBy", t."expiresAt", t."isActive"
  FROM public."UserRole" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."Permission" ("id", "name", "description", "resource", "action", "createdAt", "updatedAt")
  SELECT t."id", t."name", t."description", t."resource", t."action", t."createdAt", t."updatedAt"
  FROM public."Permission" t
  WHERE TRUE;

INSERT INTO org_u2can."Customer" ("id", "customerCode", "name", "email", "phone", "address", "gstRegNo", "currency", "salesmanId", "xeroId", "xeroLastSyncAt", "createdAt", "updatedAt", "organizationId")
  SELECT t."id", t."customerCode", t."name", t."email", t."phone", t."address", t."gstRegNo", t."currency", t."salesmanId", t."xeroId", t."xeroLastSyncAt", t."createdAt", t."updatedAt", t."organizationId"
  FROM public."Customer" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."Supplier" ("id", "supplierCode", "name", "email", "phone", "address", "gstRegNo", "currency", "xeroId", "xeroLastSyncAt", "createdAt", "updatedAt", "organizationId")
  SELECT t."id", t."supplierCode", t."name", t."email", t."phone", t."address", t."gstRegNo", t."currency", t."xeroId", t."xeroLastSyncAt", t."createdAt", t."updatedAt", t."organizationId"
  FROM public."Supplier" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."CustomField" ("id", "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", "required", "options", "defaultValue", "validation", "sortOrder", "isActive", "showInList", "showInForm", "groupName", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."entityType", t."fieldName", t."displayLabel", t."fieldType", t."required", t."options", t."defaultValue", t."validation", t."sortOrder", t."isActive", t."showInList", t."showInForm", t."groupName", t."createdAt", t."updatedAt"
  FROM public."CustomField" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."CustomFieldValue" ("id", "customFieldId", "entityId", "entityType", "value", "createdAt", "updatedAt")
  SELECT t."id", t."customFieldId", t."entityId", t."entityType", t."value", t."createdAt", t."updatedAt"
  FROM public."CustomFieldValue" t
  WHERE (EXISTS (SELECT 1 FROM public."CustomField" p00 WHERE p00.id = t."customFieldId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')));

INSERT INTO org_u2can."UserDashboardLayout" ("id", "userId", "organizationId", "key", "layout", "createdAt", "updatedAt")
  SELECT t."id", t."userId", t."organizationId", t."key", t."layout", t."createdAt", t."updatedAt"
  FROM public."UserDashboardLayout" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."Notification" ("id", "organizationId", "userId", "kind", "title", "body", "entityType", "entityId", "linkUrl", "readAt", "createdAt")
  SELECT t."id", t."organizationId", t."userId", t."kind", t."title", t."body", t."entityType", t."entityId", t."linkUrl", t."readAt", t."createdAt"
  FROM public."Notification" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."AuditLog" ("id", "userId", "userName", "userEmail", "action", "resource", "resourceId", "resourceName", "organizationId", "details", "ipAddress", "userAgent", "status", "errorMessage", "createdAt")
  SELECT t."id", t."userId", t."userName", t."userEmail", t."action", t."resource", t."resourceId", t."resourceName", t."organizationId", t."details", t."ipAddress", t."userAgent", t."status"::text::org_u2can."AuditStatus", t."errorMessage", t."createdAt"
  FROM public."AuditLog" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."EmailIngestConfig" ("id", "organizationId", "enabled", "watchedSenders", "routingMode", "defaultDocType", "rules", "aiGuidance", "createMode", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."enabled", t."watchedSenders", t."routingMode", t."defaultDocType", t."rules", t."aiGuidance", t."createMode", t."createdAt", t."updatedAt"
  FROM public."EmailIngestConfig" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."EmailIngestLog" ("id", "organizationId", "messageId", "fromAddress", "subject", "status", "reason", "createdDocumentIds", "attachmentCount", "rawMeta", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."messageId", t."fromAddress", t."subject", t."status", t."reason", t."createdDocumentIds", t."attachmentCount", t."rawMeta", t."createdAt", t."updatedAt"
  FROM public."EmailIngestLog" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."ChartOfAccount" ("id", "organizationId", "code", "name", "description", "accountType", "category", "normalBalance", "isControlAccount", "isSystem", "isActive", "parentAccountId", "xeroId", "xeroLastSyncAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."description", t."accountType", t."category", t."normalBalance", t."isControlAccount", t."isSystem", t."isActive", t."parentAccountId", t."xeroId", t."xeroLastSyncAt", t."createdAt", t."updatedAt"
  FROM public."ChartOfAccount" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."JournalEntry" ("id", "organizationId", "journalNumber", "entryDate", "type", "status", "isUnconfirmed", "reference", "description", "totalDebit", "totalCredit", "currency", "sourceDocumentId", "sourcePaymentId", "postedAt", "postedBy", "voidedAt", "voidedBy", "reversesEntryId", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."journalNumber", t."entryDate", t."type", t."status", t."isUnconfirmed", t."reference", t."description", t."totalDebit", t."totalCredit", t."currency", t."sourceDocumentId", t."sourcePaymentId", t."postedAt", t."postedBy", t."voidedAt", t."voidedBy", t."reversesEntryId", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."JournalEntry" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."JournalEntryLine" ("id", "journalEntryId", "accountId", "lineNumber", "description", "debit", "credit", "foreignAmount", "exchangeRate", "costCenterId")
  SELECT t."id", t."journalEntryId", t."accountId", t."lineNumber", t."description", t."debit", t."credit", t."foreignAmount", t."exchangeRate", t."costCenterId"
  FROM public."JournalEntryLine" t
  WHERE (EXISTS (SELECT 1 FROM public."CostCenter" p00 WHERE p00.id = t."costCenterId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."JournalEntry" p01 WHERE p01.id = t."journalEntryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."ChartOfAccount" p02 WHERE p02.id = t."accountId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')));

INSERT INTO org_u2can."AccountingSetting" ("id", "organizationId", "paymentDetails", "baseCurrency", "nextNumbers", "numberPrefixes", "activateLastSoldPrice", "activateLastBuyPrice", "yearOpeningDate", "yearOpeningStock", "monthOpeningDate", "monthOpeningStock", "monthClosingStock", "taxRegistrationNumber", "taxDefaultPercentage", "taxReference", "taxBasis", "taxPeriod", "salesTaxInclusive", "purchasesTaxInclusive", "fiscalYearEndDay", "fiscalYearEndMonth", "timeZone", "currencyRates", "accountCodeRanges", "controlAccounts", "billApprovalThreshold", "enablePerpetualInventory", "lockedThroughDate", "closeHistory", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."paymentDetails", t."baseCurrency", t."nextNumbers", t."numberPrefixes", t."activateLastSoldPrice", t."activateLastBuyPrice", t."yearOpeningDate", t."yearOpeningStock", t."monthOpeningDate", t."monthOpeningStock", t."monthClosingStock", t."taxRegistrationNumber", t."taxDefaultPercentage", t."taxReference", t."taxBasis", t."taxPeriod", t."salesTaxInclusive", t."purchasesTaxInclusive", t."fiscalYearEndDay", t."fiscalYearEndMonth", t."timeZone", t."currencyRates", t."accountCodeRanges", t."controlAccounts", t."billApprovalThreshold", t."enablePerpetualInventory", t."lockedThroughDate", t."closeHistory", t."createdAt", t."updatedAt"
  FROM public."AccountingSetting" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."TaxRate" ("id", "organizationId", "code", "name", "rate", "direction", "category", "isActive", "isSystem", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."rate", t."direction", t."category", t."isActive", t."isSystem", t."createdAt", t."updatedAt"
  FROM public."TaxRate" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."CostCenter" ("id", "organizationId", "code", "name", "description", "parentId", "isActive", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."code", t."name", t."description", t."parentId", t."isActive", t."createdAt", t."updatedAt"
  FROM public."CostCenter" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."Budget" ("id", "organizationId", "accountId", "year", "month", "amount", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."accountId", t."year", t."month", t."amount", t."createdAt", t."updatedAt"
  FROM public."Budget" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."FixedAsset" ("id", "organizationId", "code", "name", "description", "category", "cost", "salvageValue", "inServiceDate", "method", "usefulLifeMonths", "decliningRate", "totalUnits", "unitsPerPeriod", "sourcePoId", "disposedAt", "disposalProceeds", "isActive", "depreciationProvisionAccountId", "depreciationExpenseAccountId", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."code", t."name", t."description", t."category", t."cost", t."salvageValue", t."inServiceDate", t."method", t."usefulLifeMonths", t."decliningRate", t."totalUnits", t."unitsPerPeriod", t."sourcePoId", t."disposedAt", t."disposalProceeds", t."isActive", t."depreciationProvisionAccountId", t."depreciationExpenseAccountId", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."FixedAsset" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."DepreciationEntry" ("id", "fixedAssetId", "organizationId", "periodYear", "periodMonth", "amount", "journalEntryId", "postedAt")
  SELECT t."id", t."fixedAssetId", t."organizationId", t."periodYear", t."periodMonth", t."amount", t."journalEntryId", t."postedAt"
  FROM public."DepreciationEntry" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."RecurringJournalTemplate" ("id", "organizationId", "name", "description", "reference", "frequency", "nextRunDate", "lastRunAt", "lastRunEntryId", "isActive", "lines", "endDate", "createdAt", "updatedAt", "createdBy")
  SELECT t."id", t."organizationId", t."name", t."description", t."reference", t."frequency", t."nextRunDate", t."lastRunAt", t."lastRunEntryId", t."isActive", t."lines", t."endDate", t."createdAt", t."updatedAt", t."createdBy"
  FROM public."RecurringJournalTemplate" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."AccountMemory" ("id", "organizationId", "side", "text", "normalizedText", "accountCode", "accountId", "count", "embedding", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."side", t."text", t."normalizedText", t."accountCode", t."accountId", t."count", t."embedding", t."createdAt", t."updatedAt"
  FROM public."AccountMemory" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."BankStatementImport" ("id", "organizationId", "bankAccountId", "source", "filename", "periodStart", "periodEnd", "endingBalance", "columnMapping", "notes", "status", "error", "createdAt", "createdBy")
  SELECT t."id", t."organizationId", t."bankAccountId", t."source", t."filename", t."periodStart", t."periodEnd", t."endingBalance", t."columnMapping", t."notes", t."status", t."error", t."createdAt", t."createdBy"
  FROM public."BankStatementImport" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."BankStatementLine" ("id", "importId", "organizationId", "bankAccountId", "date", "description", "reference", "amount", "runningBalance", "status", "matchedJournalLineId", "matchedAt", "matchedBy", "postedJournalEntryId", "suggestedAccountId", "suggestionConfidence", "suggestionReason", "createdAt")
  SELECT t."id", t."importId", t."organizationId", t."bankAccountId", t."date", t."description", t."reference", t."amount", t."runningBalance", t."status", t."matchedJournalLineId", t."matchedAt", t."matchedBy", t."postedJournalEntryId", t."suggestedAccountId", t."suggestionConfidence", t."suggestionReason", t."createdAt"
  FROM public."BankStatementLine" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."BankStatementMatch" ("id", "organizationId", "lineId", "journalLineId", "createdAt", "createdBy")
  SELECT t."id", t."organizationId", t."lineId", t."journalLineId", t."createdAt", t."createdBy"
  FROM public."BankStatementMatch" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."XeroConnection" ("id", "organizationId", "tenantId", "accessToken", "refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."tenantId", t."accessToken", t."refreshToken", t."accessTokenExpiresAt", t."refreshTokenExpiresAt", t."createdAt", t."updatedAt"
  FROM public."XeroConnection" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."XeroAccountMapping" ("id", "organizationId", "aimsAccountId", "aimsAccountCode", "xeroAccountId", "xeroAccountCode", "xeroAccountName", "xeroAccountType", "source", "confidence", "reason", "confirmedAt", "createdAt", "updatedAt")
  SELECT t."id", t."organizationId", t."aimsAccountId", t."aimsAccountCode", t."xeroAccountId", t."xeroAccountCode", t."xeroAccountName", t."xeroAccountType", t."source", t."confidence", t."reason", t."confirmedAt", t."createdAt", t."updatedAt"
  FROM public."XeroAccountMapping" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

INSERT INTO org_u2can."XeroSyncRun" ("id", "organizationId", "scope", "status", "counts", "errors", "startedAt", "finishedAt", "startedBy")
  SELECT t."id", t."organizationId", t."scope", t."status", t."counts", t."errors", t."startedAt", t."finishedAt", t."startedBy"
  FROM public."XeroSyncRun" t
  WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

-- Role ↔ Permission links for this org's roles (implicit Prisma join table)
INSERT INTO org_u2can."_PermissionToRole" ("A", "B")
  SELECT j."A", j."B" FROM public."_PermissionToRole" j JOIN public."Role" r ON r.id = j."B"
  WHERE r."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%');

COMMIT;
