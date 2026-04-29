-- Add backend field placement config for workflows
ALTER TABLE "Workflow"
ADD COLUMN IF NOT EXISTS "fieldConfig" TEXT;
