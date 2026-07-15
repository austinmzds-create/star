-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CelestialType" ADD VALUE 'PLANET';
ALTER TYPE "CelestialType" ADD VALUE 'MOON';
ALTER TYPE "CelestialType" ADD VALUE 'SUN';

-- AlterTable
ALTER TABLE "celestial_object" ADD COLUMN     "isEphemeris" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "raDeg" DROP NOT NULL,
ALTER COLUMN "decDeg" DROP NOT NULL;

