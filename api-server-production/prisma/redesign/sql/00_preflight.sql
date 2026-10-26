-- 00 · Preflight. READ-ONLY. One result table; rows that need attention sort first.
--   left behind: table/column  → this org has data in a module/column its own schema will not get
--   pattern must match 1       → 0 means the org name pattern is wrong
--   org with no schema planned → an org exists that has no org file yet
--   info: legacy               → informational; legacy tables are archived, not copied

SELECT * FROM (
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · DesignerAdvance' AS item, (SELECT count(*) FROM public."DesignerAdvance" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · DesignerAppointment' AS item, (SELECT count(*) FROM public."DesignerAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · DesignerBookingLink' AS item, (SELECT count(*) FROM public."DesignerBookingLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · InvoiceIntake' AS item, (SELECT count(*) FROM public."InvoiceIntake" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · Lead' AS item, (SELECT count(*) FROM public."Lead" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · LeadAttachment' AS item, (SELECT count(*) FROM public."LeadAttachment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · ProjectCost' AS item, (SELECT count(*) FROM public."ProjectCost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · ProjectMilestone' AS item, (SELECT count(*) FROM public."ProjectMilestone" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · ProjectQuestStep' AS item, (SELECT count(*) FROM public."ProjectQuestStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · ProjectScheduleItem' AS item, (SELECT count(*) FROM public."ProjectScheduleItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · ProjectShareLink' AS item, (SELECT count(*) FROM public."ProjectShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · QuestMediaRequest' AS item, (SELECT count(*) FROM public."QuestMediaRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · WorkSection' AS item, (SELECT count(*) FROM public."WorkSection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Project.designer' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."designer" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Project.designerUserId' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."designerUserId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Project.stage' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."stage" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Project.commissionPct' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."commissionPct" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Project.rebatePct' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."rebatePct" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Project.source' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."source" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Project.leadId' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."leadId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Asset.capacityKw' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."capacityKw" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Asset.accessoryIds' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."accessoryIds" IS NOT NULL AND t."accessoryIds" <> '{}')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Asset.accessoryOptionIds' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."accessoryOptionIds" IS NOT NULL AND t."accessoryOptionIds" <> '{}')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · Asset.points' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."points" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · RevenueItem.workSectionId' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."workSectionId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · RevenueItem.descriptionTemplate' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."descriptionTemplate" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · RevenueItem.includes' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."includes" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · RevenueItem.unitCost' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."unitCost" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · RevenueItem.uom' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."uom" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · RevenueItem.pricingMode' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."pricingMode" IS NOT NULL AND t."pricingMode" <> 'priced')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'biofuel · RevenueItem.supplierName' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%') AND t."supplierName" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'biofuel · ILIKE ''Biofuel%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'Biofuel%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · Asset' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · Assignment' AS item, (SELECT count(*) FROM public."Assignment" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · Category' AS item, (SELECT count(*) FROM public."Category" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · ContactDetail' AS item, (SELECT count(*) FROM public."ContactDetail" t WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · DeliveryGroupPost' AS item, (SELECT count(*) FROM public."DeliveryGroupPost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · Inventory' AS item, (SELECT count(*) FROM public."Inventory" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · MaintenanceSchedule' AS item, (SELECT count(*) FROM public."MaintenanceSchedule" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · MaintenanceServiceReport' AS item, (SELECT count(*) FROM public."MaintenanceServiceReport" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · ProjectContact' AS item, (SELECT count(*) FROM public."ProjectContact" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · ProjectDeployment' AS item, (SELECT count(*) FROM public."ProjectDeployment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · QuantityAdjustment' AS item, (SELECT count(*) FROM public."QuantityAdjustment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · WhatsAppGroup' AS item, (SELECT count(*) FROM public."WhatsAppGroup" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'ciel · Project.customerPoNumber' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%') AND t."customerPoNumber" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'ciel · Project.siteOfficeId' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%') AND t."siteOfficeId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'ciel · ILIKE ''CIEL%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'CIEL%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · AdAccountConnection' AS item, (SELECT count(*) FROM public."AdAccountConnection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · AdInsight' AS item, (SELECT count(*) FROM public."AdInsight" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · Assignment' AS item, (SELECT count(*) FROM public."Assignment" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · ContactDetail' AS item, (SELECT count(*) FROM public."ContactDetail" t WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · DeliveryGroupPost' AS item, (SELECT count(*) FROM public."DeliveryGroupPost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · DesignerAdvance' AS item, (SELECT count(*) FROM public."DesignerAdvance" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · DesignerAppointment' AS item, (SELECT count(*) FROM public."DesignerAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · DesignerBookingLink' AS item, (SELECT count(*) FROM public."DesignerBookingLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · InvoiceIntake' AS item, (SELECT count(*) FROM public."InvoiceIntake" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · Lead' AS item, (SELECT count(*) FROM public."Lead" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · LeadAttachment' AS item, (SELECT count(*) FROM public."LeadAttachment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · MaintenanceSchedule' AS item, (SELECT count(*) FROM public."MaintenanceSchedule" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · MaintenanceServiceReport' AS item, (SELECT count(*) FROM public."MaintenanceServiceReport" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · Project' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · ProjectContact' AS item, (SELECT count(*) FROM public."ProjectContact" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · ProjectCost' AS item, (SELECT count(*) FROM public."ProjectCost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · ProjectDeployment' AS item, (SELECT count(*) FROM public."ProjectDeployment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · ProjectMilestone' AS item, (SELECT count(*) FROM public."ProjectMilestone" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · ProjectQuestStep' AS item, (SELECT count(*) FROM public."ProjectQuestStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · ProjectScheduleItem' AS item, (SELECT count(*) FROM public."ProjectScheduleItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · ProjectShareLink' AS item, (SELECT count(*) FROM public."ProjectShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · QuestMediaRequest' AS item, (SELECT count(*) FROM public."QuestMediaRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppAgentConfig' AS item, (SELECT count(*) FROM public."WhatsAppAgentConfig" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppAppointment' AS item, (SELECT count(*) FROM public."WhatsAppAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppContact' AS item, (SELECT count(*) FROM public."WhatsAppContact" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppGroup' AS item, (SELECT count(*) FROM public."WhatsAppGroup" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppMessage' AS item, (SELECT count(*) FROM public."WhatsAppMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppQnA' AS item, (SELECT count(*) FROM public."WhatsAppQnA" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppScheduledMessage' AS item, (SELECT count(*) FROM public."WhatsAppScheduledMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppSuggestion' AS item, (SELECT count(*) FROM public."WhatsAppSuggestion" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WorkSection' AS item, (SELECT count(*) FROM public."WorkSection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'cappitech · RevenueItem.workSectionId' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%') AND t."workSectionId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'cappitech · RevenueItem.descriptionTemplate' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%') AND t."descriptionTemplate" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'cappitech · RevenueItem.includes' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%') AND t."includes" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'cappitech · RevenueItem.unitCost' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%') AND t."unitCost" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'cappitech · RevenueItem.uom' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%') AND t."uom" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'cappitech · RevenueItem.pricingMode' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%') AND t."pricingMode" IS NOT NULL AND t."pricingMode" <> 'priced')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'cappitech · RevenueItem.supplierName' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%') AND t."supplierName" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'cappitech · ILIKE ''Cappitech%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'Cappitech%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · Assignment' AS item, (SELECT count(*) FROM public."Assignment" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · ContactDetail' AS item, (SELECT count(*) FROM public."ContactDetail" t WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · DesignerAdvance' AS item, (SELECT count(*) FROM public."DesignerAdvance" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · DesignerAppointment' AS item, (SELECT count(*) FROM public."DesignerAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · DesignerBookingLink' AS item, (SELECT count(*) FROM public."DesignerBookingLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · InvoiceIntake' AS item, (SELECT count(*) FROM public."InvoiceIntake" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · Lead' AS item, (SELECT count(*) FROM public."Lead" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · LeadAttachment' AS item, (SELECT count(*) FROM public."LeadAttachment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · ProjectContact' AS item, (SELECT count(*) FROM public."ProjectContact" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · ProjectCost' AS item, (SELECT count(*) FROM public."ProjectCost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · ProjectDeployment' AS item, (SELECT count(*) FROM public."ProjectDeployment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · ProjectMilestone' AS item, (SELECT count(*) FROM public."ProjectMilestone" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · ProjectQuestStep' AS item, (SELECT count(*) FROM public."ProjectQuestStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · ProjectScheduleItem' AS item, (SELECT count(*) FROM public."ProjectScheduleItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · ProjectShareLink' AS item, (SELECT count(*) FROM public."ProjectShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · QuestMediaRequest' AS item, (SELECT count(*) FROM public."QuestMediaRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · WorkSection' AS item, (SELECT count(*) FROM public."WorkSection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Project.designer' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."designer" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Project.designerUserId' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."designerUserId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Project.stage' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."stage" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Project.commissionPct' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."commissionPct" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Project.rebatePct' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."rebatePct" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Project.source' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."source" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Project.leadId' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."leadId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Asset.capacityKw' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."capacityKw" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Asset.accessoryIds' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."accessoryIds" IS NOT NULL AND t."accessoryIds" <> '{}')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Asset.accessoryOptionIds' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."accessoryOptionIds" IS NOT NULL AND t."accessoryOptionIds" <> '{}')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · Asset.points' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."points" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · RevenueItem.workSectionId' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."workSectionId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · RevenueItem.descriptionTemplate' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."descriptionTemplate" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · RevenueItem.includes' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."includes" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · RevenueItem.unitCost' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."unitCost" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · RevenueItem.uom' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."uom" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · RevenueItem.pricingMode' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."pricingMode" IS NOT NULL AND t."pricingMode" <> 'priced')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'osiris · RevenueItem.supplierName' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%') AND t."supplierName" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'osiris · ILIKE ''Osiris Technology%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'Osiris Technology%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · AdAccountConnection' AS item, (SELECT count(*) FROM public."AdAccountConnection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · AdInsight' AS item, (SELECT count(*) FROM public."AdInsight" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Asset' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · AssetTemplateTag' AS item, (SELECT count(*) FROM public."AssetTemplateTag" t WHERE (EXISTS (SELECT 1 FROM public."Asset" p00 WHERE p00.id = t."assetId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Assignment' AS item, (SELECT count(*) FROM public."Assignment" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · BillPayment' AS item, (SELECT count(*) FROM public."BillPayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Category' AS item, (SELECT count(*) FROM public."Category" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · ContactDetail' AS item, (SELECT count(*) FROM public."ContactDetail" t WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DeliveryGroupPost' AS item, (SELECT count(*) FROM public."DeliveryGroupPost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DesignerAdvance' AS item, (SELECT count(*) FROM public."DesignerAdvance" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DesignerAppointment' AS item, (SELECT count(*) FROM public."DesignerAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DesignerBookingLink' AS item, (SELECT count(*) FROM public."DesignerBookingLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Document' AS item, (SELECT count(*) FROM public."Document" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DocumentEmbedding' AS item, (SELECT count(*) FROM public."DocumentEmbedding" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DocumentItem' AS item, (SELECT count(*) FROM public."DocumentItem" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DocumentNumberFormat' AS item, (SELECT count(*) FROM public."DocumentNumberFormat" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DocumentShareLink' AS item, (SELECT count(*) FROM public."DocumentShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DocumentSignLink' AS item, (SELECT count(*) FROM public."DocumentSignLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Inventory' AS item, (SELECT count(*) FROM public."Inventory" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · InvoiceIntake' AS item, (SELECT count(*) FROM public."InvoiceIntake" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Lead' AS item, (SELECT count(*) FROM public."Lead" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · LeadAttachment' AS item, (SELECT count(*) FROM public."LeadAttachment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · MaintenanceSchedule' AS item, (SELECT count(*) FROM public."MaintenanceSchedule" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · MaintenanceServiceReport' AS item, (SELECT count(*) FROM public."MaintenanceServiceReport" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Order' AS item, (SELECT count(*) FROM public."Order" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Payment' AS item, (SELECT count(*) FROM public."Payment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · PriceHistory' AS item, (SELECT count(*) FROM public."PriceHistory" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Project' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · ProjectContact' AS item, (SELECT count(*) FROM public."ProjectContact" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · ProjectCost' AS item, (SELECT count(*) FROM public."ProjectCost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · ProjectDeployment' AS item, (SELECT count(*) FROM public."ProjectDeployment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · ProjectMilestone' AS item, (SELECT count(*) FROM public."ProjectMilestone" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · ProjectQuestStep' AS item, (SELECT count(*) FROM public."ProjectQuestStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · ProjectScheduleItem' AS item, (SELECT count(*) FROM public."ProjectScheduleItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · ProjectShareLink' AS item, (SELECT count(*) FROM public."ProjectShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · QuantityAdjustment' AS item, (SELECT count(*) FROM public."QuantityAdjustment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · QuestMediaRequest' AS item, (SELECT count(*) FROM public."QuestMediaRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · RecurringInvoiceTemplate' AS item, (SELECT count(*) FROM public."RecurringInvoiceTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · RevenueItem' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · SubmitJob' AS item, (SELECT count(*) FROM public."SubmitJob" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TimelineItem' AS item, (SELECT count(*) FROM public."TimelineItem" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Inventory" p01 WHERE p01.id = t."inventoryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppAgentConfig' AS item, (SELECT count(*) FROM public."WhatsAppAgentConfig" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppAppointment' AS item, (SELECT count(*) FROM public."WhatsAppAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppContact' AS item, (SELECT count(*) FROM public."WhatsAppContact" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppGroup' AS item, (SELECT count(*) FROM public."WhatsAppGroup" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppMessage' AS item, (SELECT count(*) FROM public."WhatsAppMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppQnA' AS item, (SELECT count(*) FROM public."WhatsAppQnA" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppScheduledMessage' AS item, (SELECT count(*) FROM public."WhatsAppScheduledMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppSuggestion' AS item, (SELECT count(*) FROM public."WhatsAppSuggestion" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WorkSection' AS item, (SELECT count(*) FROM public."WorkSection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'yourworld · ILIKE ''%your%world%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE '%your%world%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · AdAccountConnection' AS item, (SELECT count(*) FROM public."AdAccountConnection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · AdInsight' AS item, (SELECT count(*) FROM public."AdInsight" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Asset' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · AssetTemplateTag' AS item, (SELECT count(*) FROM public."AssetTemplateTag" t WHERE (EXISTS (SELECT 1 FROM public."Asset" p00 WHERE p00.id = t."assetId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Assignment' AS item, (SELECT count(*) FROM public."Assignment" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · BillPayment' AS item, (SELECT count(*) FROM public."BillPayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Category' AS item, (SELECT count(*) FROM public."Category" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · ContactDetail' AS item, (SELECT count(*) FROM public."ContactDetail" t WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DeliveryGroupPost' AS item, (SELECT count(*) FROM public."DeliveryGroupPost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DesignerAdvance' AS item, (SELECT count(*) FROM public."DesignerAdvance" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DesignerAppointment' AS item, (SELECT count(*) FROM public."DesignerAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DesignerBookingLink' AS item, (SELECT count(*) FROM public."DesignerBookingLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Document' AS item, (SELECT count(*) FROM public."Document" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DocumentEmbedding' AS item, (SELECT count(*) FROM public."DocumentEmbedding" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DocumentItem' AS item, (SELECT count(*) FROM public."DocumentItem" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DocumentNumberFormat' AS item, (SELECT count(*) FROM public."DocumentNumberFormat" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DocumentShareLink' AS item, (SELECT count(*) FROM public."DocumentShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DocumentSignLink' AS item, (SELECT count(*) FROM public."DocumentSignLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Inventory' AS item, (SELECT count(*) FROM public."Inventory" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · InvoiceIntake' AS item, (SELECT count(*) FROM public."InvoiceIntake" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Lead' AS item, (SELECT count(*) FROM public."Lead" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · LeadAttachment' AS item, (SELECT count(*) FROM public."LeadAttachment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · MaintenanceSchedule' AS item, (SELECT count(*) FROM public."MaintenanceSchedule" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · MaintenanceServiceReport' AS item, (SELECT count(*) FROM public."MaintenanceServiceReport" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Order' AS item, (SELECT count(*) FROM public."Order" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Payment' AS item, (SELECT count(*) FROM public."Payment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · PriceHistory' AS item, (SELECT count(*) FROM public."PriceHistory" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Project' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · ProjectContact' AS item, (SELECT count(*) FROM public."ProjectContact" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · ProjectCost' AS item, (SELECT count(*) FROM public."ProjectCost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · ProjectDeployment' AS item, (SELECT count(*) FROM public."ProjectDeployment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · ProjectMilestone' AS item, (SELECT count(*) FROM public."ProjectMilestone" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · ProjectQuestStep' AS item, (SELECT count(*) FROM public."ProjectQuestStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · ProjectScheduleItem' AS item, (SELECT count(*) FROM public."ProjectScheduleItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · ProjectShareLink' AS item, (SELECT count(*) FROM public."ProjectShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · QuantityAdjustment' AS item, (SELECT count(*) FROM public."QuantityAdjustment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · QuestMediaRequest' AS item, (SELECT count(*) FROM public."QuestMediaRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · RecurringInvoiceTemplate' AS item, (SELECT count(*) FROM public."RecurringInvoiceTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · RevenueItem' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · SubmitJob' AS item, (SELECT count(*) FROM public."SubmitJob" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TimelineItem' AS item, (SELECT count(*) FROM public."TimelineItem" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Inventory" p01 WHERE p01.id = t."inventoryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppAgentConfig' AS item, (SELECT count(*) FROM public."WhatsAppAgentConfig" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppAppointment' AS item, (SELECT count(*) FROM public."WhatsAppAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppContact' AS item, (SELECT count(*) FROM public."WhatsAppContact" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppGroup' AS item, (SELECT count(*) FROM public."WhatsAppGroup" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppMessage' AS item, (SELECT count(*) FROM public."WhatsAppMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppQnA' AS item, (SELECT count(*) FROM public."WhatsAppQnA" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppScheduledMessage' AS item, (SELECT count(*) FROM public."WhatsAppScheduledMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppSuggestion' AS item, (SELECT count(*) FROM public."WhatsAppSuggestion" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WorkSection' AS item, (SELECT count(*) FROM public."WorkSection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'u2can · ILIKE ''U2CAN%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'U2CAN%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · AdAccountConnection' AS item, (SELECT count(*) FROM public."AdAccountConnection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · AdInsight' AS item, (SELECT count(*) FROM public."AdInsight" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Asset' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Assignment' AS item, (SELECT count(*) FROM public."Assignment" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Category' AS item, (SELECT count(*) FROM public."Category" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · ContactDetail' AS item, (SELECT count(*) FROM public."ContactDetail" t WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · DeliveryGroupPost' AS item, (SELECT count(*) FROM public."DeliveryGroupPost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · DesignerAdvance' AS item, (SELECT count(*) FROM public."DesignerAdvance" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · DesignerAppointment' AS item, (SELECT count(*) FROM public."DesignerAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · DesignerBookingLink' AS item, (SELECT count(*) FROM public."DesignerBookingLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Inventory' AS item, (SELECT count(*) FROM public."Inventory" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · InvoiceIntake' AS item, (SELECT count(*) FROM public."InvoiceIntake" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Lead' AS item, (SELECT count(*) FROM public."Lead" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · LeadAttachment' AS item, (SELECT count(*) FROM public."LeadAttachment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · MaintenanceSchedule' AS item, (SELECT count(*) FROM public."MaintenanceSchedule" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · MaintenanceServiceReport' AS item, (SELECT count(*) FROM public."MaintenanceServiceReport" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Project' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · ProjectContact' AS item, (SELECT count(*) FROM public."ProjectContact" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · ProjectCost' AS item, (SELECT count(*) FROM public."ProjectCost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · ProjectDeployment' AS item, (SELECT count(*) FROM public."ProjectDeployment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · ProjectMilestone' AS item, (SELECT count(*) FROM public."ProjectMilestone" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · ProjectQuestStep' AS item, (SELECT count(*) FROM public."ProjectQuestStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · ProjectScheduleItem' AS item, (SELECT count(*) FROM public."ProjectScheduleItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · ProjectShareLink' AS item, (SELECT count(*) FROM public."ProjectShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · QuantityAdjustment' AS item, (SELECT count(*) FROM public."QuantityAdjustment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · QuestMediaRequest' AS item, (SELECT count(*) FROM public."QuestMediaRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppAgentConfig' AS item, (SELECT count(*) FROM public."WhatsAppAgentConfig" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppAppointment' AS item, (SELECT count(*) FROM public."WhatsAppAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppContact' AS item, (SELECT count(*) FROM public."WhatsAppContact" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppGroup' AS item, (SELECT count(*) FROM public."WhatsAppGroup" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppMessage' AS item, (SELECT count(*) FROM public."WhatsAppMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppQnA' AS item, (SELECT count(*) FROM public."WhatsAppQnA" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppScheduledMessage' AS item, (SELECT count(*) FROM public."WhatsAppScheduledMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppSuggestion' AS item, (SELECT count(*) FROM public."WhatsAppSuggestion" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WorkSection' AS item, (SELECT count(*) FROM public."WorkSection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'platformorg · RevenueItem.workSectionId' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%') AND t."workSectionId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'platformorg · RevenueItem.descriptionTemplate' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%') AND t."descriptionTemplate" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'platformorg · RevenueItem.includes' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%') AND t."includes" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'platformorg · RevenueItem.unitCost' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%') AND t."unitCost" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'platformorg · RevenueItem.uom' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%') AND t."uom" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'platformorg · RevenueItem.pricingMode' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%') AND t."pricingMode" IS NOT NULL AND t."pricingMode" <> 'priced')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'platformorg · RevenueItem.supplierName' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%') AND t."supplierName" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'platformorg · ILIKE ''osiris-platform%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'osiris-platform%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · AdAccountConnection' AS item, (SELECT count(*) FROM public."AdAccountConnection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · AdInsight' AS item, (SELECT count(*) FROM public."AdInsight" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · Asset' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · Assignment' AS item, (SELECT count(*) FROM public."Assignment" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · Category' AS item, (SELECT count(*) FROM public."Category" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · ContactDetail' AS item, (SELECT count(*) FROM public."ContactDetail" t WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · DeliveryGroupPost' AS item, (SELECT count(*) FROM public."DeliveryGroupPost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · DesignerAdvance' AS item, (SELECT count(*) FROM public."DesignerAdvance" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · DesignerAppointment' AS item, (SELECT count(*) FROM public."DesignerAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · DesignerBookingLink' AS item, (SELECT count(*) FROM public."DesignerBookingLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · Inventory' AS item, (SELECT count(*) FROM public."Inventory" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · InvoiceIntake' AS item, (SELECT count(*) FROM public."InvoiceIntake" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · Lead' AS item, (SELECT count(*) FROM public."Lead" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · LeadAttachment' AS item, (SELECT count(*) FROM public."LeadAttachment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · MaintenanceSchedule' AS item, (SELECT count(*) FROM public."MaintenanceSchedule" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · MaintenanceServiceReport' AS item, (SELECT count(*) FROM public."MaintenanceServiceReport" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · Project' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · ProjectContact' AS item, (SELECT count(*) FROM public."ProjectContact" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · ProjectCost' AS item, (SELECT count(*) FROM public."ProjectCost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · ProjectDeployment' AS item, (SELECT count(*) FROM public."ProjectDeployment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · ProjectMilestone' AS item, (SELECT count(*) FROM public."ProjectMilestone" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · ProjectQuestStep' AS item, (SELECT count(*) FROM public."ProjectQuestStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · ProjectScheduleItem' AS item, (SELECT count(*) FROM public."ProjectScheduleItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · ProjectShareLink' AS item, (SELECT count(*) FROM public."ProjectShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · QuantityAdjustment' AS item, (SELECT count(*) FROM public."QuantityAdjustment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · QuestMediaRequest' AS item, (SELECT count(*) FROM public."QuestMediaRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · WhatsAppAgentConfig' AS item, (SELECT count(*) FROM public."WhatsAppAgentConfig" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · WhatsAppAppointment' AS item, (SELECT count(*) FROM public."WhatsAppAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · WhatsAppContact' AS item, (SELECT count(*) FROM public."WhatsAppContact" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · WhatsAppGroup' AS item, (SELECT count(*) FROM public."WhatsAppGroup" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · WhatsAppMessage' AS item, (SELECT count(*) FROM public."WhatsAppMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · WhatsAppQnA' AS item, (SELECT count(*) FROM public."WhatsAppQnA" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · WhatsAppScheduledMessage' AS item, (SELECT count(*) FROM public."WhatsAppScheduledMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · WhatsAppSuggestion' AS item, (SELECT count(*) FROM public."WhatsAppSuggestion" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'adhjapan · WorkSection' AS item, (SELECT count(*) FROM public."WorkSection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'adhjapan · RevenueItem.workSectionId' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%') AND t."workSectionId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'adhjapan · RevenueItem.descriptionTemplate' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%') AND t."descriptionTemplate" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'adhjapan · RevenueItem.includes' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%') AND t."includes" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'adhjapan · RevenueItem.unitCost' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%') AND t."unitCost" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'adhjapan · RevenueItem.uom' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%') AND t."uom" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'adhjapan · RevenueItem.pricingMode' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%') AND t."pricingMode" IS NOT NULL AND t."pricingMode" <> 'priced')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'adhjapan · RevenueItem.supplierName' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%') AND t."supplierName" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'adhjapan · ILIKE ''Asia Deal Hub%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'Asia Deal Hub%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · AdAccountConnection' AS item, (SELECT count(*) FROM public."AdAccountConnection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · AdInsight' AS item, (SELECT count(*) FROM public."AdInsight" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · Assignment' AS item, (SELECT count(*) FROM public."Assignment" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · ContactDetail' AS item, (SELECT count(*) FROM public."ContactDetail" t WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · DeliveryGroupPost' AS item, (SELECT count(*) FROM public."DeliveryGroupPost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · DesignerAdvance' AS item, (SELECT count(*) FROM public."DesignerAdvance" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · DesignerAppointment' AS item, (SELECT count(*) FROM public."DesignerAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · DesignerBookingLink' AS item, (SELECT count(*) FROM public."DesignerBookingLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · InvoiceIntake' AS item, (SELECT count(*) FROM public."InvoiceIntake" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · Lead' AS item, (SELECT count(*) FROM public."Lead" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · LeadAttachment' AS item, (SELECT count(*) FROM public."LeadAttachment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · MaintenanceSchedule' AS item, (SELECT count(*) FROM public."MaintenanceSchedule" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · MaintenanceServiceReport' AS item, (SELECT count(*) FROM public."MaintenanceServiceReport" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · Project' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · ProjectContact' AS item, (SELECT count(*) FROM public."ProjectContact" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · ProjectCost' AS item, (SELECT count(*) FROM public."ProjectCost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · ProjectDeployment' AS item, (SELECT count(*) FROM public."ProjectDeployment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · ProjectMilestone' AS item, (SELECT count(*) FROM public."ProjectMilestone" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · ProjectQuestStep' AS item, (SELECT count(*) FROM public."ProjectQuestStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · ProjectScheduleItem' AS item, (SELECT count(*) FROM public."ProjectScheduleItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · ProjectShareLink' AS item, (SELECT count(*) FROM public."ProjectShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · QuestMediaRequest' AS item, (SELECT count(*) FROM public."QuestMediaRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · WhatsAppAgentConfig' AS item, (SELECT count(*) FROM public."WhatsAppAgentConfig" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · WhatsAppAppointment' AS item, (SELECT count(*) FROM public."WhatsAppAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · WhatsAppContact' AS item, (SELECT count(*) FROM public."WhatsAppContact" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · WhatsAppGroup' AS item, (SELECT count(*) FROM public."WhatsAppGroup" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · WhatsAppMessage' AS item, (SELECT count(*) FROM public."WhatsAppMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · WhatsAppQnA' AS item, (SELECT count(*) FROM public."WhatsAppQnA" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · WhatsAppScheduledMessage' AS item, (SELECT count(*) FROM public."WhatsAppScheduledMessage" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · WhatsAppSuggestion' AS item, (SELECT count(*) FROM public."WhatsAppSuggestion" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'chongaik · WorkSection' AS item, (SELECT count(*) FROM public."WorkSection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · Asset.capacityKw' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."capacityKw" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · Asset.accessoryIds' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."accessoryIds" IS NOT NULL AND t."accessoryIds" <> '{}')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · Asset.accessoryOptionIds' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."accessoryOptionIds" IS NOT NULL AND t."accessoryOptionIds" <> '{}')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · Asset.points' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."points" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · RevenueItem.workSectionId' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."workSectionId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · RevenueItem.descriptionTemplate' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."descriptionTemplate" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · RevenueItem.includes' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."includes" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · RevenueItem.unitCost' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."unitCost" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · RevenueItem.uom' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."uom" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · RevenueItem.pricingMode' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."pricingMode" IS NOT NULL AND t."pricingMode" <> 'priced')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'chongaik · RevenueItem.supplierName' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Chong Aik%') AND t."supplierName" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'chongaik · ILIKE ''Chong Aik%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'Chong Aik%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · Asset' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · Assignment' AS item, (SELECT count(*) FROM public."Assignment" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · Category' AS item, (SELECT count(*) FROM public."Category" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · ContactDetail' AS item, (SELECT count(*) FROM public."ContactDetail" t WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · DeliveryGroupPost' AS item, (SELECT count(*) FROM public."DeliveryGroupPost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · DesignerAdvance' AS item, (SELECT count(*) FROM public."DesignerAdvance" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · DesignerAppointment' AS item, (SELECT count(*) FROM public."DesignerAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · DesignerBookingLink' AS item, (SELECT count(*) FROM public."DesignerBookingLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · Inventory' AS item, (SELECT count(*) FROM public."Inventory" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · InvoiceIntake' AS item, (SELECT count(*) FROM public."InvoiceIntake" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · Lead' AS item, (SELECT count(*) FROM public."Lead" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · LeadAttachment' AS item, (SELECT count(*) FROM public."LeadAttachment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · MaintenanceSchedule' AS item, (SELECT count(*) FROM public."MaintenanceSchedule" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · MaintenanceServiceReport' AS item, (SELECT count(*) FROM public."MaintenanceServiceReport" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · Project' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · ProjectContact' AS item, (SELECT count(*) FROM public."ProjectContact" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · ProjectCost' AS item, (SELECT count(*) FROM public."ProjectCost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · ProjectDeployment' AS item, (SELECT count(*) FROM public."ProjectDeployment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · ProjectMilestone' AS item, (SELECT count(*) FROM public."ProjectMilestone" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · ProjectQuestStep' AS item, (SELECT count(*) FROM public."ProjectQuestStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · ProjectScheduleItem' AS item, (SELECT count(*) FROM public."ProjectScheduleItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · ProjectShareLink' AS item, (SELECT count(*) FROM public."ProjectShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · QuantityAdjustment' AS item, (SELECT count(*) FROM public."QuantityAdjustment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · QuestMediaRequest' AS item, (SELECT count(*) FROM public."QuestMediaRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'denzel · WorkSection' AS item, (SELECT count(*) FROM public."WorkSection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'denzel · RevenueItem.workSectionId' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%') AND t."workSectionId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'denzel · RevenueItem.descriptionTemplate' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%') AND t."descriptionTemplate" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'denzel · RevenueItem.includes' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%') AND t."includes" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'denzel · RevenueItem.unitCost' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%') AND t."unitCost" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'denzel · RevenueItem.uom' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%') AND t."uom" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'denzel · RevenueItem.pricingMode' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%') AND t."pricingMode" IS NOT NULL AND t."pricingMode" <> 'priced')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'denzel · RevenueItem.supplierName' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Denzel%') AND t."supplierName" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'denzel · ILIKE ''Denzel%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'Denzel%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · DesignerAdvance' AS item, (SELECT count(*) FROM public."DesignerAdvance" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · DesignerAppointment' AS item, (SELECT count(*) FROM public."DesignerAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · DesignerBookingLink' AS item, (SELECT count(*) FROM public."DesignerBookingLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · InvoiceIntake' AS item, (SELECT count(*) FROM public."InvoiceIntake" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · Lead' AS item, (SELECT count(*) FROM public."Lead" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · LeadAttachment' AS item, (SELECT count(*) FROM public."LeadAttachment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · ProjectCost' AS item, (SELECT count(*) FROM public."ProjectCost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · ProjectMilestone' AS item, (SELECT count(*) FROM public."ProjectMilestone" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · ProjectQuestStep' AS item, (SELECT count(*) FROM public."ProjectQuestStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · ProjectScheduleItem' AS item, (SELECT count(*) FROM public."ProjectScheduleItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · ProjectShareLink' AS item, (SELECT count(*) FROM public."ProjectShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · QuestMediaRequest' AS item, (SELECT count(*) FROM public."QuestMediaRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demoindustries · WorkSection' AS item, (SELECT count(*) FROM public."WorkSection" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Project.designer' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."designer" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Project.designerUserId' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."designerUserId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Project.stage' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."stage" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Project.commissionPct' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."commissionPct" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Project.rebatePct' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."rebatePct" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Project.source' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."source" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Project.leadId' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."leadId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Asset.capacityKw' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."capacityKw" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Asset.accessoryIds' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."accessoryIds" IS NOT NULL AND t."accessoryIds" <> '{}')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Asset.accessoryOptionIds' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."accessoryOptionIds" IS NOT NULL AND t."accessoryOptionIds" <> '{}')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · Asset.points' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."points" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · RevenueItem.workSectionId' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."workSectionId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · RevenueItem.descriptionTemplate' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."descriptionTemplate" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · RevenueItem.includes' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."includes" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · RevenueItem.unitCost' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."unitCost" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · RevenueItem.uom' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."uom" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · RevenueItem.pricingMode' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."pricingMode" IS NOT NULL AND t."pricingMode" <> 'priced')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demoindustries · RevenueItem.supplierName' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%') AND t."supplierName" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'demoindustries · ILIKE ''DEMO INDUSTRIES%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'DEMO INDUSTRIES%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · Asset' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · Assignment' AS item, (SELECT count(*) FROM public."Assignment" t WHERE (EXISTS (SELECT 1 FROM public."Inventory" p00 WHERE p00.id = t."inventoryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%')) OR EXISTS (SELECT 1 FROM public."Asset" p01 WHERE p01.id = t."assetId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%')) OR EXISTS (SELECT 1 FROM public."Document" p02 WHERE p02.id = t."documentId" AND p02."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%')) OR EXISTS (SELECT 1 FROM public."Project" p03 WHERE p03.id = t."projectId" AND p03."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%')) OR EXISTS (SELECT 1 FROM public."ProjectDeployment" p04 WHERE p04.id = t."projectDeploymentId" AND p04."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · Category' AS item, (SELECT count(*) FROM public."Category" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · ContactDetail' AS item, (SELECT count(*) FROM public."ContactDetail" t WHERE (EXISTS (SELECT 1 FROM public."SiteOffice" p00 WHERE p00.id = t."siteOfficeId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p00."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · DeliveryGroupPost' AS item, (SELECT count(*) FROM public."DeliveryGroupPost" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · Inventory' AS item, (SELECT count(*) FROM public."Inventory" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · MaintenanceSchedule' AS item, (SELECT count(*) FROM public."MaintenanceSchedule" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · MaintenanceServiceReport' AS item, (SELECT count(*) FROM public."MaintenanceServiceReport" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · ProjectContact' AS item, (SELECT count(*) FROM public."ProjectContact" t WHERE (EXISTS (SELECT 1 FROM public."Project" p00 WHERE p00.id = t."projectId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%')) OR EXISTS (SELECT 1 FROM public."CustomerContact" p01 WHERE p01.id = t."customerContactId" AND (EXISTS (SELECT 1 FROM public."Customer" p10 WHERE p10.id = p01."customerId" AND p10."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · ProjectDeployment' AS item, (SELECT count(*) FROM public."ProjectDeployment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · QuantityAdjustment' AS item, (SELECT count(*) FROM public."QuantityAdjustment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'demointerior · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demointerior · Project.customerPoNumber' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%') AND t."customerPoNumber" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'demointerior · Project.siteOfficeId' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%') AND t."siteOfficeId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'demointerior · ILIKE ''DEMO INTERIOR%''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'DEMO INTERIOR%')::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · Contract' AS item, (SELECT count(*) FROM public."Contract" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · ContractLine' AS item, (SELECT count(*) FROM public."ContractLine" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · Shipment' AS item, (SELECT count(*) FROM public."Shipment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · ShipmentTracking' AS item, (SELECT count(*) FROM public."ShipmentTracking" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · SupplierOrder' AS item, (SELECT count(*) FROM public."SupplierOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeAlert' AS item, (SELECT count(*) FROM public."TradeAlert" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeCredit' AS item, (SELECT count(*) FROM public."TradeCredit" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeDocType' AS item, (SELECT count(*) FROM public."TradeDocType" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeDocumentLink' AS item, (SELECT count(*) FROM public."TradeDocumentLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeExtraction' AS item, (SELECT count(*) FROM public."TradeExtraction" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeFile' AS item, (SELECT count(*) FROM public."TradeFile" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeFileLink' AS item, (SELECT count(*) FROM public."TradeFileLink" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeGeneratedDoc' AS item, (SELECT count(*) FROM public."TradeGeneratedDoc" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeOrder' AS item, (SELECT count(*) FROM public."TradeOrder" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradePayment' AS item, (SELECT count(*) FROM public."TradePayment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradePaymentAllocation' AS item, (SELECT count(*) FROM public."TradePaymentAllocation" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeSetting' AS item, (SELECT count(*) FROM public."TradeSetting" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeStep' AS item, (SELECT count(*) FROM public."TradeStep" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'wct · TradeStepTemplate' AS item, (SELECT count(*) FROM public."TradeStepTemplate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Project.designer' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."designer" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Project.designerUserId' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."designerUserId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Project.stage' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."stage" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Project.commissionPct' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."commissionPct" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Project.rebatePct' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."rebatePct" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Project.source' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."source" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Project.leadId' AS item, (SELECT count(*) FROM public."Project" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."leadId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Asset.capacityKw' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."capacityKw" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Asset.accessoryIds' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."accessoryIds" IS NOT NULL AND t."accessoryIds" <> '{}')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Asset.accessoryOptionIds' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."accessoryOptionIds" IS NOT NULL AND t."accessoryOptionIds" <> '{}')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · Asset.points' AS item, (SELECT count(*) FROM public."Asset" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."points" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · RevenueItem.workSectionId' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."workSectionId" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · RevenueItem.descriptionTemplate' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."descriptionTemplate" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · RevenueItem.includes' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."includes" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · RevenueItem.unitCost' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."unitCost" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · RevenueItem.uom' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."uom" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · RevenueItem.pricingMode' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."pricingMode" IS NOT NULL AND t."pricingMode" <> 'priced')::int AS n
  UNION ALL
  SELECT 'left behind: column not in org schema' AS chk, 'wct · RevenueItem.supplierName' AS item, (SELECT count(*) FROM public."RevenueItem" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'WCT') AND t."supplierName" IS NOT NULL)::int AS n
  UNION ALL
  SELECT 'org name pattern must match exactly 1' AS chk, 'wct · ILIKE ''WCT''' AS item, (SELECT abs(count(*) - 1) FROM public."Organization" WHERE name ILIKE 'WCT')::int AS n
  UNION ALL
  SELECT 'org with no schema planned' AS chk, 'any' AS item, (SELECT count(*) FROM public."Organization" WHERE NOT (name ILIKE 'Biofuel%' OR name ILIKE 'CIEL%' OR name ILIKE 'Cappitech%' OR name ILIKE 'Osiris Technology%' OR name ILIKE '%your%world%' OR name ILIKE 'U2CAN%' OR name ILIKE 'osiris-platform%' OR name ILIKE 'Asia Deal Hub%' OR name ILIKE 'Chong Aik%' OR name ILIKE 'Denzel%' OR name ILIKE 'DEMO INDUSTRIES%' OR name ILIKE 'DEMO INTERIOR%' OR name ILIKE 'WCT'))::int AS n
  UNION ALL
  SELECT 'row with no org (would not be copied)' AS chk, 'Asset' AS item, (SELECT count(*) FROM public."Asset" WHERE "organizationId" IS NULL)::int AS n
  UNION ALL
  SELECT 'row with no org (would not be copied)' AS chk, 'Category' AS item, (SELECT count(*) FROM public."Category" WHERE "organizationId" IS NULL)::int AS n
  UNION ALL
  SELECT 'row with no org (would not be copied)' AS chk, 'Project' AS item, (SELECT count(*) FROM public."Project" WHERE "organizationId" IS NULL)::int AS n
  UNION ALL
  SELECT 'info: legacy rows stay in public' AS chk, 'Bill' AS item, (SELECT count(*) FROM public."Bill")::int AS n
  UNION ALL
  SELECT 'info: legacy rows stay in public' AS chk, 'Transaction' AS item, (SELECT count(*) FROM public."Transaction")::int AS n
  UNION ALL
  SELECT 'info: legacy rows stay in public' AS chk, 'CustomerBalance' AS item, (SELECT count(*) FROM public."CustomerBalance")::int AS n
  UNION ALL
  SELECT 'info: legacy rows stay in public' AS chk, 'ImportInvoice' AS item, (SELECT count(*) FROM public."ImportInvoice")::int AS n
  UNION ALL
  SELECT 'info: legacy rows stay in public' AS chk, 'PassTrackerEntry' AS item, (SELECT count(*) FROM public."PassTrackerEntry")::int AS n
) x
ORDER BY (chk LIKE 'info%'), n DESC, chk, item;
