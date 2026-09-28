-- 00 · Preflight. READ-ONLY. One result table; rows that need attention sort first.
--   left behind: table/column  → this org has data in a module/column its own schema will not get
--   pattern must match 1       → 0 means the org name pattern is wrong
--   org with no schema planned → an org exists that has no org file yet
--   info: legacy               → informational; legacy tables are archived, not copied

SELECT * FROM (
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
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'biofuel · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Biofuel%'))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'ciel · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'CIEL%'))))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppAgentConfig' AS item, (SELECT count(*) FROM public."WhatsAppAgentConfig" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppAppointment' AS item, (SELECT count(*) FROM public."WhatsAppAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'cappitech · WhatsAppContact' AS item, (SELECT count(*) FROM public."WhatsAppContact" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Cappitech%'))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'osiris · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'Osiris Technology%'))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · SubmitJob' AS item, (SELECT count(*) FROM public."SubmitJob" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · TimelineItem' AS item, (SELECT count(*) FROM public."TimelineItem" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%')) OR EXISTS (SELECT 1 FROM public."Inventory" p01 WHERE p01.id = t."inventoryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppAgentConfig' AS item, (SELECT count(*) FROM public."WhatsAppAgentConfig" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppAppointment' AS item, (SELECT count(*) FROM public."WhatsAppAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'yourworld · WhatsAppContact' AS item, (SELECT count(*) FROM public."WhatsAppContact" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE '%your%world%'))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · SubmitJob' AS item, (SELECT count(*) FROM public."SubmitJob" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · TimelineItem' AS item, (SELECT count(*) FROM public."TimelineItem" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%')) OR EXISTS (SELECT 1 FROM public."Inventory" p01 WHERE p01.id = t."inventoryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppAgentConfig' AS item, (SELECT count(*) FROM public."WhatsAppAgentConfig" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppAppointment' AS item, (SELECT count(*) FROM public."WhatsAppAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'u2can · WhatsAppContact' AS item, (SELECT count(*) FROM public."WhatsAppContact" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'U2CAN%'))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · CustomerContact' AS item, (SELECT count(*) FROM public."CustomerContact" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · CustomerInfoContact' AS item, (SELECT count(*) FROM public."CustomerInfoContact" t WHERE (EXISTS (SELECT 1 FROM public."CustomerInfoRequest" p00 WHERE p00.id = t."requestId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · CustomerInfoRequest' AS item, (SELECT count(*) FROM public."CustomerInfoRequest" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Delivery' AS item, (SELECT count(*) FROM public."Delivery" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · DeliveryItem' AS item, (SELECT count(*) FROM public."DeliveryItem" t WHERE (EXISTS (SELECT 1 FROM public."Delivery" p00 WHERE p00.id = t."deliveryId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%')) OR EXISTS (SELECT 1 FROM public."Document" p01 WHERE p01.id = t."documentId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · DeliveryLocationPing' AS item, (SELECT count(*) FROM public."DeliveryLocationPing" t WHERE (EXISTS (SELECT 1 FROM public."MaintenanceServiceReport" p00 WHERE p00.id = t."reportId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · DeliveryShareLink' AS item, (SELECT count(*) FROM public."DeliveryShareLink" t WHERE (EXISTS (SELECT 1 FROM public."Document" p00 WHERE p00.id = t."documentId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%')) OR EXISTS (SELECT 1 FROM public."Delivery" p01 WHERE p01.id = t."deliveryId" AND p01."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Inventory' AS item, (SELECT count(*) FROM public."Inventory" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
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
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · SiteOffice' AS item, (SELECT count(*) FROM public."SiteOffice" t WHERE (EXISTS (SELECT 1 FROM public."Customer" p00 WHERE p00.id = t."customerId" AND p00."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · SupplierRebate' AS item, (SELECT count(*) FROM public."SupplierRebate" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · Team' AS item, (SELECT count(*) FROM public."Team" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppAgentConfig' AS item, (SELECT count(*) FROM public."WhatsAppAgentConfig" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppAppointment' AS item, (SELECT count(*) FROM public."WhatsAppAppointment" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
  UNION ALL
  SELECT 'left behind: table not in org schema' AS chk, 'platformorg · WhatsAppContact' AS item, (SELECT count(*) FROM public."WhatsAppContact" t WHERE t."organizationId" IN (SELECT id FROM public."Organization" WHERE name ILIKE 'osiris-platform%'))::int AS n
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
  SELECT 'org with no schema planned' AS chk, 'any' AS item, (SELECT count(*) FROM public."Organization" WHERE NOT (name ILIKE 'Biofuel%' OR name ILIKE 'CIEL%' OR name ILIKE 'Cappitech%' OR name ILIKE 'Osiris Technology%' OR name ILIKE '%your%world%' OR name ILIKE 'U2CAN%' OR name ILIKE 'osiris-platform%'))::int AS n
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
