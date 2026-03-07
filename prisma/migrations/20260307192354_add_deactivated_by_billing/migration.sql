-- AlterTable
ALTER TABLE "ComplementBundle" ADD COLUMN     "deactivatedByBilling" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TieredBundle" ADD COLUMN     "deactivatedByBilling" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "VolumeBundle" ADD COLUMN     "deactivatedByBilling" BOOLEAN NOT NULL DEFAULT false;
