/*
  Warnings:

  - You are about to drop the column `organizationId` on the `Permission` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name,organizationId]` on the table `Role` will be added. If there are existing duplicate values, this will fail.
  - Made the column `organizationId` on table `Role` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Permission" DROP CONSTRAINT "Permission_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_organizationId_fkey";

-- DropIndex
DROP INDEX "Role_name_key";

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "price" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Permission" DROP COLUMN "organizationId";

-- AlterTable
ALTER TABLE "Role" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_organizationId_key" ON "Role"("name", "organizationId");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
