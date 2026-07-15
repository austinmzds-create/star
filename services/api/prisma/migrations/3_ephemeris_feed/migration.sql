-- 星历订阅（Phase 9C ephemeris-feed）：运行时定期刷新的两张快照表。
-- minor_body_elements：每日 04:00 从 JPL SBDB 拉现役亮彗星 + 白名单 + 三大主带小行星，整表原子替换；
-- tle_snapshot：每 6h 从 Celestrak GP API 拉 ISS/CSS/HST，逐星 upsert。
-- 两表都是「最后成功值持久化」的降级锚点：上游宕机时端点仍能返回最近一次成功批次。

-- CreateTable
CREATE TABLE "minor_body_elements" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameZh" TEXT,
    "kind" TEXT NOT NULL,
    "epochJd" DOUBLE PRECISION NOT NULL,
    "e" DOUBLE PRECISION NOT NULL,
    "qAu" DOUBLE PRECISION,
    "aAu" DOUBLE PRECISION,
    "iDeg" DOUBLE PRECISION NOT NULL,
    "omDeg" DOUBLE PRECISION NOT NULL,
    "wDeg" DOUBLE PRECISION NOT NULL,
    "tpJd" DOUBLE PRECISION,
    "maDeg" DOUBLE PRECISION,
    "m1" DOUBLE PRECISION,
    "m2" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'jpl-sbdb',
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "minor_body_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tle_snapshot" (
    "id" TEXT NOT NULL,
    "noradId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nameZh" TEXT,
    "l1" TEXT NOT NULL,
    "l2" TEXT NOT NULL,
    "epochAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'celestrak',
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tle_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "minor_body_elements_kind_idx" ON "minor_body_elements"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "tle_snapshot_noradId_key" ON "tle_snapshot"("noradId");
