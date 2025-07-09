/*
  Warnings:

  - A unique constraint covering the columns `[userId,roleId,organizationId]` on the table `UserRole` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `organizationId` to the `UserRole` table without a default value. This is not possible if the table is not empty.

*/

-- First, create the osiris platform organization for existing data
INSERT INTO "Organization" ("id", "name", "createdAt", "updatedAt") 
VALUES ('osiris-platform', 'osiris-platform', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- DropIndex
DROP INDEX "UserRole_userId_roleId_key";

-- AlterTable - Add organizationId column with default value first
ALTER TABLE "UserRole" ADD COLUMN "organizationId" TEXT;

-- Update existing UserRole records to use the osiris platform organization
UPDATE "UserRole" SET "organizationId" = 'osiris-platform' WHERE "organizationId" IS NULL;

-- Now make the column NOT NULL
ALTER TABLE "UserRole" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateTable
CREATE TABLE "UserOrganization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (create indexes before using ON CONFLICT)
CREATE UNIQUE INDEX "UserOrganization_userId_organizationId_key" ON "UserOrganization"("userId", "organizationId");

-- Create UserOrganization records for existing users
INSERT INTO "UserOrganization" ("id", "userId", "organizationId", "isActive", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    "userId",
    'osiris-platform',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "userId" FROM "UserRole") AS unique_users
ON CONFLICT ("userId", "organizationId") DO NOTHING;

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_organizationId_key" ON "UserRole"("userId", "roleId", "organizationId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrganization" ADD CONSTRAINT "UserOrganization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
