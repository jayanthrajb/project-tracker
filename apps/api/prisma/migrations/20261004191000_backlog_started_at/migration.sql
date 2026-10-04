ALTER TYPE "ItemStatus" ADD VALUE 'BACKLOG' BEFORE 'OPEN';

ALTER TABLE "Item" ADD COLUMN "startedAt" TIMESTAMP(3);

-- Only recorded status transitions establish an actual start; do not infer one
-- from creation, last activity, or a later current status.
UPDATE "Item" AS i
SET "startedAt" = starts."startedAt"
FROM (
  SELECT "itemId", MIN("createdAt") AS "startedAt"
  FROM "ActivityLog"
  WHERE "field" = 'status'
    AND "newValue" = 'IN_PROGRESS'
    AND "action" IN ('STATUS_CHANGED', 'BULK_UPDATED')
  GROUP BY "itemId"
) AS starts
WHERE i."id" = starts."itemId";
