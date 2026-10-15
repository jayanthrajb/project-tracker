CREATE TYPE "DependencyType" AS ENUM ('BLOCKS', 'RELATES_TO');

ALTER TABLE "Item" ADD COLUMN "parentId" TEXT;

CREATE TABLE "ItemDependency" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'BLOCKS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemDependency_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Item_parentId_idx" ON "Item"("parentId");
CREATE UNIQUE INDEX "ItemDependency_fromId_toId_type_key" ON "ItemDependency"("fromId", "toId", "type");
CREATE INDEX "ItemDependency_toId_idx" ON "ItemDependency"("toId");

ALTER TABLE "Item" ADD CONSTRAINT "Item_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ItemDependency" ADD CONSTRAINT "ItemDependency_fromId_fkey"
    FOREIGN KEY ("fromId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemDependency" ADD CONSTRAINT "ItemDependency_toId_fkey"
    FOREIGN KEY ("toId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
