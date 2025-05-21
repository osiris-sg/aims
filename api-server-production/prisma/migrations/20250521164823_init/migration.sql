/*
  Warnings:

  - A unique constraint covering the columns `[skuKey,deletedAt]` on the table `Asset` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Asset_skuKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "Asset_skuKey_deletedAt_key" ON "Asset"("skuKey", "deletedAt");
