-- No HOD approval for marks (2026-11-07): tests that were waiting for the HOD go back to being entered.
UPDATE "assessment" SET "status" = 'DRAFT', "version" = "version" + 1, "updated_at" = now() WHERE "status" = 'SUBMITTED';--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_no_submitted" CHECK ("assessment"."status" <> 'SUBMITTED');