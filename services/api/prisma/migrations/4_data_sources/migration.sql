-- 数据来源主数据（Phase 9C 溯源体系，r-data.md §3.1）：
-- 机构/版本/许可/致谢句/抓取时间结构化落库，来源徽章与数据来源页直接渲染。
-- 取舍：celestial_object.sourceCatalog 保持字符串批次号，不做外键——
-- FK 需回填迁移且 seed 顺序耦合，应用层经 sourceKeyOf() 映射 data_source.key 关联查询即可。

-- CreateTable
CREATE TABLE "data_source" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "downloadUrl" TEXT,
    "version" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "licenseUrl" TEXT,
    "citationZh" TEXT NOT NULL,
    "citationEn" TEXT NOT NULL,
    "magComplete" DOUBLE PRECISION,
    "recordCount" INTEGER,
    "refreshPolicy" TEXT NOT NULL DEFAULT 'static-build',
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_source_key_key" ON "data_source"("key");
