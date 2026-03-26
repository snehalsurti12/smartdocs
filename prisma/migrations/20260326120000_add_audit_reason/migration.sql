-- Add reason field to AuditEvent for rejection reasons and status change comments
ALTER TABLE "AuditEvent" ADD COLUMN "reason" TEXT;
