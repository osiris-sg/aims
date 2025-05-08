/*
  Warnings:

  - You are about to drop the column `assetId` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `attentionId` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `collectFrom` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `companyId` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `customerId` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `date` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `deliveryTo` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `doNo` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `gstRegNo` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `logo` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `poNo` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `referenceNo` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `returnOrderNo` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `signatureId` on the `DocumentTemplate` table. All the data in the column will be lost.
  - You are about to drop the `Attention` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Company` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DocumentItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Signature` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "DocumentItem" DROP CONSTRAINT "DocumentItem_documentTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentTemplate" DROP CONSTRAINT "DocumentTemplate_assetId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentTemplate" DROP CONSTRAINT "DocumentTemplate_attentionId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentTemplate" DROP CONSTRAINT "DocumentTemplate_companyId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentTemplate" DROP CONSTRAINT "DocumentTemplate_customerId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentTemplate" DROP CONSTRAINT "DocumentTemplate_signatureId_fkey";

-- AlterTable
ALTER TABLE "DocumentTemplate" DROP COLUMN "assetId",
DROP COLUMN "attentionId",
DROP COLUMN "collectFrom",
DROP COLUMN "companyId",
DROP COLUMN "customerId",
DROP COLUMN "date",
DROP COLUMN "deliveryTo",
DROP COLUMN "doNo",
DROP COLUMN "gstRegNo",
DROP COLUMN "logo",
DROP COLUMN "poNo",
DROP COLUMN "referenceNo",
DROP COLUMN "returnOrderNo",
DROP COLUMN "signatureId",
ADD COLUMN     "config" JSONB;

-- DropTable
DROP TABLE "Attention";

-- DropTable
DROP TABLE "Company";

-- DropTable
DROP TABLE "DocumentItem";

-- DropTable
DROP TABLE "Signature";
