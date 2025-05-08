/*
  Warnings:

  - You are about to drop the column `inventoryId` on the `Document` table. All the data in the column will be lost.
  - You are about to drop the column `templateData` on the `Document` table. All the data in the column will be lost.
  - Added the required column `documentTemplateId` to the `Document` table without a default value. This is not possible if the table is not empty.
  - Added the required column `organizationId` to the `Document` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `Document` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_inventoryId_fkey";

-- AlterTable
ALTER TABLE "Document" DROP COLUMN "inventoryId",
DROP COLUMN "templateData",
ADD COLUMN     "config" JSONB,
ADD COLUMN     "documentTemplateId" TEXT NOT NULL,
ADD COLUMN     "organizationId" TEXT NOT NULL,
ADD COLUMN     "type" TEXT NOT NULL;
