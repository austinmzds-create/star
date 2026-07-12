-- 百科档案（Phase 7 encyclopedia）：celestial_object 增确定性推导列。
-- 全部可空、无默认值，向后兼容；数值由 seed 经 @star/astro-data derivePhysical 回填。

-- AlterTable
ALTER TABLE "celestial_object"
  ADD COLUMN "tempK" INTEGER,
  ADD COLUMN "massSolar" DOUBLE PRECISION,
  ADD COLUMN "radiusSolar" DOUBLE PRECISION,
  ADD COLUMN "luminositySolar" DOUBLE PRECISION,
  ADD COLUMN "ageGyr" DOUBLE PRECISION,
  ADD COLUMN "lifespanGyr" DOUBLE PRECISION,
  ADD COLUMN "absoluteMag" DOUBLE PRECISION,
  ADD COLUMN "stage" TEXT,
  ADD COLUMN "fate" TEXT,
  ADD COLUMN "bestMonth" INTEGER,
  ADD COLUMN "visibility" TEXT,
  ADD COLUMN "funFacts" JSONB;
