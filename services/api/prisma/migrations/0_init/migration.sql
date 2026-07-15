-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CelestialType" AS ENUM ('STAR', 'GALAXY', 'NEBULA', 'CLUSTER');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "OccasionType" AS ENUM ('LOVE', 'BIRTHDAY', 'WEDDING', 'GRADUATION', 'NEWBORN', 'PET_MEMORIAL', 'IN_MEMORIAM', 'OTHER');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CoupleRole" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "celestial_object" (
    "id" SERIAL NOT NULL,
    "objectUid" TEXT NOT NULL,
    "type" "CelestialType" NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bayer" TEXT,
    "constellation" TEXT NOT NULL,
    "constellationZh" TEXT NOT NULL,
    "raDeg" DOUBLE PRECISION NOT NULL,
    "decDeg" DOUBLE PRECISION NOT NULL,
    "magnitude" DOUBLE PRECISION NOT NULL,
    "distanceLy" DOUBLE PRECISION,
    "spectralType" TEXT,
    "catalogIds" JSONB NOT NULL DEFAULT '{}',
    "isNamable" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "descriptionZh" TEXT,
    "renderPriority" INTEGER NOT NULL DEFAULT 0,
    "searchPriority" INTEGER NOT NULL DEFAULT 0,
    "dataQualityScore" INTEGER NOT NULL DEFAULT 0,
    "sourceCatalog" TEXT NOT NULL DEFAULT 'astro-data-seed-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "celestial_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "celestial_name_alias" (
    "id" SERIAL NOT NULL,
    "objectUid" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasNorm" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "source" TEXT NOT NULL DEFAULT 'alias',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "celestial_name_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "wxOpenid" TEXT,
    "wxUnionid" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memorial_registration" (
    "id" TEXT NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "starObjectUid" TEXT NOT NULL,
    "starSnapshotJson" JSONB NOT NULL,
    "memorialName" VARCHAR(64) NOT NULL,
    "occasionType" "OccasionType" NOT NULL,
    "memorialDate" DATE,
    "blessingText" VARCHAR(280),
    "storyText" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "publicSlug" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "contactEmail" TEXT,
    "reviewNote" TEXT,
    "coupleGroupId" TEXT,
    "coupleRole" "CoupleRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memorial_registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "couple_group" (
    "id" TEXT NOT NULL,
    "coupleSlug" TEXT NOT NULL,
    "relationLabel" VARCHAR(64),
    "coupleBlessing" VARCHAR(280),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "couple_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_record" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'PENDING',
    "certObjectKey" TEXT,
    "starMapObjectKey" TEXT,
    "assetFormat" TEXT NOT NULL DEFAULT 'svg',
    "templateVersion" TEXT NOT NULL DEFAULT 'v1',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificate_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "userId" TEXT,
    "registrationId" TEXT,
    "skuCode" TEXT NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "channel" TEXT,
    "provider" TEXT,
    "providerTxnId" TEXT,
    "subject" TEXT,
    "payMeta" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "album_record" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'PENDING',
    "templateVersion" TEXT NOT NULL DEFAULT 'v1',
    "combinedObjectKey" TEXT,
    "pageObjectKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "assetFormat" TEXT NOT NULL DEFAULT 'svg',
    "letterMode" TEXT,
    "letterTaskId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "album_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_task" (
    "id" TEXT NOT NULL,
    "skillCode" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "outputJson" JSONB,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "modelName" TEXT,
    "durationMs" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "registrationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "celestial_object_objectUid_key" ON "celestial_object"("objectUid");

-- CreateIndex
CREATE INDEX "celestial_object_isFeatured_magnitude_idx" ON "celestial_object"("isFeatured", "magnitude");

-- CreateIndex
CREATE INDEX "celestial_object_constellation_idx" ON "celestial_object"("constellation");

-- CreateIndex
CREATE INDEX "celestial_object_isNamable_searchPriority_idx" ON "celestial_object"("isNamable", "searchPriority" DESC);

-- CreateIndex
CREATE INDEX "celestial_name_alias_aliasNorm_idx" ON "celestial_name_alias"("aliasNorm");

-- CreateIndex
CREATE UNIQUE INDEX "celestial_name_alias_objectUid_aliasNorm_source_key" ON "celestial_name_alias"("objectUid", "aliasNorm", "source");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_wxOpenid_key" ON "app_user"("wxOpenid");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_wxUnionid_key" ON "app_user"("wxUnionid");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_phone_key" ON "app_user"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "memorial_registration_registrationNo_key" ON "memorial_registration"("registrationNo");

-- CreateIndex
CREATE UNIQUE INDEX "memorial_registration_publicSlug_key" ON "memorial_registration"("publicSlug");

-- CreateIndex
CREATE INDEX "memorial_registration_starObjectUid_status_idx" ON "memorial_registration"("starObjectUid", "status");

-- CreateIndex
CREATE INDEX "memorial_registration_ownerUserId_idx" ON "memorial_registration"("ownerUserId");

-- CreateIndex
CREATE INDEX "memorial_registration_status_createdAt_idx" ON "memorial_registration"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "memorial_registration_coupleGroupId_idx" ON "memorial_registration"("coupleGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "memorial_registration_coupleGroupId_coupleRole_key" ON "memorial_registration"("coupleGroupId", "coupleRole");

-- CreateIndex
CREATE UNIQUE INDEX "couple_group_coupleSlug_key" ON "couple_group"("coupleSlug");

-- CreateIndex
CREATE INDEX "certificate_record_registrationId_status_idx" ON "certificate_record"("registrationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_record_registrationId_templateVersion_key" ON "certificate_record"("registrationId", "templateVersion");

-- CreateIndex
CREATE UNIQUE INDEX "order_orderNo_key" ON "order"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "order_providerTxnId_key" ON "order"("providerTxnId");

-- CreateIndex
CREATE INDEX "order_userId_status_idx" ON "order"("userId", "status");

-- CreateIndex
CREATE INDEX "order_status_createdAt_idx" ON "order"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "order_provider_status_idx" ON "order"("provider", "status");

-- CreateIndex
CREATE INDEX "album_record_registrationId_status_idx" ON "album_record"("registrationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "album_record_registrationId_templateVersion_key" ON "album_record"("registrationId", "templateVersion");

-- CreateIndex
CREATE INDEX "agent_task_status_createdAt_idx" ON "agent_task"("status", "createdAt");

-- CreateIndex
CREATE INDEX "agent_task_skillCode_status_idx" ON "agent_task"("skillCode", "status");

-- AddForeignKey
ALTER TABLE "celestial_name_alias" ADD CONSTRAINT "celestial_name_alias_objectUid_fkey" FOREIGN KEY ("objectUid") REFERENCES "celestial_object"("objectUid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorial_registration" ADD CONSTRAINT "memorial_registration_starObjectUid_fkey" FOREIGN KEY ("starObjectUid") REFERENCES "celestial_object"("objectUid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorial_registration" ADD CONSTRAINT "memorial_registration_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorial_registration" ADD CONSTRAINT "memorial_registration_coupleGroupId_fkey" FOREIGN KEY ("coupleGroupId") REFERENCES "couple_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_record" ADD CONSTRAINT "certificate_record_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "memorial_registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "memorial_registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_record" ADD CONSTRAINT "album_record_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "memorial_registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_task" ADD CONSTRAINT "agent_task_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "memorial_registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

