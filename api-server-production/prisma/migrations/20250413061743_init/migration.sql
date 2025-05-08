/*
  Warnings:

  - Made the column `config` on table `Document` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Document" ALTER COLUMN "config" SET NOT NULL;
